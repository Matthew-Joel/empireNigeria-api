import { IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator'

export class CreateBookingDto {
  @IsUUID() listingId!: string
  @IsString() checkIn!: string
  @IsString() checkOut!: string
  @IsInt() @Min(1) @Max(50) guests!: number
  @IsString() @Length(2, 160) guestName!: string
  @IsEmail() guestEmail!: string
  @IsString() @Length(7, 30) guestPhone!: string
}

export class DecideBookingDto {
  @IsIn(['CONFIRM', 'DECLINE']) decision!: 'CONFIRM' | 'DECLINE'
  @IsOptional() @IsString() @Length(10, 1000) note?: string
}
