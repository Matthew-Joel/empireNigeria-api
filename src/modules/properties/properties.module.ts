import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { AuthModule } from '../auth/auth.module'
import { PropertiesController } from './properties.controller'
import { PropertiesService } from './properties.service'
import { NotificationsModule } from '../notifications/notifications.module'
import { StorageModule } from '../storage/storage.module'

@Module({
  imports: [AuthModule, JwtModule.register({}), StorageModule, NotificationsModule],
  controllers: [PropertiesController],
  providers: [PropertiesService, JwtAuthGuard, RolesGuard],
})
export class PropertiesModule {}
