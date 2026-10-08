import { UserRole } from '@prisma/client'
import { Transform } from 'class-transformer'
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator'

export class CreateStaffInvitationDto {
  @IsString()
  @MinLength(2)
  firstName!: string

  @IsString()
  @MinLength(2)
  lastName!: string

  @IsEmail()
  email!: string

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString()
  @Matches(/^\+?[0-9 ()-]{7,30}$/)
  phone?: string

  @IsEnum(UserRole)
  role!: UserRole
}
