import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NotificationsService } from '../notifications/notifications.service'
import { ContactEnquiryDto } from './dto/contact.dto'

const TOPIC_LABELS: Record<ContactEnquiryDto['topic'], string> = {
  owner: 'I own a property',
  guest: 'I want to stay',
  'care-team': 'I work in property care',
  other: 'Something else',
}

@Injectable()
export class ContactService {
  constructor(private readonly notifications: NotificationsService, private readonly config: ConfigService) {}

  async submit(dto: ContactEnquiryDto) {
    // Pretend success for bots so they do not learn the field is a trap.
    if (dto.website) return { received: true }
    const name = this.clean(dto.name)
    const property = dto.property ? this.clean(dto.property) : ''
    const message = dto.message.trim()
    const topic = TOPIC_LABELS[dto.topic]
    await this.notifications.sendEmail({
      to: this.config.get<string>('CONTACT_TO_EMAIL') ?? 'info@empirenigeria.com',
      replyTo: dto.email,
      subject: `Website enquiry: ${topic} (${name})`,
      html: `<p><strong>${this.escapeHtml(name)}</strong> &lt;${this.escapeHtml(dto.email)}&gt;</p><p>Topic: ${this.escapeHtml(topic)}</p>${property ? `<p>Property or location: ${this.escapeHtml(property)}</p>` : ''}<p>${this.escapeHtml(message).replaceAll('\n', '<br>')}</p>`,
      text: `${name} <${dto.email}>\nTopic: ${topic}\n${property ? `Property or location: ${property}\n` : ''}\n${message}`,
    })
    return { received: true }
  }

  // Strip line breaks so user input cannot inject email headers into the subject.
  private clean(value: string) {
    return value.replaceAll(/[\r\n]+/g, ' ').trim()
  }

  private escapeHtml(value: string) {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  }
}
