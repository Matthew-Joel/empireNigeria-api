import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { UserRole } from '@prisma/client'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { AuthenticatedRequest } from '../../common/types/request-with-user'
import { ConfirmInspectionAccessDto, RescheduleInspectionDto, ScheduleInspectionDto, StartInspectionEvidenceDto, SubmitInspectionReportDto } from './dto/inspection.dto'
import { InspectionsService } from './inspections.service'

type Actor = AuthenticatedRequest['user']

@Controller('inspections')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.PROPERTY_MANAGER, UserRole.INSPECTOR)
export class InspectionsController {
  constructor(private readonly inspections: InspectionsService) {}

  @Get()
  list(@CurrentUser() actor: Actor) { return this.inspections.list(actor) }

  @Get('inspectors')
  @Roles(UserRole.ADMIN, UserRole.PROPERTY_MANAGER)
  inspectors() { return this.inspections.inspectors() }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.PROPERTY_MANAGER)
  schedule(@Body() dto: ScheduleInspectionDto, @CurrentUser() actor: Actor) { return this.inspections.schedule(dto, actor) }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: Actor) { return this.inspections.get(id, actor) }

  @Patch(':id/schedule')
  @Roles(UserRole.ADMIN, UserRole.PROPERTY_MANAGER)
  reschedule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RescheduleInspectionDto, @CurrentUser() actor: Actor) { return this.inspections.reschedule(id, dto, actor) }

  @Post(':id/cancel')
  @Roles(UserRole.ADMIN, UserRole.PROPERTY_MANAGER)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: Actor) { return this.inspections.cancel(id, actor) }

  @Post(':id/access')
  @Roles(UserRole.ADMIN, UserRole.PROPERTY_MANAGER)
  confirmAccess(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmInspectionAccessDto, @CurrentUser() actor: Actor) { return this.inspections.confirmAccess(id, dto, actor) }

  @Post(':id/start')
  @Roles(UserRole.INSPECTOR)
  start(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: Actor) { return this.inspections.start(id, actor) }

  @Post(':id/complete')
  @Roles(UserRole.INSPECTOR)
  complete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: Actor) { return this.inspections.completeVisit(id, actor) }

  @Post(':id/report')
  @Roles(UserRole.INSPECTOR)
  report(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmitInspectionReportDto, @CurrentUser() actor: Actor) { return this.inspections.submitReport(id, dto, actor) }

  @Post(':id/evidence')
  @Roles(UserRole.INSPECTOR)
  startEvidence(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StartInspectionEvidenceDto, @CurrentUser() actor: Actor) { return this.inspections.startEvidence(id, dto, actor) }

  @Post(':id/evidence/:evidenceId/complete')
  @Roles(UserRole.INSPECTOR)
  completeEvidence(@Param('id', ParseUUIDPipe) id: string, @Param('evidenceId', ParseUUIDPipe) evidenceId: string, @CurrentUser() actor: Actor) { return this.inspections.completeEvidence(id, evidenceId, actor) }

  @Get(':id/evidence/:evidenceId/url')
  evidenceUrl(@Param('id', ParseUUIDPipe) id: string, @Param('evidenceId', ParseUUIDPipe) evidenceId: string, @CurrentUser() actor: Actor, @Query('download') download?: string) { return this.inspections.evidenceUrl(id, evidenceId, actor, download) }

  @Delete(':id/evidence/:evidenceId')
  @Roles(UserRole.INSPECTOR)
  removeEvidence(@Param('id', ParseUUIDPipe) id: string, @Param('evidenceId', ParseUUIDPipe) evidenceId: string, @CurrentUser() actor: Actor) { return this.inspections.removeEvidence(id, evidenceId, actor) }
}
