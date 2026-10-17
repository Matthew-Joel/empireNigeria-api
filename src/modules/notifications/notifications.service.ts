import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Resend } from 'resend'

export interface SendEmailInput {
  to: string | string[]
  subject: string
  html: string
  text?: string
  replyTo?: string
}

@Injectable()
export class NotificationsService {
  private readonly client: Resend | null

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY')
    this.client = apiKey ? new Resend(apiKey) : null
  }

  async sendEmail(input: SendEmailInput) {
    if (!this.client) {
      if (this.config.get<string>('NODE_ENV') === 'production') {
        throw new ServiceUnavailableException(
          'Email delivery is not configured',
        )
      }

      return {
        sent: false,
        reason: 'email_disabled_in_development',
      }
    }

    const from = this.config.get<string>('RESEND_FROM_EMAIL')

    if (!from) {
      throw new ServiceUnavailableException(
        'RESEND_FROM_EMAIL is not configured',
      )
    }

    const { data, error } = await this.client.emails.send({
      from,
      to: Array.isArray(input.to) ? input.to : [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
      replyTo: input.replyTo,
    })

    if (error) {
      throw new ServiceUnavailableException('Email delivery failed')
    }

    return {
      sent: true,
      id: data?.id ?? null,
    }
  }
}
