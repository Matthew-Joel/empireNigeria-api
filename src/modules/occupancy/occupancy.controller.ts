import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { UserRole } from '@prisma/client'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { AuthenticatedRequest } from '../../common/types/request-with-user'
import { UpdateOccupancyDto } from './dto/occupancy.dto'
import { OccupancyService } from './occupancy.service'
type Actor = AuthenticatedRequest['user']
@ApiTags('Occupancy') @ApiBearerAuth()
@Controller('occupancy') @UseGuards(JwtAuthGuard, RolesGuard) @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.PROPERTY_MANAGER)
export class OccupancyController {
  constructor(private readonly occupancy: OccupancyService) {}
  @Get() list(@CurrentUser() actor: Actor) { return this.occupancy.list(actor) }
  @Patch(':propertyId') update(@Param('propertyId', ParseUUIDPipe) propertyId: string, @Body() dto: UpdateOccupancyDto, @CurrentUser() actor: Actor) { return this.occupancy.update(propertyId, dto, actor) }
}
