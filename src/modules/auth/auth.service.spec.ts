import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { AuthChallengePurpose, UserRole, UserStatus } from '@prisma/client'
import * as argon2 from 'argon2'
import { PrismaService } from '../../database/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'
import { AuthService } from './auth.service'

jest.mock('argon2', () => ({
  hash: jest.fn().mockResolvedValue('new-password-hash'),
  verify: jest.fn().mockResolvedValue(true),
}))

describe('staff invitation acceptance', () => {
  const userId = 'f53c019c-c1ca-4bc7-bb54-d9b28d822fd9'
  const token = `${userId}.${'a'.repeat(64)}`
  let service: AuthService
  let invitedUser: Record<string, unknown>
  const users = {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    update: jest.fn(),
  }
  const jwt = { signAsync: jest.fn() }

  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(argon2.verify).mockResolvedValue(true)
    invitedUser = {
      id: userId,
      email: 'staff@example.com',
      role: UserRole.INSPECTOR,
      status: UserStatus.INVITED,
      invitationTokenHash: 'original-token-hash',
      invitationExpiresAt: new Date(Date.now() + 60_000),
      profile: { firstName: 'Ada', lastName: 'Eze' },
    }
    users.findUnique.mockImplementation(async () => ({ ...invitedUser }))
    users.updateMany.mockResolvedValue({ count: 1 })
    users.findUniqueOrThrow.mockImplementation(async () => ({
      ...invitedUser,
      status: UserStatus.ACTIVE,
      invitationTokenHash: null,
      invitationExpiresAt: null,
      emailVerifiedAt: new Date(),
    }))
    users.update.mockResolvedValue({})
    jwt.signAsync.mockResolvedValue('signed-session-token')
    service = new AuthService(
      { user: users } as unknown as PrismaService,
      jwt as unknown as JwtService,
      new ConfigService({ JWT_ACCESS_SECRET: 'test-access', JWT_REFRESH_SECRET: 'test-refresh' }),
      {} as NotificationsService,
    )
  })

  it('activates the account, consumes the link, and returns no credential hashes', async () => {
    const result = await service.acceptInvitation({ token, password: 'NewPassword1!' })
    expect(result.user.status).toBe(UserStatus.ACTIVE)
    expect(result.user).not.toHaveProperty('passwordHash')
    expect(result.user).not.toHaveProperty('invitationTokenHash')
    expect(users.updateMany).toHaveBeenCalledWith({
      where: {
        id: userId,
        status: UserStatus.INVITED,
        invitationTokenHash: 'original-token-hash',
        invitationExpiresAt: { gt: expect.any(Date) },
      },
      data: {
        passwordHash: 'new-password-hash',
        status: UserStatus.ACTIVE,
        emailVerifiedAt: expect.any(Date),
        invitationTokenHash: null,
        invitationExpiresAt: null,
      },
    })
  })

  it.each([UserStatus.ACTIVE, UserStatus.REVOKED, UserStatus.SUSPENDED])(
    'rejects a link whose account is %s',
    async (status) => {
      invitedUser.status = status
      await expect(service.acceptInvitation({ token, password: 'NewPassword1!' })).rejects.toThrow('invalid or has expired')
      expect(users.updateMany).not.toHaveBeenCalled()
      expect(jwt.signAsync).not.toHaveBeenCalled()
    },
  )

  it('rejects an expired link without changing the password', async () => {
    invitedUser.invitationExpiresAt = new Date(Date.now() - 1)
    await expect(service.acceptInvitation({ token, password: 'NewPassword1!' })).rejects.toThrow('invalid or has expired')
    expect(users.updateMany).not.toHaveBeenCalled()
  })

  it('rejects an invalid secret even when the user ID exists', async () => {
    jest.mocked(argon2.verify).mockResolvedValue(false)
    await expect(service.acceptInvitation({ token, password: 'NewPassword1!' })).rejects.toThrow('invalid or has expired')
    expect(users.updateMany).not.toHaveBeenCalled()
  })

  it('issues no session when the link changes between validation and activation', async () => {
    users.updateMany.mockResolvedValue({ count: 0 })
    await expect(service.acceptInvitation({ token, password: 'NewPassword1!' })).rejects.toThrow('invalid or has expired')
    expect(users.findUniqueOrThrow).not.toHaveBeenCalled()
    expect(jwt.signAsync).not.toHaveBeenCalled()
    expect(users.update).not.toHaveBeenCalled()
  })

  it.each([UserRole.ADMIN, UserRole.PROPERTY_MANAGER, UserRole.INSPECTOR, UserRole.CONTRACTOR])(
    'blocks public registration of %s accounts',
    async (role) => {
      await expect(service.register({ firstName: 'Ada', lastName: 'Eze', email: 'ada@example.com', password: 'Password1!', role })).rejects.toThrow('Only property owners and guests')
      expect(users.findUnique).not.toHaveBeenCalled()
    },
  )
})

describe('password reset transaction', () => {
  const challenge = {
    id: 'reset-challenge',
    userId: 'reset-user',
    purpose: AuthChallengePurpose.RESET_PASSWORD,
    resetTokenHash: 'original-reset-token-hash',
    expiresAt: new Date(Date.now() + 60_000),
  }
  const dto = { challengeId: challenge.id, resetToken: 'verified-reset-token', password: 'NewPassword1!' }

  function setup() {
    const prisma = {
      authChallenge: { findUnique: jest.fn().mockResolvedValue({ ...challenge, expiresAt: new Date(Date.now() + 60_000) }), deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $transaction: jest.fn(),
    }
    prisma.$transaction.mockImplementation(async (work: (tx: typeof prisma) => Promise<unknown>) => work(prisma))
    const service = new AuthService(prisma as unknown as PrismaService, {} as JwtService, new ConfigService(), {} as NotificationsService)
    return { prisma, service }
  }

  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(argon2.verify).mockResolvedValue(true)
    jest.mocked(argon2.hash).mockResolvedValue('new-password-hash')
  })

  it('hashes before starting a bounded transaction that consumes the token and invalidates sessions', async () => {
    const { service, prisma } = setup()
    prisma.$transaction.mockImplementation(async (work: (tx: typeof prisma) => Promise<unknown>) => {
      expect(argon2.hash).toHaveBeenCalledWith(dto.password)
      return work(prisma)
    })
    await expect(service.resetPassword(dto)).resolves.toEqual({ message: 'Your password has been updated. Sign in with your new password.' })
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 5_000, timeout: 30_000 })
    expect(prisma.authChallenge.deleteMany).toHaveBeenCalledWith({ where: { id: challenge.id, resetTokenHash: challenge.resetTokenHash, expiresAt: { gt: expect.any(Date) } } })
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: challenge.userId, status: { in: [UserStatus.ACTIVE, UserStatus.PENDING] } },
      data: { passwordHash: 'new-password-hash', refreshTokenHash: null, sessionVersion: { increment: 1 } },
    })
  })

  it('rejects a token that expired before validation without starting a transaction', async () => {
    const { service, prisma } = setup()
    prisma.authChallenge.findUnique.mockResolvedValue({ ...challenge, expiresAt: new Date(Date.now() - 1) })
    await expect(service.resetPassword(dto)).rejects.toThrow('invalid, expired')
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(argon2.hash).not.toHaveBeenCalled()
  })

  it('does not update the password if another request already consumed or replaced the token', async () => {
    const { service, prisma } = setup()
    prisma.authChallenge.deleteMany.mockResolvedValue({ count: 0 })
    await expect(service.resetPassword(dto)).rejects.toThrow('invalid, expired')
    expect(prisma.user.updateMany).not.toHaveBeenCalled()
  })

  it('rejects a reset when the account was disabled before the transaction completed', async () => {
    const { service, prisma } = setup()
    prisma.user.updateMany.mockResolvedValue({ count: 0 })
    await expect(service.resetPassword(dto)).rejects.toThrow('invalid, expired')
    expect(prisma.authChallenge.deleteMany).toHaveBeenCalledTimes(1)
  })
})
