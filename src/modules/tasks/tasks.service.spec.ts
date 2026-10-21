import { PropertyStatus, UserRole } from '@prisma/client'
import { TasksService } from './tasks.service'

const owner = { sub: 'owner', email: 'owner@example.invalid', role: UserRole.OWNER }
const input = { propertyId: 'property', title: 'Inspect the property', description: 'Check the windows and doors.' }

describe('manager tasks and property drafts', () => {
  it.each([UserRole.ADMIN, UserRole.OWNER, UserRole.PROPERTY_MANAGER])('rejects a %s task for an unfinished property even when it has a manager', async (role) => {
    const prisma = {
      property: { findUnique: jest.fn().mockResolvedValue({ id: 'property', ownerId: owner.sub, managerId: owner.sub, status: PropertyStatus.DRAFT }) },
      $transaction: jest.fn(),
    }
    await expect(new TasksService(prisma as never).create(input, { ...owner, role })).rejects.toThrow('Submit the property')
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
