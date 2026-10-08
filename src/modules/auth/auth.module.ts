import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { NotificationsModule } from '../notifications/notifications.module'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { AuthRateLimitGuard } from './auth-rate-limit.guard'
import { StorageModule } from '../storage/storage.module'
import { ProfileImageController } from './profile-image.controller'
import { ProfileImageService } from './profile-image.service'

@Module({
  imports: [JwtModule.register({}), NotificationsModule, StorageModule],
  controllers: [AuthController, ProfileImageController],
  providers: [AuthService, JwtAuthGuard, RolesGuard, AuthRateLimitGuard, ProfileImageService],
  exports: [JwtModule, AuthService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
