import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { AuthenticatedRequest } from '../../common/types/request-with-user'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { AcceptInvitationDto } from './dto/accept-invitation.dto'
import { AuthService } from './auth.service'
import { LoginDto } from './dto/login.dto'
import { RefreshDto } from './dto/refresh.dto'
import { RegisterDto } from './dto/register.dto'
import { ChallengeCodeDto, EmailDto, ResetPasswordDto, UpdateProfileDto } from './dto/account.dto'
import { AuthRateLimitGuard } from './auth-rate-limit.guard'

@Controller('auth')
@UseGuards(AuthRateLimitGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto)
  }

  @Post('verify')
  verify(@Body() dto: ChallengeCodeDto) {
    return this.authService.verify(dto)
  }

  @Post('verification/resend')
  resendVerification(@Body() dto: EmailDto) {
    return this.authService.requestVerification(dto.email)
  }

  @Post('password-reset/request')
  requestPasswordReset(@Body() dto: EmailDto) {
    return this.authService.requestPasswordReset(dto.email)
  }

  @Post('password-reset/verify')
  verifyPasswordReset(@Body() dto: ChallengeCodeDto) {
    return this.authService.verifyPasswordReset(dto)
  }

  @Post('password-reset/complete')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto)
  }

  @Post('invitations/accept')
  acceptInvitation(@Body() dto: AcceptInvitationDto) {
    return this.authService.acceptInvitation(dto)
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto)
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken)
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthenticatedRequest['user']) {
    return this.authService.getCurrentUser(user.sub)
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  updateProfile(@CurrentUser() user: AuthenticatedRequest['user'], @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(user.sub, dto)
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  logout(@CurrentUser() user: AuthenticatedRequest['user']) {
    return this.authService.logout(user.sub)
  }
}
