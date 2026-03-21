import { Inject, Injectable } from '@nestjs/common';
import { Result } from 'src/core/result';
import { UseCase } from 'src/core/usecase';
import { IBookDuplicateRepository } from '../../interfaces/book-duplicate-repository';
import { IBookRepository } from '../../interfaces/book-repository';
import { BookDuplicate, DuplicateResolution } from 'src/domain/entities/book-duplicate.entity';
import {
  BookDuplicateNotFoundFailure,
  BookDuplicateAlreadyResolvedFailure,
} from 'src/domain/failures/book-duplicate.failures';

export interface ResolveDuplicateRequest {
  id: string;
  action: DuplicateResolution;
  resolvedByUserId: string;
}

@Injectable()
export class ResolveDuplicateUseCase implements UseCase<ResolveDuplicateRequest, BookDuplicate> {
  constructor(
    @Inject('BookDuplicateRepository') private readonly duplicateRepository: IBookDuplicateRepository,
    @Inject('BookRepository') private readonly bookRepository: IBookRepository,
  ) {}

  async execute({ id, action, resolvedByUserId }: ResolveDuplicateRequest): Promise<Result<BookDuplicate>> {
    const duplicateResult = await this.duplicateRepository.findById(id);
    if (!duplicateResult.isSuccess()) return Result.fail(new BookDuplicateNotFoundFailure());

    const duplicate = duplicateResult.value;
    if (duplicate.resolvedAt) return Result.fail(new BookDuplicateAlreadyResolvedFailure());

    // Resolve the duplicate record first, before any book deletion.
    // Deleting a book triggers ON DELETE CASCADE on book_duplicate_entity, so
    // the record must be updated before the referenced book is removed.
    const resolveResult = await this.duplicateRepository.resolve(id, action, resolvedByUserId);
    if (!resolveResult.isSuccess()) return Result.fail(resolveResult.failure!);

    if (action === 'merge') {
      // Keep original, delete suspect and its files
      const deleteResult = await this.bookRepository.permanentDelete(duplicate.suspectBookId);
      if (!deleteResult.isSuccess()) return Result.fail(deleteResult.failure!);
    } else if (action === 'replace') {
      // Keep suspect as canonical, delete original and its files
      const deleteResult = await this.bookRepository.permanentDelete(duplicate.originalBookId);
      if (!deleteResult.isSuccess()) return Result.fail(deleteResult.failure!);
    }
    // 'keep_both': no deletions, just mark resolved

    return resolveResult;
  }
}
