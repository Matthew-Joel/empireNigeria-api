import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common'
import { AuthRateLimitGuard } from '../auth/auth-rate-limit.guard'
import { ContactService } from './contact.service'
import { ContactEnquiryDto } from './dto/contact.dto'

@Controller('contact')
@UseGuards(AuthRateLimitGuard)
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  @Post() @HttpCode(202)
  submit(@Body() dto: ContactEnquiryDto) { return this.contact.submit(dto) }
}
