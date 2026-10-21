import { ConfigService } from '@nestjs/config'
import { PropertyStatus, UserStatus } from '@prisma/client'
import { AdminService } from './admin.service'

describe('administrator overview', () => {
  it('uses Nigerian calendar months consistently in the existing analytics charts', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-30T23:30:00Z'))
    try {
      const $queryRaw = jest.fn().mockResolvedValue([])
      const service = new AdminService({ $queryRaw, maintenanceRequest: { groupBy: jest.fn().mockResolvedValue([]) } } as never, new ConfigService(), {} as never)
      const result = await service.analytics()
      expect(result.timeZone).toBe('Africa/Lagos')
      expect(result.months.at(-1)?.month).toBe('2026-10')
      expect($queryRaw).toHaveBeenCalledTimes(4)
      for (const [parts, start, end] of $queryRaw.mock.calls) {
        expect(parts.join('')).toContain("AT TIME ZONE 'Africa/Lagos'")
        expect(start.toISOString()).toBe('2026-04-30T23:00:00.000Z')
        expect(end.toISOString()).toBe('2026-10-01T23:00:00.000Z')
      }
      expect($queryRaw.mock.calls[0][0].join('')).toContain("status <> 'DRAFT'")
    } finally { jest.useRealTimers() }
  })
  it('returns real account and property counts with bounded recent records', async () => {
    const user = { count: jest.fn().mockResolvedValueOnce(9).mockResolvedValueOnce(2).mockResolvedValueOnce(1), findMany: jest.fn().mockResolvedValue([{ id: 'user-id' }]) }
    const property = { count: jest.fn().mockResolvedValueOnce(5).mockResolvedValueOnce(3).mockResolvedValueOnce(1), findMany: jest.fn().mockResolvedValue([{ id: 'property-id' }]) }
    const service = new AdminService({ user, property, $queryRaw: jest.fn().mockResolvedValue([]) } as never, new ConfigService(), {} as never)
    const overview = await service.overview()
    expect(overview).toMatchObject({ totalUsers: 9, invitedStaff: 2, pendingVerification: 1, totalProperties: 5, reviewQueue: 3, inspectionPending: 1, recentUsers: [{ id: 'user-id' }], recentProperties: [{ id: 'property-id' }] })
    expect(overview.metricActivity.totalUsers).toEqual({ current: 0, previous: 0 })
    expect(user.count).toHaveBeenCalledWith({ where: { status: UserStatus.INVITED } })
    expect(property.count).toHaveBeenCalledWith({ where: { status: { in: [PropertyStatus.SUBMITTED, PropertyStatus.UNDER_REVIEW, PropertyStatus.CHANGES_REQUESTED] } } })
    expect(property.count).toHaveBeenCalledWith({ where: { status: { not: PropertyStatus.DRAFT } } })
    expect(user.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }))
    expect(property.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: { not: PropertyStatus.DRAFT } }, take: 5 }))
  })
  it('reports monthly creation cohorts without treating them as historical queue snapshots', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-10T12:00:00Z'))
    try {
      const $queryRaw = jest.fn().mockResolvedValue([{ metric: 'reviewQueue', current: 4, previous: 2 }])
      const service = new AdminService({ user: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) }, property: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) }, $queryRaw } as never, new ConfigService(), {} as never)
      const result = await service.overview()
      expect(result.metricActivity.reviewQueue).toEqual({ current: 4, previous: 2 })
      expect(result.activityPeriod).toMatchObject({ currentFrom: '2026-10-01', currentTo: '2026-10-10', previousFrom: '2026-09-01', previousTo: '2026-09-30', timeZone: 'Africa/Lagos' })
      expect(result.activityPeriod.basis).toContain('current status')
      expect($queryRaw.mock.calls[0][0].text).toContain("status IN ('SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED')")
      expect($queryRaw.mock.calls[0][0].text).toContain("'totalProperties', \"createdAt\" FROM properties WHERE status <> 'DRAFT'")
    } finally { jest.useRealTimers() }
  })
})
