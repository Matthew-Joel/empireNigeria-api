import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { AuthChallengePurpose, UserRole, UserStatus } from '@prisma/client'
import * as argon2 from 'argon2'
import { PrismaService } from '../../database/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'
import { AuthService } from './auth.service'

jest.mock('argon2', () => ({ hash: jest.fn().mockResolvedValue('hash'), verify: jest.fn().mockResolvedValue(true) }))

describe('real account lifecycle', () => {
  const users = { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() }
  const challenges = { findUnique: jest.fn(), upsert: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn() }
  const jwt = { signAsync: jest.fn(), verifyAsync: jest.fn() }
  const notifications = { sendEmail: jest.fn() }
  let service: AuthService
  const user = { id: 'user-id', email: 'ada@example.com', passwordHash: 'old-hash', role: UserRole.OWNER, status: UserStatus.ACTIVE, sessionVersion: 2, refreshTokenHash: 'refresh-hash', profile: { firstName: 'Ada', lastName: 'Eze', country: 'Nigeria', timezone: 'Africa/Lagos' } }
  const challenge = { id: 'challenge-id', userId: user.id, purpose: AuthChallengePurpose.RESET_PASSWORD, codeHash: 'code-hash', expiresAt: new Date(Date.now() + 900_000), resendAt: new Date(Date.now() + 60_000), attempts: 0, resetTokenHash: null }

  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(argon2.verify).mockResolvedValue(true)
    users.findUnique.mockResolvedValue(user)
    users.findUniqueOrThrow.mockResolvedValue(user)
    users.create.mockResolvedValue({ ...user, status: UserStatus.PENDING })
    users.update.mockResolvedValue(user)
    users.updateMany.mockResolvedValue({ count: 1 })
    challenges.findUnique.mockResolvedValue(challenge)
    challenges.updateMany.mockResolvedValue({ count: 1 })
    challenges.deleteMany.mockResolvedValue({ count: 1 })
    challenges.upsert.mockImplementation(async ({ create }) => create)
    jwt.signAsync.mockResolvedValue('signed-token')
    jwt.verifyAsync.mockResolvedValue({ sub: user.id, version: 2 })
    notifications.sendEmail.mockResolvedValue({ sent: true })
    const db = { user: users, authChallenge: challenges, $transaction: (fn: (tx: unknown) => unknown) => fn({ user: users, authChallenge: challenges }) }
    service = new AuthService(db as unknown as PrismaService, jwt as unknown as JwtService, new ConfigService({ JWT_ACCESS_SECRET: 'access', JWT_REFRESH_SECRET: 'refresh' }), notifications as unknown as NotificationsService)
  })

  it.each([UserRole.OWNER, UserRole.GUEST])('registers %s without giving an unverified account a session', async (role) => {
    users.findUnique.mockResolvedValue(null)
    challenges.findUnique.mockResolvedValue(null)
    const result = await service.register({ firstName: 'Ada', lastName: 'Eze', email: user.email, password: 'Password1!', role })
    expect(result.verificationRequired).toBe(true)
    expect(result).not.toHaveProperty('accessToken')
    expect(result).not.toHaveProperty('developmentVerificationCode')
    expect(notifications.sendEmail).toHaveBeenCalledTimes(1)
    expect(challenges.upsert.mock.calls[0][0].create.purpose).toBe(AuthChallengePurpose.VERIFY_EMAIL)
  })

  it('lets a pending account resume email verification after password authentication', async () => {
    users.findUnique.mockResolvedValue({ ...user, status: UserStatus.PENDING })
    const result = await service.login({ email: user.email, password: 'Password1!' })
    expect(result).toHaveProperty('verificationRequired', true)
    expect(jwt.signAsync).not.toHaveBeenCalled()
  })

  it.each([UserStatus.SUSPENDED, UserStatus.REVOKED, UserStatus.INVITED])('blocks login for %s', async (status) => {
    users.findUnique.mockResolvedValue({ ...user, status })
    await expect(service.login({ email: user.email, password: 'Password1!' })).rejects.toThrow()
    expect(jwt.signAsync).not.toHaveBeenCalled()
  })

  it('rejects refresh tokens invalidated by a password reset or logout', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: user.id, version: 1 })
    await expect(service.refresh('old-refresh')).rejects.toThrow('Invalid or expired')
    expect(jwt.signAsync).not.toHaveBeenCalled()
  })

  it('does not disclose unknown accounts during recovery', async () => {
    users.findUnique.mockResolvedValue(null)
    const result = await service.requestPasswordReset('unknown@example.com')
    expect(Object.keys(result).sort()).toEqual(['expiresAt', 'id', 'identifier', 'resendAt'])
    expect(notifications.sendEmail).not.toHaveBeenCalled()
  })

  it('does not send another code during the resend cooldown', async () => {
    await service.requestPasswordReset(user.email)
    expect(notifications.sendEmail).not.toHaveBeenCalled()
  })

  it('lets a pending public account recover its password while keeping email verification required', async () => {
    users.findUnique.mockResolvedValue({ ...user, status: UserStatus.PENDING })
    const requested = await service.requestPasswordReset(user.email)
    expect(requested.id).toBe(challenge.id)
    challenges.findUnique.mockResolvedValue({ ...challenge, resetTokenHash: 'verified-hash' })
    await service.resetPassword({ challengeId: challenge.id, resetToken: 'verified-token', password: 'Password2!' })
    expect(users.updateMany).toHaveBeenCalledWith({
      where: { id: user.id, status: { in: [UserStatus.ACTIVE, UserStatus.PENDING] } },
      data: { passwordHash: 'hash', refreshTokenHash: null, sessionVersion: { increment: 1 } },
    })
    expect(users.updateMany.mock.calls[0][0].data).not.toHaveProperty('status')
  })

  it('rejects an exhausted code challenge before issuing a reset token', async () => {
    challenges.updateMany.mockResolvedValue({ count: 0 })
    await expect(service.verifyPasswordReset({ challengeId: challenge.id, code: '123456' })).rejects.toThrow('attempt limit')
    expect(argon2.verify).not.toHaveBeenCalled()
  })

  it('rejects a verification code used for the wrong purpose', async () => {
    challenges.findUnique.mockResolvedValue({ ...challenge, purpose: AuthChallengePurpose.VERIFY_EMAIL })
    await expect(service.verifyPasswordReset({ challengeId: challenge.id, code: '123456' })).rejects.toThrow('invalid')
    expect(challenges.updateMany).not.toHaveBeenCalled()
  })

  it('requires a verified reset token before changing a password', async () => {
    await expect(service.resetPassword({ challengeId: challenge.id, resetToken: 'unverified', password: 'Password2!' })).rejects.toThrow('invalid')
    expect(users.updateMany).not.toHaveBeenCalled()
  })

  it('consumes reset authorization and invalidates access and refresh sessions', async () => {
    challenges.findUnique.mockResolvedValue({ ...challenge, resetTokenHash: 'verified-hash' })
    await service.resetPassword({ challengeId: challenge.id, resetToken: 'verified-token', password: 'Password2!' })
    expect(challenges.deleteMany).toHaveBeenCalledTimes(1)
    expect(users.updateMany).toHaveBeenCalledWith({ where: { id: user.id, status: { in: [UserStatus.ACTIVE, UserStatus.PENDING] } }, data: { passwordHash: 'hash', refreshTokenHash: null, sessionVersion: { increment: 1 } } })
  })

  it('prevents reuse when another request already consumed the reset token', async () => {
    challenges.findUnique.mockResolvedValue({ ...challenge, resetTokenHash: 'verified-hash' })
    challenges.deleteMany.mockResolvedValue({ count: 0 })
    await expect(service.resetPassword({ challengeId: challenge.id, resetToken: 'verified-token', password: 'Password2!' })).rejects.toThrow('invalid')
    expect(users.updateMany).not.toHaveBeenCalled()
  })

  it('rejects an invalid profile timezone', async () => {
    await expect(service.updateProfile(user.id, { firstName: 'Ada', lastName: 'Eze', phone: '+2348012345678', country: 'Nigeria', timezone: 'Not/AZone' })).rejects.toThrow('valid time zone')
    expect(users.update).not.toHaveBeenCalled()
  })
})
