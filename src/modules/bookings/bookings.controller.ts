import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common'
import { UserRole } from '@prisma/client'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { AuthenticatedRequest } from '../../common/types/request-with-user'
import { BookingsService } from './bookings.service'
import { CreateBookingDto, DecideBookingDto } from './dto/booking.dto'

type Actor = AuthenticatedRequest['user']
@Controller('bookings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.GUEST, UserRole.OWNER, UserRole.PROPERTY_MANAGER, UserRole.ADMIN)
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}
  @Get() list(@CurrentUser() actor: Actor) { return this.bookings.list(actor) }
  @Post() @Roles(UserRole.GUEST)
  create(@Body() dto: CreateBookingDto, @CurrentUser() actor: Actor) { return this.bookings.create(dto, actor) }
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: Actor) { return this.bookings.get(id, actor) }
  @Post(':id/decision') @Roles(UserRole.OWNER, UserRole.ADMIN)
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideBookingDto, @CurrentUser() actor: Actor) { return this.bookings.decide(id, dto, actor) }
  @Post(':id/cancel') @Roles(UserRole.GUEST, UserRole.OWNER, UserRole.ADMIN)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: Actor) { return this.bookings.cancel(id, actor) }
  @Post(':id/complete') @Roles(UserRole.OWNER, UserRole.ADMIN)
  complete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: Actor) { return this.bookings.complete(id, actor) }
}
