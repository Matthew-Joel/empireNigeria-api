import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { AcceptInvitationDto } from '../../auth/dto/accept-invitation.dto'
import { CreateStaffInvitationDto } from './create-staff-invitation.dto'

describe('invitation request validation', () => {
  it.each([undefined, '', '   ', '+2348012345678'])('accepts optional phone value %s', async (phone) => {
    const dto = plainToInstance(CreateStaffInvitationDto, {
      firstName: 'Ada', lastName: 'Eze', email: 'ada@example.com', role: 'INSPECTOR', phone,
    })
    expect(await validate(dto)).toEqual([])
  })

  it('rejects malformed user IDs before a token reaches PostgreSQL', async () => {
    const dto = plainToInstance(AcceptInvitationDto, { token: `not-a-uuid.${'a'.repeat(64)}`, password: 'Password1!' })
    expect((await validate(dto)).map((error) => error.property)).toContain('token')
  })

  it.each(['passwordonly', '123456789', 'Pass1'])('rejects a password that the setup page also rejects: %s', async (password) => {
    const dto = plainToInstance(AcceptInvitationDto, { token: `f53c019c-c1ca-4bc7-bb54-d9b28d822fd9.${'a'.repeat(64)}`, password })
    expect((await validate(dto)).map((error) => error.property)).toContain('password')
  })
})
