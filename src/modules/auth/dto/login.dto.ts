import { UserRole } from '@prisma/client'
import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { Transform } from 'class-transformer'

export class LoginDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail()
  @MaxLength(320)
  email!: string

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole
}
