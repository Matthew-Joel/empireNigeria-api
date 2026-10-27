import { IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf, IsUUID } from 'class-validator'
import { InspectionConsent, OwnershipDocumentType, PropertyFilePurpose, PropertyOccupancy, PropertyStatus } from '@prisma/client'

const propertyTypes = ['Detached house', 'Apartment', 'Duplex', 'Terrace'] as const
// NOT_RECORDED is the starting state, never an answer.
const consentAnswers = [InspectionConsent.GRANTED, InspectionConsent.DISCUSSION_REQUESTED] as const

export class CreatePropertyDto {
  @IsString() @MinLength(2) @MaxLength(160) name!: string
  @IsIn(propertyTypes) type!: string
  @IsString() @MinLength(10) @MaxLength(5000) description!: string
  @IsString() @MinLength(5) @MaxLength(250) address!: string
  @IsString() @MinLength(2) @MaxLength(100) city!: string
  @IsString() @MinLength(2) @MaxLength(100) state!: string
  @IsString() @MinLength(2) @MaxLength(100) country!: string
  @IsEnum(PropertyOccupancy) occupancyStatus!: PropertyOccupancy
  /** Required when occupancyStatus is OCCUPIED. */
  @ValidateIf((value: CreatePropertyDto) => value.occupancyStatus === PropertyOccupancy.OCCUPIED)
  @IsString() @MinLength(2) @MaxLength(160) tenantName?: string
  /** Required when occupancyStatus is OCCUPIED. */
  @ValidateIf((value: CreatePropertyDto) => value.occupancyStatus === PropertyOccupancy.OCCUPIED)
  @IsString() @MinLength(5) @MaxLength(30) tenantPhone?: string
  /** Required when occupancyStatus is OCCUPIED. ISO 8601 date. */
  @ValidateIf((value: CreatePropertyDto) => value.occupancyStatus === PropertyOccupancy.OCCUPIED)
  @IsDateString() tenancyStart?: string
  @IsOptional() @IsIn(consentAnswers) inspectionConsent?: InspectionConsent
}

export class UpdatePropertyDto extends CreatePropertyDto {}

export class ReviewPropertyDto {
  @IsEnum(PropertyStatus) status!: PropertyStatus
  @IsOptional() @IsString() @MaxLength(2000) reviewNote?: string
}

export class RecordInspectionConsentDto {
  @IsIn(consentAnswers) response!: InspectionConsent
  @IsOptional() @IsString() @MaxLength(1000) note?: string
}

export class AssignManagerDto {
  @IsOptional() @IsUUID() managerId?: string | null
}

export class StartPropertyUploadDto {
  @IsEnum(PropertyFilePurpose) purpose!: PropertyFilePurpose
  @IsOptional() @IsEnum(OwnershipDocumentType) ownershipDocumentType?: OwnershipDocumentType
  @IsString() @MinLength(1) @MaxLength(255) fileName!: string
  @IsString() @MaxLength(100) contentType!: string
  @IsInt() @Min(1) @Max(5_000_000) sizeBytes!: number
  @IsOptional() @IsBoolean() isCover?: boolean
}
