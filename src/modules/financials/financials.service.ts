import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { BookingStatus, MaintenanceQuoteStatus, Prisma, PropertyStatus, UserRole } from '@prisma/client'
import { AuthenticatedRequest } from '../../common/types/request-with-user'
import { PrismaService } from '../../database/prisma.service'
import { CreateExpenseDto } from './dto/expense.dto'

type Actor = AuthenticatedRequest['user']
@Injectable()
export class FinancialsService {
  constructor(private readonly prisma: PrismaService) {}
  private where(actor: Actor): Prisma.PropertyWhereInput {
    return { status: { not: PropertyStatus.DRAFT }, ...(actor.role === UserRole.ADMIN ? {} : actor.role === UserRole.OWNER ? { ownerId: actor.sub } : { managerId: actor.sub }) }
  }
  async summary(actor: Actor) {
    const propertyWhere = this.where(actor)
    const [expenses, expenseTotal, quotes, bookings] = await Promise.all([
      this.prisma.financialExpense.findMany({ where: { property: propertyWhere }, include: { property: { select: { name: true } } }, orderBy: { incurredOn: 'desc' }, take: 200 }),
      this.prisma.financialExpense.aggregate({ where: { property: propertyWhere }, _sum: { amountNgn: true } }),
      this.prisma.maintenanceQuote.aggregate({ where: { status: MaintenanceQuoteStatus.APPROVED, request: { property: propertyWhere } }, _sum: { amountNgn: true } }),
      this.prisma.booking.aggregate({ where: { status: { in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED] }, listing: { property: propertyWhere } }, _sum: { totalNgn: true } }),
    ])
    const expenseTotalNgn = expenseTotal._sum.amountNgn ?? 0
    return { currency: 'NGN', expenseTotalNgn, approvedMaintenanceQuotesNgn: quotes._sum.amountNgn ?? 0,
      confirmedBookingValueNgn: bookings._sum.totalNgn ?? 0, receivedBookingIncomeNgn: 0,
      incomeNote: 'Payment collection and received-income reconciliation are planned for the payment phase.',
      expenses: expenses.map((row) => ({ id: row.id, propertyId: row.propertyId, propertyName: row.property.name, amountNgn: row.amountNgn, category: row.category, description: row.description, incurredOn: row.incurredOn.toISOString().slice(0, 10), createdAt: row.createdAt })) }
  }
  async create(dto: CreateExpenseDto, actor: Actor) {
    const property = await this.prisma.property.findFirst({ where: { id: dto.propertyId, ...this.where(actor) }, select: { id: true } })
    if (!property) throw new NotFoundException('Property not found')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dto.incurredOn)) throw new BadRequestException('Use a YYYY-MM-DD expense date')
    const incurredOn = new Date(`${dto.incurredOn}T00:00:00.000Z`)
    if (Number.isNaN(incurredOn.getTime()) || incurredOn.toISOString().slice(0, 10) !== dto.incurredOn || incurredOn > new Date()) throw new BadRequestException('Invalid expense date')
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.financialExpense.create({ data: { propertyId: dto.propertyId, createdById: actor.sub, amountNgn: dto.amountNgn, category: dto.category, description: dto.description.trim(), incurredOn } })
      await tx.auditEvent.create({ data: { actorId: actor.sub, actorRole: actor.role, action: 'EXPENSE_RECORDED', entityType: 'EXPENSE', entityId: row.id, summary: `Recorded ${dto.category.toLowerCase()} property expense` } })
    })
    return this.summary(actor)
  }
}
