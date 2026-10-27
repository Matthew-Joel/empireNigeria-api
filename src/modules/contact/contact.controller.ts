import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common'
import { ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger'
import { AuthRateLimitGuard } from '../auth/auth-rate-limit.guard'
import { ContactService } from './contact.service'
import { ContactEnquiryDto } from './dto/contact.dto'

@ApiTags('Contact')
@ApiTooManyRequestsResponse({ description: 'More than 15 POST requests per minute from one IP to the same path' })
@Controller('contact')
@UseGuards(AuthRateLimitGuard)
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  @Post() @HttpCode(202)
  submit(@Body() dto: ContactEnquiryDto) { return this.contact.submit(dto) }
}
