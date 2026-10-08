import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { UserRole } from '@prisma/client'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { AuthenticatedRequest } from '../../common/types/request-with-user'
import { Roles } from '../../common/decorators/roles.decorator'
import { AdminService } from './admin.service'
import { CreateStaffInvitationDto } from './dto/create-staff-invitation.dto'

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('access')
  access() {
    return { message: 'Administrator access confirmed' }
  }

  @Get('overview')
  overview() {
    return this.adminService.overview()
  }

  @Get('analytics')
  analytics() { return this.adminService.analytics() }

  @Get('audit')
  audit(@Query('cursor') cursor?: string, @Query('action') action?: string, @Query('entityType') entityType?: string) {
    return this.adminService.auditLog({ cursor, action, entityType })
  }

  @Get('users')
  users(
    @Query('role') role?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.adminService.listUsers({ role, status, search })
  }

  @Post('invitations')
  createInvitation(
    @Body() dto: CreateStaffInvitationDto,
    @CurrentUser() user: AuthenticatedRequest['user'],
  ) {
    return this.adminService.createInvitation(dto, user.sub)
  }

  @Post('invitations/:id/resend')
  resendInvitation(@Param('id', ParseUUIDPipe) userId: string, @CurrentUser() user: AuthenticatedRequest['user']) {
    return this.adminService.resendInvitation(userId, user.sub)
  }

  @Post('invitations/:id/revoke')
  revokeInvitation(@Param('id', ParseUUIDPipe) userId: string, @CurrentUser() user: AuthenticatedRequest['user']) {
    return this.adminService.revokeInvitation(userId, user.sub)
  }
}
