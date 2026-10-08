import { InspectionEvidenceType, InspectionFindingSeverity } from '@prisma/client'
import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator'

export class ScheduleInspectionDto {
  @IsUUID() propertyId!: string
  @IsUUID() inspectorId!: string
  @IsString() @Length(3, 160) purpose!: string
  @IsString() @Length(10, 2000) summary!: string
  @IsDateString() scheduledAt!: string
}

export class RescheduleInspectionDto {
  @IsOptional() @IsUUID() inspectorId?: string
  @IsDateString() scheduledAt!: string
}

export class InspectionFindingDto {
  @IsString() @Length(2, 100) area!: string
  @IsString() @Length(3, 160) title!: string
  @IsEnum(InspectionFindingSeverity) severity!: InspectionFindingSeverity
  @IsString() @Length(10, 3000) detail!: string
  @IsString() @Length(3, 3000) recommendation!: string
}

export class SubmitInspectionReportDto {
  @IsString() @Length(20, 5000) overview!: string
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(15) @IsString({ each: true }) @MaxLength(500, { each: true }) recommendations!: string[]
  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => InspectionFindingDto) findings!: InspectionFindingDto[]
}

export class StartInspectionEvidenceDto {
  @IsEnum(InspectionEvidenceType) type!: InspectionEvidenceType
  @IsString() @Length(1, 255) fileName!: string
  @IsString() @Length(2, 250) caption!: string
  @IsString() contentType!: string
  @IsInt() @Min(1) @Max(5_000_000) sizeBytes!: number
}
