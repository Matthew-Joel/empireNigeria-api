import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger'
import { UserRole } from '@prisma/client'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { AuthenticatedRequest } from '../../common/types/request-with-user'
import { AssignMaintenanceDto, CreateMaintenanceDto, DecideMaintenanceQuoteDto, MaintenanceNoteDto, StartMaintenanceEvidenceDto, SubmitMaintenanceQuoteDto } from './dto/maintenance.dto'
import { MaintenanceService } from './maintenance.service'

type Actor = AuthenticatedRequest['user']

@ApiTags('Maintenance') @ApiBearerAuth()
@Controller('maintenance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.PROPERTY_MANAGER, UserRole.CONTRACTOR, UserRole.ADMIN)
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get()
  list(@CurrentUser() actor: Actor) { return this.maintenance.list(actor) }

  @Post()
  @Roles(UserRole.OWNER)
  create(@Body() dto: CreateMaintenanceDto, @CurrentUser() actor: Actor) { return this.maintenance.create(dto, actor) }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: Actor) { return this.maintenance.get(id, actor) }

  @Post(':id/assign')
  @Roles(UserRole.ADMIN)
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignMaintenanceDto, @CurrentUser() actor: Actor) { return this.maintenance.assign(id, dto, actor) }

  @Post(':id/quotes')
  @Roles(UserRole.CONTRACTOR)
  submitQuote(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmitMaintenanceQuoteDto, @CurrentUser() actor: Actor) { return this.maintenance.submitQuote(id, dto, actor) }

  @Post(':id/quotes/:quoteId/decision')
  @Roles(UserRole.OWNER)
  decideQuote(@Param('id', ParseUUIDPipe) id: string, @Param('quoteId', ParseUUIDPipe) quoteId: string, @Body() dto: DecideMaintenanceQuoteDto, @CurrentUser() actor: Actor) { return this.maintenance.decideQuote(id, quoteId, dto, actor) }

  @Post(':id/start')
  @Roles(UserRole.CONTRACTOR)
  start(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MaintenanceNoteDto, @CurrentUser() actor: Actor) { return this.maintenance.start(id, dto, actor) }

  @Post(':id/progress')
  @Roles(UserRole.CONTRACTOR)
  progress(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MaintenanceNoteDto, @CurrentUser() actor: Actor) { return this.maintenance.progress(id, dto, actor) }

  @Post(':id/complete')
  @Roles(UserRole.CONTRACTOR)
  complete(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MaintenanceNoteDto, @CurrentUser() actor: Actor) { return this.maintenance.complete(id, dto, actor) }

  @Post(':id/close')
  @Roles(UserRole.ADMIN)
  close(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MaintenanceNoteDto, @CurrentUser() actor: Actor) { return this.maintenance.close(id, dto, actor) }

  @Post(':id/evidence')
  @Roles(UserRole.OWNER, UserRole.CONTRACTOR)
  startEvidence(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StartMaintenanceEvidenceDto, @CurrentUser() actor: Actor) { return this.maintenance.startEvidence(id, dto, actor) }

  @Post(':id/evidence/:evidenceId/complete')
  @Roles(UserRole.OWNER, UserRole.CONTRACTOR)
  completeEvidence(@Param('id', ParseUUIDPipe) id: string, @Param('evidenceId', ParseUUIDPipe) evidenceId: string, @CurrentUser() actor: Actor) { return this.maintenance.completeEvidence(id, evidenceId, actor) }

  @ApiQuery({ name: 'download', required: false, enum: ['true', 'false'], description: 'Force a download link instead of inline viewing' })
  @Get(':id/evidence/:evidenceId/url')
  evidenceUrl(@Param('id', ParseUUIDPipe) id: string, @Param('evidenceId', ParseUUIDPipe) evidenceId: string, @CurrentUser() actor: Actor, @Query('download') download?: string) { return this.maintenance.evidenceUrl(id, evidenceId, actor, download) }

  @Delete(':id/evidence/:evidenceId')
  @Roles(UserRole.OWNER, UserRole.CONTRACTOR)
  removeEvidence(@Param('id', ParseUUIDPipe) id: string, @Param('evidenceId', ParseUUIDPipe) evidenceId: string, @CurrentUser() actor: Actor) { return this.maintenance.removeEvidence(id, evidenceId, actor) }
}
