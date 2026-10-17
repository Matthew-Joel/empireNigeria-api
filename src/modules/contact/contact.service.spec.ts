import { ContactService } from './contact.service'

const dto = { name: 'Ada\nBcc: evil@example.com', email: 'ada@example.com', topic: 'owner' as const, message: 'Hello <b>team</b>, I need help.' }

function setup(to?: string) {
  const notifications = { sendEmail: jest.fn().mockResolvedValue({ sent: true }) }
  const config = { get: jest.fn().mockReturnValue(to) }
  return { service: new ContactService(notifications as never, config as never), notifications }
}

describe('ContactService', () => {
  it('emails the team with the visitor as reply-to and escapes the message', async () => {
    const { service, notifications } = setup('team@example.com')
    await expect(service.submit(dto)).resolves.toEqual({ received: true })
    const sent = notifications.sendEmail.mock.calls[0][0]
    expect(sent.to).toBe('team@example.com')
    expect(sent.replyTo).toBe('ada@example.com')
    expect(sent.subject).not.toMatch(/[\r\n]/)
    expect(sent.html).toContain('&lt;b&gt;team&lt;/b&gt;')
    expect(sent.html).not.toContain('<b>')
  })

  it('falls back to the default inbox and silently drops honeypot submissions', async () => {
    const { service, notifications } = setup()
    await service.submit(dto)
    expect(notifications.sendEmail.mock.calls[0][0].to).toBe('info@empirenigeria.com')
    notifications.sendEmail.mockClear()
    await expect(service.submit({ ...dto, website: 'http://spam.example' })).resolves.toEqual({ received: true })
    expect(notifications.sendEmail).not.toHaveBeenCalled()
  })
})
