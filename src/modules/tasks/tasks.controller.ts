import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common'
import { UserRole } from '@prisma/client'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { AuthenticatedRequest } from '../../common/types/request-with-user'
import { CreateTaskDto, UpdateTaskDto } from './dto/task.dto'
import { TasksService } from './tasks.service'
type Actor = AuthenticatedRequest['user']
@Controller('tasks') @UseGuards(JwtAuthGuard, RolesGuard) @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.PROPERTY_MANAGER)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}
  @Get() list(@CurrentUser() actor: Actor) { return this.tasks.list(actor) }
  @Post() create(@Body() dto: CreateTaskDto, @CurrentUser() actor: Actor) { return this.tasks.create(dto, actor) }
  @Patch(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTaskDto, @CurrentUser() actor: Actor) { return this.tasks.update(id, dto, actor) }
}
