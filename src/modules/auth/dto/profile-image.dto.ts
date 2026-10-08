import { IsIn, IsInt, Max, Min } from 'class-validator'

export class StartProfileImageUploadDto {
  @IsIn(['image/jpeg', 'image/png', 'image/webp'])
  contentType!: string

  @IsInt()
  @Min(1)
  @Max(5_000_000)
  sizeBytes!: number
}
