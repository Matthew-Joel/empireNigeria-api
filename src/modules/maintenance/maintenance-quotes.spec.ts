import { UserRole } from '@prisma/client'
import { MaintenanceService } from './maintenance.service'

describe('maintenance quote contractor identity', () => {
  const owner = { sub: 'owner', email: 'owner@example.invalid', role: UserRole.OWNER }
  const record = { id: 'request', property: { ownerId: 'owner', owner: { email: owner.email } }, contractorId: 'replacement', contractor: { email: 'replacement@example.invalid', profile: { firstName: 'New', lastName: 'Contractor' } }, updates: [], evidence: [], quotes: [{ id: 'quote-old', contractorId: 'original' }, { id: 'quote-new', contractorId: 'replacement' }, { id: 'quote-deleted', contractorId: 'deleted' }] }
  it('labels historical quotes with their author after reassignment, using one account lookup', async () => {
    const user = { findMany: jest.fn().mockResolvedValue([{ id: 'original', email: 'old@example.invalid', profile: { firstName: 'Original', lastName: 'Contractor' } }, { id: 'replacement', email: 'replacement@example.invalid', profile: null }]) }
    const service = new MaintenanceService({ maintenanceRequest: { findMany: jest.fn().mockResolvedValue([record, record]) }, user } as never, {} as never)
    const result = await service.list(owner)
    expect(result[0].quotes.map((quote) => quote.contractorName)).toEqual(['Original Contractor', 'replacement@example.invalid', null])
    expect(user.findMany).toHaveBeenCalledTimes(1)
    expect(user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['original', 'replacement', 'deleted'] } } }))
  })
  it('checks property access before resolving quote identities', async () => {
    const user = { findMany: jest.fn() }
    const service = new MaintenanceService({ maintenanceRequest: { findUnique: jest.fn().mockResolvedValue(record) }, user } as never, {} as never)
    await expect(service.get('request', { ...owner, sub: 'another-owner' })).rejects.toThrow('Maintenance request not found')
    expect(user.findMany).not.toHaveBeenCalled()
  })
})
