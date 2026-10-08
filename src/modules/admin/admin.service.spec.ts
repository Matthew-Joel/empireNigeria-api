import { ConfigService } from '@nestjs/config'
import { UserRole, UserStatus } from '@prisma/client'
import { PrismaService } from '../../database/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'
import { AdminService } from './admin.service'

jest.mock('argon2', () => ({ hash: jest.fn().mockResolvedValue('stored-hash') }))

describe('internal staff invitations', () => {
  const dto = { firstName: 'Ada', lastName: 'Eze', email: 'ADA@example.com', role: UserRole.INSPECTOR }
  const user = {
    id: 'f53c019c-c1ca-4bc7-bb54-d9b28d822fd9',
    email: 'ada@example.com',
    role: UserRole.INSPECTOR,
    status: UserStatus.INVITED,
    profile: { firstName: 'Ada', lastName: 'Eze' },
  }
  const users = { findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn() }
  const auditEvent = { create: jest.fn(), findMany: jest.fn() }
  const notifications = { sendEmail: jest.fn() }
  let service: AdminService

  beforeEach(() => {
    jest.clearAllMocks()
    users.findUnique.mockResolvedValue(null)
    users.create.mockResolvedValue(user)
    users.updateMany.mockResolvedValue({ count: 1 })
    notifications.sendEmail.mockResolvedValue({ sent: true, id: 'test-email' })
    service = new AdminService(
      { user: users, auditEvent } as unknown as PrismaService,
      new ConfigService({ APP_URL: 'https://app.example.com/' }),
      notifications as unknown as NotificationsService,
    )
  })

  it.each([UserRole.PROPERTY_MANAGER, UserRole.INSPECTOR, UserRole.CONTRACTOR])(
    'creates a %s invitation and sends its password setup link',
    async (role) => {
      users.create.mockResolvedValue({ ...user, role })
      const result = await service.createInvitation({ ...dto, role }, 'internal-admin-id')
      expect(users.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ email: 'ada@example.com', role, status: UserStatus.INVITED, invitedBy: { connect: { id: 'internal-admin-id' } } }),
      }))
      const email = notifications.sendEmail.mock.calls[0][0]
      expect(email.to).toBe(user.email)
      expect(email.text).toMatch(/https:\/\/app\.example\.com\/accept-invitation\?token=[0-9a-f-]+\.[0-9a-f]{64}/)
      expect(email.html).toContain('expires in 24 hours')
      expect(result.user).not.toHaveProperty('invitationTokenHash')
      expect(result.user).not.toHaveProperty('passwordHash')
      expect(auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'STAFF_INVITED', actorId: 'internal-admin-id', entityId: user.id }) }))
    },
  )

  it.each([UserRole.ADMIN, UserRole.OWNER, UserRole.GUEST])('rejects invitations for %s', async (role) => {
    await expect(service.createInvitation({ ...dto, role }, 'internal-admin-id')).rejects.toThrow('Only property managers')
    expect(users.create).not.toHaveBeenCalled()
    expect(notifications.sendEmail).not.toHaveBeenCalled()
  })

  it('does not claim delivery when Resend is disabled', async () => {
    notifications.sendEmail.mockResolvedValue({ sent: false, reason: 'email_disabled_in_development' })
    await expect(service.createInvitation(dto, 'internal-admin-id')).rejects.toThrow('Configure Resend and resend')
  })

  it('surfaces delivery failures so the saved invitation can be resent', async () => {
    notifications.sendEmail.mockRejectedValue(new Error('Email delivery failed'))
    await expect(service.createInvitation(dto, 'internal-admin-id')).rejects.toThrow('Email delivery failed')
    expect(users.create).toHaveBeenCalledTimes(1)
  })

  it('does not send a replacement link after the invitation was accepted or revoked', async () => {
    users.findUnique.mockResolvedValue(user)
    users.updateMany.mockResolvedValue({ count: 0 })
    await expect(service.resendInvitation(user.id)).rejects.toThrow('An active invitation was not found')
    expect(users.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: user.id, status: UserStatus.INVITED } }))
    expect(notifications.sendEmail).not.toHaveBeenCalled()
  })
})
