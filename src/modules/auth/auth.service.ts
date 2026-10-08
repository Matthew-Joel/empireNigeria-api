import { BadRequestException, ConflictException, ForbiddenException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { AuthChallenge, AuthChallengePurpose, Prisma, User, UserProfile, UserRole, UserStatus } from '@prisma/client'
import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import * as argon2 from 'argon2'
import { PrismaService } from '../../database/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'
import { AcceptInvitationDto } from './dto/accept-invitation.dto'
import { ChallengeCodeDto, ResetPasswordDto, UpdateProfileDto } from './dto/account.dto'
import { LoginDto } from './dto/login.dto'
import { RegisterDto } from './dto/register.dto'

type UserWithProfile = User & { profile: UserProfile | null }
interface TokenPayload { sub: string; email: string; role: UserRole; version: number }
const CODE_LIFETIME = 15 * 60_000
const RESEND_DELAY = 60_000
// These transactions contain only database work; allow bounded hosted-DB latency.
const AUTH_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 30_000 }

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  async register(dto: RegisterDto) {
    if (dto.role !== UserRole.OWNER && dto.role !== UserRole.GUEST) {
      throw new ForbiddenException('Only property owners and guests can register publicly')
    }
    const email = dto.email.trim().toLowerCase()
    const existing = await this.prisma.user.findUnique({ where: { email } })
    if (existing) throw new ConflictException('An account with this email already exists. Sign in to continue or recover your password.')
    let user: UserWithProfile
    try {
      user = await this.prisma.user.create({
        data: {
          email, phone: dto.phone?.trim() || undefined,
          passwordHash: await argon2.hash(dto.password),
          role: dto.role, status: UserStatus.PENDING,
          profile: { create: { firstName: dto.firstName.trim(), lastName: dto.lastName.trim() } },
        },
        include: { profile: true },
      })
    } catch (error) { this.rethrowConflict(error) }
    const challenge = await this.createChallenge(user, AuthChallengePurpose.VERIFY_EMAIL)
    return { verificationRequired: true, user: this.toPublicUser(user), challenge }
  }

  async requestVerification(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, include: { profile: true } })
    if (!user || user.status !== UserStatus.PENDING) return this.emptyChallenge(email)
    return this.createChallenge(user, AuthChallengePurpose.VERIFY_EMAIL)
  }

  async verify(dto: ChallengeCodeDto) {
    const challenge = await this.checkCode(dto, AuthChallengePurpose.VERIFY_EMAIL)
    const user = await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.authChallenge.deleteMany({ where: { id: challenge.id, codeHash: challenge.codeHash, expiresAt: { gt: new Date() } } })
      if (consumed.count !== 1) throw this.invalidCode()
      const updated = await tx.user.updateMany({
        where: { id: challenge.userId, status: UserStatus.PENDING },
        data: { status: UserStatus.ACTIVE, emailVerifiedAt: new Date(), verificationCodeHash: null, verificationExpiresAt: null },
      })
      if (updated.count !== 1) throw this.invalidCode()
      return tx.user.findUniqueOrThrow({ where: { id: challenge.userId }, include: { profile: true } })
    }, AUTH_TRANSACTION_OPTIONS)
    return this.issueTokens(user)
  }

  async requestPasswordReset(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, include: { profile: true } })
    if (!user || (user.status !== UserStatus.ACTIVE && user.status !== UserStatus.PENDING)) return this.emptyChallenge(email)
    const challenge = await this.createChallenge(user, AuthChallengePurpose.RESET_PASSWORD)
    const { deliveryError: _deliveryError, ...publicChallenge } = challenge
    return publicChallenge
  }

  async verifyPasswordReset(dto: ChallengeCodeDto) {
    const challenge = await this.checkCode(dto, AuthChallengePurpose.RESET_PASSWORD)
    const resetToken = randomBytes(32).toString('hex')
    const result = await this.prisma.authChallenge.updateMany({
      where: { id: challenge.id, resetTokenHash: null, expiresAt: { gt: new Date() } },
      data: { resetTokenHash: await argon2.hash(resetToken) },
    })
    if (result.count !== 1) throw this.invalidCode()
    return { resetToken }
  }

  async resetPassword(dto: ResetPasswordDto) {
    const challenge = await this.prisma.authChallenge.findUnique({ where: { id: dto.challengeId } })
    if (!challenge || challenge.purpose !== AuthChallengePurpose.RESET_PASSWORD || !challenge.resetTokenHash || challenge.expiresAt <= new Date()) throw this.invalidCode()
    if (!(await argon2.verify(challenge.resetTokenHash, dto.resetToken))) throw this.invalidCode()
    const passwordHash = await argon2.hash(dto.password)
    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.authChallenge.deleteMany({ where: { id: challenge.id, resetTokenHash: challenge.resetTokenHash, expiresAt: { gt: new Date() } } })
      if (consumed.count !== 1) throw this.invalidCode()
      const result = await tx.user.updateMany({
        where: { id: challenge.userId, status: { in: [UserStatus.ACTIVE, UserStatus.PENDING] } },
        data: { passwordHash, refreshTokenHash: null, sessionVersion: { increment: 1 } },
      })
      if (result.count !== 1) throw this.invalidCode()
    }, AUTH_TRANSACTION_OPTIONS)
    return { message: 'Your password has been updated. Sign in with your new password.' }
  }

  async acceptInvitation(dto: AcceptInvitationDto) {
    const separator = dto.token.indexOf('.')
    const userId = separator > 0 ? dto.token.slice(0, separator) : ''
    if (!userId) throw new UnauthorizedException('This invitation link is invalid')
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { profile: true } })
    if (!user || user.status !== UserStatus.INVITED || !user.invitationTokenHash || !user.invitationExpiresAt || user.invitationExpiresAt <= new Date()) {
      throw new UnauthorizedException('This invitation link is invalid or has expired')
    }
    if (!(await argon2.verify(user.invitationTokenHash, dto.token))) throw new UnauthorizedException('This invitation link is invalid or has expired')
    const passwordHash = await argon2.hash(dto.password)
    const acceptedAt = new Date()
    const result = await this.prisma.user.updateMany({
      where: { id: user.id, status: UserStatus.INVITED, invitationTokenHash: user.invitationTokenHash, invitationExpiresAt: { gt: acceptedAt } },
      data: { passwordHash, status: UserStatus.ACTIVE, emailVerifiedAt: acceptedAt, invitationTokenHash: null, invitationExpiresAt: null },
    })
    if (result.count !== 1) throw new UnauthorizedException('This invitation link is invalid or has expired')
    const acceptedUser = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { profile: true } })
    return this.issueTokens(acceptedUser)
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.trim().toLowerCase() }, include: { profile: true } })
    if (!user || !(await argon2.verify(user.passwordHash, dto.password))) throw new UnauthorizedException('Email or password is incorrect')
    if (dto.role && dto.role !== user.role) throw new ForbiddenException('The selected role is not assigned to this account')
    if (user.status === UserStatus.PENDING) return { verificationRequired: true, user: this.toPublicUser(user) }
    if (user.status === UserStatus.INVITED) throw new ForbiddenException('Complete your invitation before logging in')
    if (user.status !== UserStatus.ACTIVE) throw new ForbiddenException('This account does not currently have access')
    return this.issueTokens(user)
  }

  async refresh(refreshToken: string) {
    let payload: TokenPayload
    try { payload = await this.jwt.verifyAsync<TokenPayload>(refreshToken, { secret: this.requiredConfig('JWT_REFRESH_SECRET') }) }
    catch { throw new UnauthorizedException('Invalid or expired refresh token') }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, include: { profile: true } })
    if (!user || user.status !== UserStatus.ACTIVE || (payload.version ?? 0) !== user.sessionVersion || !user.refreshTokenHash || !(await argon2.verify(user.refreshTokenHash, refreshToken))) {
      throw new UnauthorizedException('Invalid or expired refresh token')
    }
    return this.issueTokens(user, user.refreshTokenHash)
  }

  async logout(userId: string) {
    await this.prisma.user.updateMany({ where: { id: userId }, data: { refreshTokenHash: null, sessionVersion: { increment: 1 } } })
    return { message: 'Signed out successfully' }
  }

  async getCurrentUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { profile: true } })
    if (!user || user.status !== UserStatus.ACTIVE) throw new UnauthorizedException('This account does not currently have access')
    return this.toPublicUser(user)
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    try { new Intl.DateTimeFormat('en', { timeZone: dto.timezone }).format() }
    catch { throw new BadRequestException('Choose a valid time zone') }
    try {
      const user = await this.prisma.user.update({
        where: { id: userId, status: UserStatus.ACTIVE },
        data: {
          phone: dto.phone.trim(),
          profile: { upsert: {
            create: { firstName: dto.firstName, lastName: dto.lastName, country: dto.country, timezone: dto.timezone },
            update: { firstName: dto.firstName, lastName: dto.lastName, country: dto.country, timezone: dto.timezone },
          } },
        },
        include: { profile: true },
      })
      return this.toPublicUser(user)
    } catch (error) { this.rethrowConflict(error) }
  }

  private async createChallenge(user: UserWithProfile, purpose: AuthChallengePurpose) {
    const now = new Date()
    const existing = await this.prisma.authChallenge.findUnique({ where: { userId_purpose: { userId: user.id, purpose } } })
    if (existing && existing.resendAt > now) return { ...this.publicChallenge(existing, user.email), deliveryError: undefined as string | undefined }
    const code = String(randomInt(100000, 1000000))
    const data = {
      id: randomUUID(), codeHash: await argon2.hash(code),
      expiresAt: new Date(now.getTime() + CODE_LIFETIME), resendAt: new Date(now.getTime() + RESEND_DELAY),
      attempts: 0, resetTokenHash: null, createdAt: now,
    }
    const challenge = await this.prisma.authChallenge.upsert({
      where: { userId_purpose: { userId: user.id, purpose } },
      create: { ...data, userId: user.id, purpose }, update: data,
    })
    let deliveryError: string | undefined
    const action = purpose === AuthChallengePurpose.VERIFY_EMAIL ? 'verify your email' : 'reset your password'
    try {
      const delivery = await this.notifications.sendEmail({
        to: user.email,
        subject: purpose === AuthChallengePurpose.VERIFY_EMAIL ? 'Verify your empireNigeria account' : 'Reset your empireNigeria password',
        text: 'Hello ' + (user.profile?.firstName ?? 'there') + ', use ' + code + ' to ' + action + '. This code expires in 15 minutes. If you did not request it, ignore this email.',
        html: '<p>Hello ' + this.escapeHtml(user.profile?.firstName ?? 'there') + ',</p><p>Use <strong>' + code + '</strong> to ' + action + '.</p><p>This code expires in 15 minutes. If you did not request it, ignore this email.</p>',
      })
      if (!delivery.sent) throw new ServiceUnavailableException('Email delivery is not configured')
    } catch {
      deliveryError = 'Your account is saved, but the email could not be sent. Please use Resend code to try again.'
    }
    return { ...this.publicChallenge(challenge, user.email), deliveryError }
  }

  private async checkCode(dto: ChallengeCodeDto, purpose: AuthChallengePurpose) {
    const challenge = await this.prisma.authChallenge.findUnique({ where: { id: dto.challengeId } })
    if (!challenge || challenge.purpose !== purpose || challenge.resetTokenHash || challenge.expiresAt <= new Date()) throw this.invalidCode()
    const reserved = await this.prisma.authChallenge.updateMany({
      where: { id: challenge.id, purpose, expiresAt: { gt: new Date() }, attempts: { lt: 5 }, resetTokenHash: null },
      data: { attempts: { increment: 1 } },
    })
    if (reserved.count !== 1 || !(await argon2.verify(challenge.codeHash, dto.code))) throw this.invalidCode()
    return challenge
  }

  private publicChallenge(challenge: AuthChallenge, email: string) {
    return { id: challenge.id, identifier: email, expiresAt: challenge.expiresAt.getTime(), resendAt: challenge.resendAt.getTime() }
  }

  private emptyChallenge(email: string) {
    return { id: randomUUID(), identifier: email.trim().toLowerCase(), expiresAt: Date.now() + CODE_LIFETIME, resendAt: Date.now() + RESEND_DELAY }
  }

  private invalidCode() { return new UnauthorizedException('The code is invalid, expired, or has reached its attempt limit. Request a new code.') }

  private async issueTokens(user: UserWithProfile, expectedRefreshHash?: string) {
    const version = user.sessionVersion ?? 0
    const payload: TokenPayload = { sub: user.id, email: user.email, role: user.role, version }
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.requiredConfig('JWT_ACCESS_SECRET'), jwtid: randomUUID(),
      expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m') as any,
    })
    const refreshToken = await this.jwt.signAsync(payload, {
      secret: this.requiredConfig('JWT_REFRESH_SECRET'), jwtid: randomUUID(),
      expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '7d') as any,
    })
    const result = await this.prisma.user.updateMany({
      where: { id: user.id, status: UserStatus.ACTIVE, sessionVersion: version, ...(expectedRefreshHash ? { refreshTokenHash: expectedRefreshHash } : {}) },
      data: { refreshTokenHash: await argon2.hash(refreshToken) },
    })
    if (result.count !== 1) throw new UnauthorizedException('Your session has ended. Please sign in again.')
    return { accessToken, refreshToken, user: this.toPublicUser(user) }
  }

  private toPublicUser(user: UserWithProfile) {
    return {
      id: user.id, email: user.email, phone: user.phone, role: user.role, status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
      profile: user.profile ? { firstName: user.profile.firstName, lastName: user.profile.lastName, country: user.profile.country ?? 'Nigeria', timezone: user.profile.timezone ?? 'Africa/Lagos' } : null,
      createdAt: user.createdAt,
    }
  }

  private rethrowConflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('An account already uses this email address or phone number')
    throw error
  }

  private escapeHtml(value: string) {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  }

  private requiredConfig(key: string) {
    const value = this.config.get<string>(key)
    if (!value) throw new Error('Missing required configuration: ' + key)
    return value
  }
}
