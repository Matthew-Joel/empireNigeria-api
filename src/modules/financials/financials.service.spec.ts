import { PropertyStatus, UserRole } from '@prisma/client'
import { FinancialsService } from './financials.service'

const owner = { sub: 'owner', email: 'owner@example.invalid', role: UserRole.OWNER }

describe('financial records and property drafts', () => {
  it.each([UserRole.ADMIN, UserRole.OWNER, UserRole.PROPERTY_MANAGER])('does not include %s unfinished drafts in expense or booking summaries', async (role) => {
    const prisma = {
      financialExpense: { findMany: jest.fn().mockResolvedValue([]), aggregate: jest.fn().mockResolvedValue({ _sum: { amountNgn: null } }) },
      maintenanceQuote: { aggregate: jest.fn().mockResolvedValue({ _sum: { amountNgn: null } }) },
      booking: { aggregate: jest.fn().mockResolvedValue({ _sum: { totalNgn: null } }) },
    }
    await new FinancialsService(prisma as never).summary({ ...owner, role })
    const property = { status: { not: PropertyStatus.DRAFT }, ...(role === UserRole.ADMIN ? {} : role === UserRole.OWNER ? { ownerId: owner.sub } : { managerId: owner.sub }) }
    expect(prisma.financialExpense.aggregate).toHaveBeenCalledWith({ where: { property }, _sum: { amountNgn: true } })
    expect(prisma.booking.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ listing: { property } }) }))
  })

  it('does not write expenses when the property is an unfinished draft or inaccessible', async () => {
    const prisma = { property: { findFirst: jest.fn().mockResolvedValue(null) }, $transaction: jest.fn() }
    await expect(new FinancialsService(prisma as never).create({ propertyId: 'property', amountNgn: 1000, category: 'OTHER', description: 'Replacement fitting', incurredOn: '2026-01-01' } as never, owner)).rejects.toThrow('Property not found')
    expect(prisma.property.findFirst).toHaveBeenCalledWith({ where: { id: 'property', status: { not: PropertyStatus.DRAFT }, ownerId: owner.sub }, select: { id: true } })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
