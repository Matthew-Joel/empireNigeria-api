import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { AuthenticatedRequest } from '../../common/types/request-with-user'
import { StartProfileImageUploadDto } from './dto/profile-image.dto'
import { ProfileImageService } from './profile-image.service'

@ApiTags('Profile image') @ApiBearerAuth()
@Controller('auth/me/avatar')
@UseGuards(JwtAuthGuard)
export class ProfileImageController {
  constructor(private readonly images: ProfileImageService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedRequest['user']) { return this.images.get(user.sub) }

  @Post('uploads')
  start(@CurrentUser() user: AuthenticatedRequest['user'], @Body() dto: StartProfileImageUploadDto) { return this.images.start(user.sub, dto) }

  @Post('uploads/:id/complete')
  complete(@CurrentUser() user: AuthenticatedRequest['user'], @Param('id', ParseUUIDPipe) id: string) { return this.images.complete(user.sub, id) }

  @Delete()
  remove(@CurrentUser() user: AuthenticatedRequest['user']) { return this.images.remove(user.sub) }
}
