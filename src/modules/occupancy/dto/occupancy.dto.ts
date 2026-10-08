import { PropertyOccupancy } from '@prisma/client'
import { IsEnum, IsOptional, IsString, Length } from 'class-validator'

export class UpdateOccupancyDto {
  @IsEnum(PropertyOccupancy) status!: PropertyOccupancy
  @IsString() @Length(10, 1000) note!: string
  @IsOptional() @IsString() @Length(2, 160) tenantName?: string
  @IsOptional() @IsString() @Length(7, 30) tenantPhone?: string
  @IsOptional() @IsString() tenancyStart?: string
}
