import { ConfigModule } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PrismaModule } from '../database/prisma.module'
import { PrismaService } from '../database/prisma.service'
import { BookingsModule } from './bookings/bookings.module'
import { BookingsService } from './bookings/bookings.service'
import { FinancialsModule } from './financials/financials.module'
import { FinancialsService } from './financials/financials.service'
import { NotificationsService } from './notifications/notifications.service'
import { OccupancyModule } from './occupancy/occupancy.module'
import { OccupancyService } from './occupancy/occupancy.service'
import { ReportsModule } from './reports/reports.module'
import { ReportsService } from './reports/reports.service'
import { StayModule } from './stay/stay.module'
import { StayService } from './stay/stay.service'
import { SupabaseStorageService } from './storage/supabase-storage.service'
import { TasksModule } from './tasks/tasks.module'
import { TasksService } from './tasks/tasks.service'

describe('Application feature module bootstrap', () => {
  it('resolves authentication guards in every new feature module without external services', async () => {
    const database = { $connect: jest.fn(), $disconnect: jest.fn() }
    const email = { sendEmail: jest.fn() }
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PrismaModule,
        BookingsModule,
        StayModule,
        TasksModule,
        OccupancyModule,
        FinancialsModule,
        ReportsModule,
      ],
    })
      .overrideProvider(PrismaService).useValue(database)
      .overrideProvider(NotificationsService).useValue(email)
      .overrideProvider(SupabaseStorageService).useValue({})
      .compile()

    try {
      await module.init()
      expect(module.get(JwtService)).toBeInstanceOf(JwtService)
      expect(module.get(JwtAuthGuard)).toBeInstanceOf(JwtAuthGuard)
      for (const service of [BookingsService, StayService, TasksService, OccupancyService, FinancialsService, ReportsService]) {
        expect(module.get(service)).toBeInstanceOf(service)
      }
      expect(database.$connect).not.toHaveBeenCalled()
      expect(email.sendEmail).not.toHaveBeenCalled()
    } finally {
      await module.close()
    }
  })
})
