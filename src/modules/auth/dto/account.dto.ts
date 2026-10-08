import { Transform } from 'class-transformer'
import { IsEmail, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator'

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value

export class EmailDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail()
  @MaxLength(320)
  email!: string
}

export class ChallengeCodeDto {
  @IsUUID()
  challengeId!: string

  @IsString()
  @Matches(/^\d{6}$/)
  code!: string
}

export class ResetPasswordDto {
  @IsUUID()
  challengeId!: string

  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  resetToken!: string

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-zA-Z])(?=.*\d)[\s\S]+$/)
  password!: string
}

export class UpdateProfileDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  firstName!: string

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  lastName!: string

  @Transform(trim)
  @IsString()
  @Matches(/^\+?[0-9 ()-]{7,30}$/)
  phone!: string

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  country!: string

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  timezone!: string
}
