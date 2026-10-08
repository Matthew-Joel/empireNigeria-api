import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common'
import { Request } from 'express'

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  private readonly windows = new Map<string, { count: number; expiresAt: number }>()

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>()
    if (request.method !== 'POST') return true
    const now = Date.now()
    for (const [key, value] of this.windows) {
      if (value.expiresAt <= now) this.windows.delete(key)
    }
    const key = `${request.ip}:${request.path}`
    const window = this.windows.get(key) ?? { count: 0, expiresAt: now + 60_000 }
    window.count += 1
    this.windows.set(key, window)
    if (window.count > 15) {
      throw new HttpException('Too many attempts. Please wait a minute and try again.', HttpStatus.TOO_MANY_REQUESTS)
    }
    return true
  }
}
