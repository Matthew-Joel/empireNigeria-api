import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { UserRole } from '@prisma/client'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { AuthenticatedRequest } from '../../common/types/request-with-user'
import { ReviewStayListingDto, SaveStayListingDto, StayBlockDto } from './dto/stay.dto'
import { StayService } from './stay.service'

type Actor = AuthenticatedRequest['user']
@ApiTags('Stay')
@Controller('stay')
export class StayController {
  constructor(private readonly stay: StayService) {}

  @Get()
  list(@Query('location') location?: string, @Query('checkIn') checkIn?: string, @Query('checkOut') checkOut?: string, @Query('guests') guests?: string) { return this.stay.list({ location, checkIn, checkOut, guests }) }

  @Get('manage/mine') @UseGuards(JwtAuthGuard, RolesGuard) @ApiBearerAuth() @Roles(UserRole.OWNER, UserRole.ADMIN)
  mine(@CurrentUser() actor: Actor) { return this.stay.mine(actor) }

  @Post() @UseGuards(JwtAuthGuard, RolesGuard) @ApiBearerAuth() @Roles(UserRole.OWNER)
  create(@Body() dto: SaveStayListingDto, @CurrentUser() actor: Actor) { return this.stay.create(dto, actor) }

  @Get(':id/availability')
  availability(@Param('id', ParseUUIDPipe) id: string, @Query('from') from: string, @Query('to') to: string) { return this.stay.availability(id, from, to) }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.stay.get(id) }

  @Patch(':id') @UseGuards(JwtAuthGuard, RolesGuard) @ApiBearerAuth() @Roles(UserRole.OWNER)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveStayListingDto, @CurrentUser() actor: Actor) { return this.stay.update(id, dto, actor) }

  @Post(':id/submit') @UseGuards(JwtAuthGuard, RolesGuard) @ApiBearerAuth() @Roles(UserRole.OWNER)
  submit(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: Actor) { return this.stay.submit(id, actor) }

  @Post(':id/review') @UseGuards(JwtAuthGuard, RolesGuard) @ApiBearerAuth() @Roles(UserRole.ADMIN)
  review(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewStayListingDto, @CurrentUser() actor: Actor) { return this.stay.review(id, dto, actor) }

  @Post(':id/blocks') @UseGuards(JwtAuthGuard, RolesGuard) @ApiBearerAuth() @Roles(UserRole.OWNER, UserRole.ADMIN)
  block(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StayBlockDto, @CurrentUser() actor: Actor) { return this.stay.block(id, dto, actor) }

  @Delete(':id/blocks/:blockId') @UseGuards(JwtAuthGuard, RolesGuard) @ApiBearerAuth() @Roles(UserRole.OWNER, UserRole.ADMIN)
  unblock(@Param('id', ParseUUIDPipe) id: string, @Param('blockId', ParseUUIDPipe) blockId: string, @CurrentUser() actor: Actor) { return this.stay.unblock(id, blockId, actor) }
}
