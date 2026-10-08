import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PropertyStatus, User, UserProfile, UserRole, UserStatus } from '@prisma/client'
import { randomBytes } from 'node:crypto'
import * as argon2 from 'argon2'
import { PrismaService } from '../../database/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'
import { CreateStaffInvitationDto } from './dto/create-staff-invitation.dto'

type UserWithProfile = User & { profile: UserProfile | null }

const STAFF_ROLES = [
  UserRole.PROPERTY_MANAGER,
  UserRole.INSPECTOR,
  UserRole.CONTRACTOR,
]

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  async overview() {
    const [totalUsers, invitedStaff, pendingVerification, totalProperties, reviewQueue, inspectionPending, recentUsers, recentProperties] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: UserStatus.INVITED } }),
      this.prisma.user.count({ where: { status: UserStatus.PENDING } }),
      this.prisma.property.count(),
      this.prisma.property.count({ where: { status: { in: [PropertyStatus.SUBMITTED, PropertyStatus.UNDER_REVIEW, PropertyStatus.CHANGES_REQUESTED] } } }),
      this.prisma.property.count({ where: { status: PropertyStatus.INSPECTION_PENDING } }),
      this.prisma.user.findMany({ take: 5, orderBy: { createdAt: 'desc' }, select: { id: true, email: true, role: true, status: true, createdAt: true, profile: { select: { firstName: true, lastName: true } } } }),
      this.prisma.property.findMany({ take: 5, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, status: true, createdAt: true, owner: { select: { email: true } } } }),
    ])
    return { totalUsers, invitedStaff, pendingVerification, totalProperties, reviewQueue, inspectionPending, recentUsers, recentProperties }
  }

  async analytics() {
    const start = new Date()
    start.setUTCDate(1)
    start.setUTCHours(0, 0, 0, 0)
    start.setUTCMonth(start.getUTCMonth() - 5)
    type MonthlyCount = { month: string; count: number }
    const [properties, inspections, maintenance, completed, maintenanceStatuses] = await Promise.all([
      this.prisma.$queryRaw<MonthlyCount[]>`SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS month, count(*)::int AS count FROM "properties" WHERE "createdAt" >= ${start} GROUP BY 1`,
      this.prisma.$queryRaw<MonthlyCount[]>`SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS month, count(*)::int AS count FROM "inspections" WHERE "createdAt" >= ${start} GROUP BY 1`,
      this.prisma.$queryRaw<MonthlyCount[]>`SELECT to_char(date_trunc('month', "reportedAt"), 'YYYY-MM') AS month, count(*)::int AS count FROM "maintenance_requests" WHERE "reportedAt" >= ${start} GROUP BY 1`,
      this.prisma.$queryRaw<MonthlyCount[]>`SELECT to_char(date_trunc('month', "completedAt"), 'YYYY-MM') AS month, count(*)::int AS count FROM "maintenance_requests" WHERE "completedAt" >= ${start} GROUP BY 1`,
      this.prisma.maintenanceRequest.groupBy({ by: ['status'], _count: { _all: true } }),
    ])
    const find = (rows: MonthlyCount[], month: string) => rows.find((row) => row.month === month)?.count ?? 0
    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1))
      const month = date.toISOString().slice(0, 7)
      return { month, label: new Intl.DateTimeFormat('en-NG', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(date), properties: find(properties, month), inspections: find(inspections, month), maintenance: find(maintenance, month), completed: find(completed, month) }
    })
    return { months, maintenanceStatuses: maintenanceStatuses.map((item) => ({ status: item.status, count: item._count._all })) }
  }

  async auditLog(filters: { cursor?: string; action?: string; entityType?: string }) {
    if (filters.cursor && !/^[0-9a-f-]{36}$/i.test(filters.cursor)) throw new BadRequestException('Invalid audit cursor')
    const records = await this.prisma.auditEvent.findMany({
      where: {
        ...(filters.action ? { action: { contains: filters.action.trim().slice(0, 80), mode: 'insensitive' as const } } : {}),
        ...(filters.entityType ? { entityType: filters.entityType.trim().toUpperCase().slice(0, 40) } : {}),
      },
      include: { actor: { select: { email: true, profile: { select: { firstName: true, lastName: true } } } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    })
    const items = records.slice(0, 50).map((item) => ({ id: item.id, action: item.action, actorRole: item.actorRole, actorEmail: item.actor?.email ?? null, actorName: item.actor?.profile ? `${item.actor.profile.firstName} ${item.actor.profile.lastName}` : item.actor?.email ?? 'Deleted account', entityType: item.entityType, entityId: item.entityId, summary: item.summary, createdAt: item.createdAt }))
    return { items, nextCursor: records.length > 50 ? items.at(-1)?.id ?? null : null }
  }

  async listUsers(filters: { role?: string; status?: string; search?: string }) {
    const role = Object.values(UserRole).includes(filters.role as UserRole)
      ? (filters.role as UserRole)
      : undefined
    const status = Object.values(UserStatus).includes(filters.status as UserStatus)
      ? (filters.status as UserStatus)
      : undefined
    const search = filters.search?.trim()
    const users = await this.prisma.user.findMany({
      where: {
        role,
        status,
        ...(search
          ? {
              OR: [
                { email: { contains: search, mode: 'insensitive' } },
                {
                  profile: {
                    is: {
                      OR: [
                        { firstName: { contains: search, mode: 'insensitive' } },
                        { lastName: { contains: search, mode: 'insensitive' } },
                      ],
                    },
                  },
                },
              ],
            }
          : {}),
      },
      include: { profile: true },
      orderBy: { createdAt: 'desc' },
    })
    return users.map((user) => this.toAdminUser(user))
  }

  async createInvitation(dto: CreateStaffInvitationDto, adminId: string) {
    if (!STAFF_ROLES.some((role) => role === dto.role)) {
      throw new BadRequestException(
        'Only property managers, inspectors, and contractors can be invited',
      )
    }

    const email = dto.email.trim().toLowerCase()
    const existing = await this.prisma.user.findUnique({ where: { email } })
    if (existing) {
      throw new ConflictException('An account with this email already exists')
    }

    const user = await this.prisma.user.create({
      data: {
        email,
        phone: dto.phone?.trim() || undefined,
        passwordHash: await argon2.hash(randomBytes(32).toString('hex')),
        role: dto.role,
        status: UserStatus.INVITED,
        invitedAt: new Date(),
        invitedBy: { connect: { id: adminId } },
        profile: {
          create: {
            firstName: dto.firstName.trim(),
            lastName: dto.lastName.trim(),
          },
        },
      },
      include: { profile: true },
    })
    await this.prisma.auditEvent.create({ data: { actorId: adminId, actorRole: UserRole.ADMIN, action: 'STAFF_INVITED', entityType: 'USER', entityId: user.id, summary: `Administrator invited a ${user.role.toLowerCase().replaceAll('_', ' ')}` } })
    const invitation = await this.prepareInvitation(user.id)
    await this.sendInvitationEmail(user, invitation.token)
    return {
      message: 'Invitation created and sent.',
      user: this.toAdminUser({
        ...user,
        invitationExpiresAt: invitation.expiresAt,
      }),
    }
  }

  async resendInvitation(userId: string, adminId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    })
    if (!user || user.status !== UserStatus.INVITED) {
      throw new NotFoundException('An active invitation was not found')
    }
    const invitation = await this.prepareInvitation(user.id)
    await this.sendInvitationEmail(user, invitation.token)
    if (adminId) await this.prisma.auditEvent.create({ data: { actorId: adminId, actorRole: UserRole.ADMIN, action: 'INVITATION_RESENT', entityType: 'USER', entityId: userId, summary: 'Administrator resent a staff invitation' } })
    return { message: 'Invitation resent.' }
  }

  async revokeInvitation(userId: string, adminId?: string) {
    const result = await this.prisma.user.updateMany({
      where: { id: userId, status: UserStatus.INVITED },
      data: {
        status: UserStatus.REVOKED,
        invitationTokenHash: null,
        invitationExpiresAt: null,
        refreshTokenHash: null,
      },
    })
    if (result.count === 0) {
      throw new NotFoundException('An active invitation was not found')
    }
    if (adminId) await this.prisma.auditEvent.create({ data: { actorId: adminId, actorRole: UserRole.ADMIN, action: 'INVITATION_REVOKED', entityType: 'USER', entityId: userId, summary: 'Administrator revoked a staff invitation' } })
    return { message: 'Invitation revoked.' }
  }

  private async prepareInvitation(userId: string) {
    const token = userId + '.' + randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const result = await this.prisma.user.updateMany({
      where: { id: userId, status: UserStatus.INVITED },
      data: {
        invitationTokenHash: await argon2.hash(token),
        invitationExpiresAt: expiresAt,
        invitedAt: new Date(),
      },
    })
    if (result.count !== 1) {
      throw new NotFoundException('An active invitation was not found')
    }
    return { token, expiresAt }
  }

  private async sendInvitationEmail(user: UserWithProfile, token: string) {
    const appUrl = (
      this.config.get<string>('APP_URL') ?? 'http://localhost:5173'
    ).replace(/\/$/, '')
    const invitationUrl =
      appUrl + '/accept-invitation?token=' + encodeURIComponent(token)
    const firstName = this.escapeHtml(user.profile?.firstName ?? 'there')
    const delivery = await this.notifications.sendEmail({
      to: user.email,
      subject: 'Your empireNigeria account invitation',
      text:
        'Hello ' +
        (user.profile?.firstName ?? 'there') +
        ', use this link to set up your empireNigeria account: ' +
        invitationUrl +
        '. The link expires in 24 hours.',
      html:
        '<p>Hello ' +
        firstName +
        ',</p><p>An administrator created an empireNigeria account for you as a <strong>' +
        user.role.replaceAll('_', ' ').toLowerCase() +
        '</strong>.</p><p><a href="' +
        invitationUrl +
        '">Set up your account</a></p><p>This link expires in 24 hours.</p>',
    })
    if (!delivery.sent) {
      throw new ServiceUnavailableException(
        'Invitation saved, but email delivery is not configured. Configure Resend and resend the invitation.',
      )
    }
  }

  private toAdminUser(user: UserWithProfile) {
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
      invitedAt: user.invitedAt,
      invitationExpiresAt: user.invitationExpiresAt,
      invitedById: user.invitedById,
      profile: user.profile
        ? { firstName: user.profile.firstName, lastName: user.profile.lastName }
        : null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }
  }

  private escapeHtml(value: string) {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;')
  }
}
