import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateBookRequest {
  @IsNotEmpty({ message: 'Title is required' })
  @IsString({ message: 'Invalid title' })
  title: string;

  @IsNotEmpty({ message: 'Author is required' })
  @IsString({ message: 'Invalid author' })
  author: string;

  @IsOptional()
  @IsBoolean()
  isFavorite?: boolean;

  @IsOptional()
  @IsNumber({}, { message: 'Invalid Published Year' })
  publishedYear?: number;

  @IsOptional()
  @IsString()
  fileName: string;

  @IsOptional()
  @IsString()
  coverImageFileName?: string;
}
