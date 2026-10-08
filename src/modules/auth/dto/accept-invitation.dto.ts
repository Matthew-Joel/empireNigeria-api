import { IsString, Matches, MaxLength, MinLength } from 'class-validator'

export class AcceptInvitationDto {
  @IsString()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9a-f]{64}$/i, {
    message: 'This invitation link is invalid',
  })
  token!: string

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-zA-Z])(?=.*\d)[\s\S]+$/, {
    message: 'Use at least 8 characters, including a letter and a number.',
  })
  password!: string
}
