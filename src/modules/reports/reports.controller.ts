import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger'
import { UserRole } from '@prisma/client'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { AuthenticatedRequest } from '../../common/types/request-with-user'
import { ReportsService } from './reports.service'
type Actor = AuthenticatedRequest['user']
@ApiTags('Reports') @ApiBearerAuth()
@Controller('reports') @UseGuards(JwtAuthGuard, RolesGuard) @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.PROPERTY_MANAGER)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}
  @ApiQuery({ name: 'from', required: false, format: 'date', description: 'YYYY-MM-DD (Africa/Lagos). Defaults to the first day of the month five months before to.' })
  @ApiQuery({ name: 'to', required: false, format: 'date', description: 'YYYY-MM-DD (Africa/Lagos). Defaults to today. Range must be 1-366 days.' })
  @Get() summary(@CurrentUser() actor: Actor, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.summary(actor, { from, to })
  }
}
