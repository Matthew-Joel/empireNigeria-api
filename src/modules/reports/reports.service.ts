import { ForbiddenException, Injectable } from '@nestjs/common'
import { BookingStatus, InspectionStatus, MaintenanceStatus, ManagerTaskStatus, Prisma, PropertyOccupancy, PropertyStatus, UserRole } from '@prisma/client'
import { AuthenticatedRequest } from '../../common/types/request-with-user'
import { PrismaService } from '../../database/prisma.service'
import { ReportDates, reportingPeriod } from '../../common/reporting-period'
type Actor = AuthenticatedRequest['user']
const activityKeys = ['properties', 'bookings', 'maintenance', 'completedMaintenance', 'inspections', 'reports', 'recordedExpensesNgn', 'bookedValueNgn'] as const
type ActivityKey = typeof activityKeys[number]
type ActivityTotals = Record<ActivityKey, number>
type ActivityRow = { month: string; metric: ActivityKey; value: number }
const emptyActivity = (): ActivityTotals => ({ properties: 0, bookings: 0, maintenance: 0, completedMaintenance: 0, inspections: 0, reports: 0, recordedExpensesNgn: 0, bookedValueNgn: 0 })
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}
  async summary(actor: Actor, dates: ReportDates = {}) {
    if (![UserRole.ADMIN, UserRole.OWNER, UserRole.PROPERTY_MANAGER].some((role) => role === actor.role)) throw new ForbiddenException('Reports are not available for this role')
    const range = reportingPeriod(dates)
    const property: Prisma.PropertyWhereInput = { status: { not: PropertyStatus.DRAFT }, ...(actor.role === UserRole.ADMIN ? {} : actor.role === UserRole.OWNER ? { ownerId: actor.sub } : { managerId: actor.sub }) }
    const [totalProperties, approvedProperties, occupiedProperties, shortLetProperties, openMaintenance, completedMaintenance, inspectionsOpen, inspectionsReported, bookingRequests, confirmedBookings, openTasks, expenses, activity] = await Promise.all([
      this.prisma.property.count({ where: property }),
      this.prisma.property.count({ where: { ...property, status: PropertyStatus.APPROVED } }),
      this.prisma.property.count({ where: { ...property, occupancyStatus: PropertyOccupancy.OCCUPIED } }),
      this.prisma.property.count({ where: { ...property, occupancyStatus: PropertyOccupancy.AVAILABLE_FOR_SHORT_LET } }),
      this.prisma.maintenanceRequest.count({ where: { property, status: { notIn: [MaintenanceStatus.COMPLETED, MaintenanceStatus.CLOSED] } } }),
      this.prisma.maintenanceRequest.count({ where: { property, status: { in: [MaintenanceStatus.COMPLETED, MaintenanceStatus.CLOSED] } } }),
      this.prisma.inspection.count({ where: { property, status: { in: [InspectionStatus.SCHEDULED, InspectionStatus.IN_PROGRESS, InspectionStatus.COMPLETED] } } }),
      this.prisma.inspection.count({ where: { property, status: InspectionStatus.REPORT_READY } }),
      this.prisma.booking.count({ where: { listing: { property }, status: BookingStatus.REQUESTED } }),
      this.prisma.booking.count({ where: { listing: { property }, status: { in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED] } } }),
      this.prisma.managerTask.count({ where: { property, status: { in: [ManagerTaskStatus.OPEN, ManagerTaskStatus.IN_PROGRESS] } } }),
      this.prisma.financialExpense.aggregate({ where: { property }, _sum: { amountNgn: true } }),
      this.activity(actor, range),
    ])
    const series = range.months.map((month) => ({ ...month, ...emptyActivity() }))
    const activityTotals = emptyActivity()
    for (const row of activity) {
      const month = series.find((item) => item.month === row.month)
      if (!month || !activityKeys.includes(row.metric)) continue
      month[row.metric] = Number(row.value)
      activityTotals[row.metric] += Number(row.value)
    }
    return { totalProperties, approvedProperties, occupiedProperties, shortLetProperties, openMaintenance, completedMaintenance, inspectionsOpen, inspectionsReported, bookingRequests, confirmedBookings, openTasks, recordedExpensesNgn: expenses._sum.amountNgn ?? 0, paymentMetricsAvailable: false,
      period: { from: range.from, to: range.to, timeZone: range.timeZone }, series, activityTotals }
  }

  private activity(actor: Actor, range: ReturnType<typeof reportingPeriod>) {
    // All branches join the same access scope, including the money aggregates.
    const access = actor.role === UserRole.ADMIN ? Prisma.sql`TRUE` : actor.role === UserRole.OWNER ? Prisma.sql`p."ownerId" = ${actor.sub}::uuid` : Prisma.sql`p."managerId" = ${actor.sub}::uuid`
    return this.prisma.$queryRaw<ActivityRow[]>(Prisma.sql`
      WITH accessible_properties AS (SELECT p.id FROM properties p WHERE p.status <> 'DRAFT' AND ${access}),
      events AS (
        SELECT p."createdAt" AS occurred_at, 'properties' AS metric, 1::double precision AS value FROM properties p JOIN accessible_properties a ON a.id = p.id
        UNION ALL SELECT b."createdAt", 'bookings', 1 FROM bookings b JOIN stay_listings l ON l.id = b."listingId" JOIN accessible_properties a ON a.id = l."propertyId"
        UNION ALL SELECT m."reportedAt", 'maintenance', 1 FROM maintenance_requests m JOIN accessible_properties a ON a.id = m."propertyId"
        UNION ALL SELECT m."completedAt", 'completedMaintenance', 1 FROM maintenance_requests m JOIN accessible_properties a ON a.id = m."propertyId" WHERE m."completedAt" IS NOT NULL
        UNION ALL SELECT i."createdAt", 'inspections', 1 FROM inspections i JOIN accessible_properties a ON a.id = i."propertyId"
        UNION ALL SELECT r."submittedAt", 'reports', 1 FROM inspection_reports r JOIN inspections i ON i.id = r."inspectionId" JOIN accessible_properties a ON a.id = i."propertyId"
        UNION ALL SELECT e."incurredOn", 'recordedExpensesNgn', e."amountNgn" FROM financial_expenses e JOIN accessible_properties a ON a.id = e."propertyId"
        UNION ALL SELECT b."createdAt", 'bookedValueNgn', b."totalNgn" FROM bookings b JOIN stay_listings l ON l.id = b."listingId" JOIN accessible_properties a ON a.id = l."propertyId" WHERE b.status IN ('CONFIRMED', 'COMPLETED')
      )
      SELECT to_char(occurred_at AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Lagos', 'YYYY-MM') AS month,
        metric, sum(value)::double precision AS value
      FROM events WHERE occurred_at >= ${range.start} AND occurred_at < ${range.end}
      GROUP BY 1, 2 ORDER BY 1, 2
    `)
  }
}
