import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { FinancialsController } from './financials.controller'
import { FinancialsService } from './financials.service'
@Module({ imports: [AuthModule], controllers: [FinancialsController], providers: [FinancialsService] })
export class FinancialsModule {}
