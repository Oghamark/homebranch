import { IsString, MinLength } from 'class-validator';

export class UpsertSettingRequest {
  @IsString()
  key: string;

  @IsString()
  @MinLength(1)
  value: string;
}
