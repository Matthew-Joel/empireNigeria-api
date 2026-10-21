import { PropertyStatus, UserRole } from '@prisma/client'
import { ReportsService } from './reports.service'

function setup() {
  const count = jest.fn().mockResolvedValue(0)
  const prisma = {
    property: { count }, maintenanceRequest: { count }, inspection: { count }, booking: { count }, managerTask: { count },
    financialExpense: { aggregate: jest.fn().mockResolvedValue({ _sum: { amountNgn: null } }) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  }
  return { prisma, service: new ReportsService(prisma as never) }
}
const actor = (role: UserRole) => ({ sub: '10000000-0000-4000-8000-000000000001', email: 'report@example.invalid', role })

describe('portfolio report activity', () => {
  it.each([UserRole.OWNER, UserRole.PROPERTY_MANAGER])('scopes every raw activity branch to the %s property relation', async (role) => {
    const { prisma, service } = setup()
    const user = actor(role)
    const result = await service.summary(user, { from: '2026-09-01', to: '2026-10-10' })
    const query = prisma.$queryRaw.mock.calls[0][0]
    expect(query.text).toContain(role === UserRole.OWNER ? 'p."ownerId" = ' : 'p."managerId" = ')
    expect(query.values).toContain(user.sub)
    expect(query.text.match(/JOIN accessible_properties/g)).toHaveLength(8)
    expect(query.text).toContain("WHERE p.status <> 'DRAFT' AND")
    expect(prisma.property.count).toHaveBeenCalledWith({ where: { status: { not: PropertyStatus.DRAFT }, ...(role === UserRole.OWNER ? { ownerId: user.sub } : { managerId: user.sub }) } })
    expect(result.series.map((row) => row.month)).toEqual(['2026-09', '2026-10'])
    expect(result.activityTotals.bookedValueNgn).toBe(0)
    expect(result.paymentMetricsAvailable).toBe(false)
  })
  it('fills missing months with zeros and sums real activity without changing snapshot counts', async () => {
    const { prisma, service } = setup()
    prisma.$queryRaw.mockResolvedValue([{ month: '2026-09', metric: 'bookings', value: 3 }, { month: '2026-10', metric: 'bookings', value: 2 }, { month: '2026-10', metric: 'recordedExpensesNgn', value: 1500 }])
    const result = await service.summary(actor(UserRole.ADMIN), { from: '2026-08-01', to: '2026-10-10' })
    expect(result.series[0].bookings).toBe(0)
    expect(result.activityTotals.bookings).toBe(5)
    expect(result.activityTotals.recordedExpensesNgn).toBe(1500)
    expect(result.recordedExpensesNgn).toBe(0)
    expect(result.period).toEqual({ from: '2026-08-01', to: '2026-10-10', timeZone: 'Africa/Lagos' })
    expect(prisma.property.count).toHaveBeenCalledWith({ where: { status: { not: PropertyStatus.DRAFT } } })
    expect(prisma.$queryRaw.mock.calls[0][0].text).toContain("WHERE p.status <> 'DRAFT' AND TRUE")
  })
  it('rejects invalid dates and unauthorized roles before querying', async () => {
    const { prisma, service } = setup()
    await expect(service.summary(actor(UserRole.OWNER), { from: '2026-02-30' })).rejects.toThrow()
    await expect(service.summary(actor(UserRole.CONTRACTOR))).rejects.toThrow('Reports are not available')
    expect(prisma.property.count).not.toHaveBeenCalled()
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })
})
