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

    if (action === 'merge') {
      // Keep original, delete suspect and its files.
      // ON DELETE CASCADE on the FK will also remove the duplicate record.
      const deleteResult = await this.bookRepository.permanentDelete(duplicate.suspectBookId);
      if (!deleteResult.isSuccess()) return Result.fail(deleteResult.failure!);
    } else if (action === 'replace') {
      // Keep suspect as canonical, delete original and its files.
      const deleteResult = await this.bookRepository.permanentDelete(duplicate.originalBookId);
      if (!deleteResult.isSuccess()) return Result.fail(deleteResult.failure!);
    }
    // 'keep_both': no deletions, just mark resolved

    const resolveResult = await this.duplicateRepository.resolve(id, action, resolvedByUserId);

    // For merge/replace, ON DELETE CASCADE may have already removed the duplicate record
    // when the book was deleted. Treat NOT_FOUND here as a success.
    if (!resolveResult.isSuccess() && resolveResult.failure?.code === 'BOOK_DUPLICATE_NOT_FOUND') {
      return Result.ok(duplicate);
    }

    return resolveResult;
  }
}
