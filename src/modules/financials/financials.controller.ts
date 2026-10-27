import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { UserRole } from '@prisma/client'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { AuthenticatedRequest } from '../../common/types/request-with-user'
import { CreateExpenseDto } from './dto/expense.dto'
import { FinancialsService } from './financials.service'
type Actor = AuthenticatedRequest['user']
@ApiTags('Financials') @ApiBearerAuth()
@Controller('financials') @UseGuards(JwtAuthGuard, RolesGuard) @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.PROPERTY_MANAGER)
export class FinancialsController {
  constructor(private readonly financials: FinancialsService) {}
  @Get() summary(@CurrentUser() actor: Actor) { return this.financials.summary(actor) }
  @Post('expenses') create(@Body() dto: CreateExpenseDto, @CurrentUser() actor: Actor) { return this.financials.create(dto, actor) }
}
