import { IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator'

export class SaveStayListingDto {
  @IsUUID() propertyId!: string
  @IsString() @Length(3, 160) title!: string
  @IsString() @Length(20, 3000) description!: string
  @IsString() @Length(10, 2000) hostNote!: string
  @IsInt() @Min(1000) @Max(10_000_000) pricePerNightNgn!: number
  @IsInt() @Min(0) @Max(10_000_000) cleaningFeeNgn!: number
  @IsInt() @Min(1) @Max(50) maxGuests!: number
  @IsInt() @Min(0) @Max(50) bedrooms!: number
  @IsInt() @Min(1) @Max(50) bathrooms!: number
  @IsInt() @Min(1) @Max(90) minimumNights!: number
  @IsArray() @IsString({ each: true }) amenities!: string[]
  @IsArray() @IsString({ each: true }) houseRules!: string[]
}

export class ReviewStayListingDto {
  @IsIn(['PUBLISH', 'REJECT']) decision!: 'PUBLISH' | 'REJECT'
  @IsOptional() @IsString() @Length(10, 1000) note?: string
}

export class StayBlockDto {
  @IsString() startDate!: string
  @IsString() endDate!: string
  @IsString() @Length(3, 250) reason!: string
}
