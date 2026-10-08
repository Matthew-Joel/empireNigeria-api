import { MaintenanceEvidenceKind, MaintenanceEvidenceType, MaintenancePriority } from '@prisma/client'
import { IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator'

export class CreateMaintenanceDto {
  @IsUUID() propertyId!: string
  @IsString() @Length(3, 160) issue!: string
  @IsString() @Length(10, 3000) description!: string
  @IsEnum(MaintenancePriority) priority!: MaintenancePriority
}

export class AssignMaintenanceDto {
  @IsUUID() contractorId!: string
  @IsString() @Length(10, 1000) note!: string
}

export class MaintenanceNoteDto {
  @IsString() @Length(10, 2000) note!: string
}

export class SubmitMaintenanceQuoteDto {
  @IsInt() @Min(100) @Max(1_000_000_000) amountNgn!: number
  @IsString() @Length(10, 3000) scope!: string
  @IsInt() @Min(1) @Max(365) expectedDurationDays!: number
  @IsString() @Length(10, 2000) notes!: string
}

export class DecideMaintenanceQuoteDto {
  @IsIn(['APPROVE', 'REJECT']) decision!: 'APPROVE' | 'REJECT'
  @IsOptional() @IsString() @Length(10, 2000) note?: string
}

export class StartMaintenanceEvidenceDto {
  @IsEnum(MaintenanceEvidenceType) type!: MaintenanceEvidenceType
  @IsEnum(MaintenanceEvidenceKind) kind!: MaintenanceEvidenceKind
  @IsString() @Length(1, 255) fileName!: string
  @IsString() @Length(2, 250) caption!: string
  @IsString() contentType!: string
  @IsInt() @Min(1) @Max(5_000_000) sizeBytes!: number
}
