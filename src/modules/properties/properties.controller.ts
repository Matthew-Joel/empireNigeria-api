import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { UserRole } from '@prisma/client'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { AuthenticatedRequest } from '../../common/types/request-with-user'
import { AssignManagerDto, CreatePropertyDto, ReviewPropertyDto, StartPropertyUploadDto, UpdatePropertyDto } from './dto/property.dto'
import { PropertiesService } from './properties.service'

type Actor = AuthenticatedRequest['user']

@Controller('properties')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.PROPERTY_MANAGER, UserRole.ADMIN)
export class PropertiesController {
  constructor(private readonly properties: PropertiesService) {}

  @Get()
  list(@CurrentUser() actor: Actor) { return this.properties.list(actor) }

  @Post()
  create(@Body() dto: CreatePropertyDto, @CurrentUser() actor: Actor) { return this.properties.create(dto, actor) }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: Actor) { return this.properties.get(id, actor) }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePropertyDto, @CurrentUser() actor: Actor) { return this.properties.update(id, dto, actor) }

  @Post(':id/submit')
  submit(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: Actor) { return this.properties.submit(id, actor) }

  @Patch(':id/review')
  review(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewPropertyDto, @CurrentUser() actor: Actor) { return this.properties.review(id, dto, actor) }

  @Patch(':id/manager')
  assignManager(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignManagerDto, @CurrentUser() actor: Actor) { return this.properties.assignManager(id, dto, actor) }

  @Post(':id/files')
  startUpload(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StartPropertyUploadDto, @CurrentUser() actor: Actor) { return this.properties.startUpload(id, dto, actor) }

  @Post(':id/files/:fileId/complete')
  completeUpload(@Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string, @CurrentUser() actor: Actor) { return this.properties.completeUpload(id, fileId, actor) }

  @Get(':id/files/:fileId/url')
  fileUrl(@Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string, @CurrentUser() actor: Actor, @Query('download') download?: string) { return this.properties.fileUrl(id, fileId, actor, download) }

  @Delete(':id/files/:fileId')
  deleteFile(@Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string, @CurrentUser() actor: Actor) { return this.properties.deleteFile(id, fileId, actor) }
}
