import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AuthModule } from './modules/auth/auth.module'
import { HealthModule } from './modules/health/health.module'
import { AdminModule } from './modules/admin/admin.module'
import { PrismaModule } from './database/prisma.module'
import { validateEnv } from './config/env.validation'
import { PropertiesModule } from './modules/properties/properties.module'
import { InspectionsModule } from './modules/inspections/inspections.module'
import { MaintenanceModule } from './modules/maintenance/maintenance.module'
import { StayModule } from './modules/stay/stay.module'
import { BookingsModule } from './modules/bookings/bookings.module'
import { TasksModule } from './modules/tasks/tasks.module'
import { OccupancyModule } from './modules/occupancy/occupancy.module'
import { FinancialsModule } from './modules/financials/financials.module'
import { ReportsModule } from './modules/reports/reports.module'
import { ContactModule } from './modules/contact/contact.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    PrismaModule,
    AuthModule,
    AdminModule,
    HealthModule,
    PropertiesModule,
    InspectionsModule,
    MaintenanceModule,
    StayModule,
    BookingsModule,
    TasksModule,
    OccupancyModule,
    FinancialsModule,
    ReportsModule,
    ContactModule,
  ],
})
export class AppModule {}
