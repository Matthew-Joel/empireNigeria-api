import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { AuthModule } from '../auth/auth.module'
import { StorageModule } from '../storage/storage.module'
import { InspectionsController } from './inspections.controller'
import { InspectionsService } from './inspections.service'

@Module({
  imports: [AuthModule, JwtModule.register({}), StorageModule],
  controllers: [InspectionsController],
  providers: [InspectionsService, JwtAuthGuard, RolesGuard],
})
export class InspectionsModule {}
