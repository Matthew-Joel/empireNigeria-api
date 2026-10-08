import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { UserRole, UserStatus } from '@prisma/client'
import { PrismaService } from '../../database/prisma.service'
import { AuthenticatedRequest } from '../types/request-with-user'

interface AccessTokenPayload {
  sub: string
  email: string
  role: UserRole
  version?: number
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const authorization = request.headers.authorization

    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Bearer token is required')
    }

    const token = authorization.slice('Bearer '.length).trim()

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      })

      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } })
      if (!user || user.status !== UserStatus.ACTIVE || user.sessionVersion !== (payload.version ?? 0)) {
        throw new UnauthorizedException('Your session has ended. Please sign in again.')
      }
      request.user = { sub: user.id, email: user.email, role: user.role }
      return true
    } catch {
      throw new UnauthorizedException('Invalid or expired access token')
    }
  }
}
