import { IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator'
import { ManagerTaskStatus } from '@prisma/client'

export class CreateTaskDto {
  @IsUUID() propertyId!: string
  @IsString() @Length(3, 160) title!: string
  @IsString() @Length(10, 2000) description!: string
  @IsOptional() @IsString() dueAt?: string
}

export class UpdateTaskDto {
  @IsEnum(ManagerTaskStatus) status!: ManagerTaskStatus
}
