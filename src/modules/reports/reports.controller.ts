import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { UserRole } from '@prisma/client'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { AuthenticatedRequest } from '../../common/types/request-with-user'
import { ReportsService } from './reports.service'
type Actor = AuthenticatedRequest['user']
@Controller('reports') @UseGuards(JwtAuthGuard, RolesGuard) @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.PROPERTY_MANAGER)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}
  @Get() summary(@CurrentUser() actor: Actor, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.summary(actor, { from, to })
  }
}
