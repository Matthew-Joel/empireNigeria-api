import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { AuthModule } from '../auth/auth.module'
import { StorageModule } from '../storage/storage.module'
import { MaintenanceController } from './maintenance.controller'
import { MaintenanceService } from './maintenance.service'

@Module({
  imports: [AuthModule, JwtModule.register({}), StorageModule],
  controllers: [MaintenanceController],
  providers: [MaintenanceService, JwtAuthGuard, RolesGuard],
})
export class MaintenanceModule {}
