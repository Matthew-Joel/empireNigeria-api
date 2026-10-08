import { ConfigService } from '@nestjs/config'
import { PropertyStatus, UserStatus } from '@prisma/client'
import { AdminService } from './admin.service'

describe('administrator overview', () => {
  it('returns real account and property counts with bounded recent records', async () => {
    const user = { count: jest.fn().mockResolvedValueOnce(9).mockResolvedValueOnce(2).mockResolvedValueOnce(1), findMany: jest.fn().mockResolvedValue([{ id: 'user-id' }]) }
    const property = { count: jest.fn().mockResolvedValueOnce(5).mockResolvedValueOnce(3).mockResolvedValueOnce(1), findMany: jest.fn().mockResolvedValue([{ id: 'property-id' }]) }
    const service = new AdminService({ user, property } as never, new ConfigService(), {} as never)
    const overview = await service.overview()
    expect(overview).toEqual({ totalUsers: 9, invitedStaff: 2, pendingVerification: 1, totalProperties: 5, reviewQueue: 3, inspectionPending: 1, recentUsers: [{ id: 'user-id' }], recentProperties: [{ id: 'property-id' }] })
    expect(user.count).toHaveBeenCalledWith({ where: { status: UserStatus.INVITED } })
    expect(property.count).toHaveBeenCalledWith({ where: { status: { in: [PropertyStatus.SUBMITTED, PropertyStatus.UNDER_REVIEW, PropertyStatus.CHANGES_REQUESTED] } } })
    expect(user.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }))
    expect(property.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }))
  })
})
