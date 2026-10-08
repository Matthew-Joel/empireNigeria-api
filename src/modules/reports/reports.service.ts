import { Injectable } from '@nestjs/common'
import { BookingStatus, InspectionStatus, MaintenanceStatus, ManagerTaskStatus, Prisma, PropertyOccupancy, PropertyStatus, UserRole } from '@prisma/client'
import { AuthenticatedRequest } from '../../common/types/request-with-user'
import { PrismaService } from '../../database/prisma.service'
type Actor = AuthenticatedRequest['user']
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}
  async summary(actor: Actor) {
    const property: Prisma.PropertyWhereInput = actor.role === UserRole.ADMIN ? {} : actor.role === UserRole.OWNER ? { ownerId: actor.sub } : { managerId: actor.sub }
    const [totalProperties, approvedProperties, occupiedProperties, shortLetProperties, openMaintenance, completedMaintenance, inspectionsOpen, inspectionsReported, bookingRequests, confirmedBookings, openTasks, expenses] = await Promise.all([
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
    ])
    return { totalProperties, approvedProperties, occupiedProperties, shortLetProperties, openMaintenance, completedMaintenance, inspectionsOpen, inspectionsReported, bookingRequests, confirmedBookings, openTasks, recordedExpensesNgn: expenses._sum.amountNgn ?? 0, paymentMetricsAvailable: false }
  }
}
