import { Module } from '@nestjs/common'
import { AuthRateLimitGuard } from '../auth/auth-rate-limit.guard'
import { NotificationsModule } from '../notifications/notifications.module'
import { ContactController } from './contact.controller'
import { ContactService } from './contact.service'

@Module({ imports: [NotificationsModule], controllers: [ContactController], providers: [ContactService, AuthRateLimitGuard] })
export class ContactModule {}
