import { IsIn, IsInt, IsString, IsUUID, Length, Max, Min } from 'class-validator'
export class CreateExpenseDto {
  @IsUUID() propertyId!: string
  @IsInt() @Min(1) @Max(1_000_000_000) amountNgn!: number
  @IsIn(['UTILITY', 'REPAIR', 'TAX', 'INSURANCE', 'SERVICE', 'OTHER']) category!: string
  @IsString() @Length(5, 500) description!: string
  @IsString() incurredOn!: string
}
