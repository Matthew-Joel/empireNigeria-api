import { IsEmail, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator'

export const CONTACT_TOPICS = ['owner', 'guest', 'care-team', 'other'] as const

export class ContactEnquiryDto {
  @IsString() @Length(2, 120) name!: string
  @IsEmail() @MaxLength(254) email!: string
  @IsIn(CONTACT_TOPICS) topic!: (typeof CONTACT_TOPICS)[number]
  @IsOptional() @IsString() @MaxLength(160) property?: string
  @IsString() @Length(10, 3000) message!: string
  // Honeypot: hidden in the form, so only bots fill it in.
  @IsOptional() @IsString() @MaxLength(200) website?: string
}
