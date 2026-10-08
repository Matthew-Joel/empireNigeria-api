import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { StorageModule } from '../storage/storage.module'
import { StayController } from './stay.controller'
import { StayService } from './stay.service'

@Module({ imports: [AuthModule, StorageModule], controllers: [StayController], providers: [StayService] })
export class StayModule {}
