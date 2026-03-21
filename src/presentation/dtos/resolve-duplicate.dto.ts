import { IsIn } from 'class-validator';
import { DuplicateResolution } from 'src/domain/entities/book-duplicate.entity';

export class ResolveDuplicateDto {
  @IsIn(['merge', 'keep_both', 'replace'])
  action: DuplicateResolution;
}
