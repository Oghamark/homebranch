import { Test, TestingModule } from '@nestjs/testing';
import { ResolveDuplicateUseCase } from 'src/application/usecases/book/resolve-duplicate.usecase';
import { IBookDuplicateRepository } from 'src/application/interfaces/book-duplicate-repository';
import { IBookRepository } from 'src/application/interfaces/book-repository';
import { mock } from 'jest-mock-extended';
import { Result, UnexpectedFailure } from 'src/core/result';
import { BookDuplicate } from 'src/domain/entities/book-duplicate.entity';
import { BookDuplicateNotFoundFailure, BookDuplicateAlreadyResolvedFailure } from 'src/domain/failures/book-duplicate.failures';
import { BookNotFoundFailure } from 'src/domain/failures/book.failures';
import { mockBook, mockBookFavorite } from 'test/mocks/bookMocks';
import Mocked = jest.Mocked;

const unresolvedDuplicate = new BookDuplicate('dup-1', mockBook.id, mockBookFavorite.id, new Date('2026-01-01'));
const resolvedDuplicate = new BookDuplicate('dup-1', mockBook.id, mockBookFavorite.id, new Date('2026-01-01'), new Date('2026-01-02'), 'merge', 'admin-1');

describe('ResolveDuplicateUseCase', () => {
  let useCase: ResolveDuplicateUseCase;
  let duplicateRepository: Mocked<IBookDuplicateRepository>;
  let bookRepository: Mocked<IBookRepository>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResolveDuplicateUseCase,
        {
          provide: 'BookDuplicateRepository',
          useValue: mock<IBookDuplicateRepository>(),
        },
        {
          provide: 'BookRepository',
          useValue: mock<IBookRepository>(),
        },
      ],
    }).compile();

    useCase = module.get<ResolveDuplicateUseCase>(ResolveDuplicateUseCase);
    duplicateRepository = module.get('BookDuplicateRepository');
    bookRepository = module.get('BookRepository');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('merge action', () => {
    test('Deletes suspect book and resolves duplicate', async () => {
      duplicateRepository.findById.mockResolvedValueOnce(Result.ok(unresolvedDuplicate));
      bookRepository.permanentDelete.mockResolvedValueOnce(Result.ok(mockBook));
      duplicateRepository.resolve.mockResolvedValueOnce(Result.ok(resolvedDuplicate));

      const result = await useCase.execute({ id: 'dup-1', action: 'merge', resolvedByUserId: 'admin-1' });

      expect(result.isSuccess()).toBe(true);
      expect(bookRepository.permanentDelete).toHaveBeenCalledWith(unresolvedDuplicate.suspectBookId);
      expect(duplicateRepository.resolve).toHaveBeenCalledWith('dup-1', 'merge', 'admin-1');
    });

    test('Returns failure when suspect book delete fails', async () => {
      duplicateRepository.findById.mockResolvedValueOnce(Result.ok(unresolvedDuplicate));
      bookRepository.permanentDelete.mockResolvedValueOnce(Result.fail(new BookNotFoundFailure()));

      const result = await useCase.execute({ id: 'dup-1', action: 'merge', resolvedByUserId: 'admin-1' });

      expect(result.isFailure()).toBe(true);
      expect(duplicateRepository.resolve).not.toHaveBeenCalled();
    });
  });

  describe('replace action', () => {
    test('Deletes original book and resolves duplicate', async () => {
      duplicateRepository.findById.mockResolvedValueOnce(Result.ok(unresolvedDuplicate));
      bookRepository.permanentDelete.mockResolvedValueOnce(Result.ok(mockBookFavorite));
      duplicateRepository.resolve.mockResolvedValueOnce(Result.ok({ ...resolvedDuplicate, resolution: 'replace' }));

      const result = await useCase.execute({ id: 'dup-1', action: 'replace', resolvedByUserId: 'admin-1' });

      expect(result.isSuccess()).toBe(true);
      expect(bookRepository.permanentDelete).toHaveBeenCalledWith(unresolvedDuplicate.originalBookId);
      expect(duplicateRepository.resolve).toHaveBeenCalledWith('dup-1', 'replace', 'admin-1');
    });

    test('Returns failure when original book delete fails', async () => {
      duplicateRepository.findById.mockResolvedValueOnce(Result.ok(unresolvedDuplicate));
      bookRepository.permanentDelete.mockResolvedValueOnce(Result.fail(new UnexpectedFailure('disk error')));

      const result = await useCase.execute({ id: 'dup-1', action: 'replace', resolvedByUserId: 'admin-1' });

      expect(result.isFailure()).toBe(true);
      expect(duplicateRepository.resolve).not.toHaveBeenCalled();
    });
  });

  describe('keep_both action', () => {
    test('Does not delete any books and resolves duplicate', async () => {
      duplicateRepository.findById.mockResolvedValueOnce(Result.ok(unresolvedDuplicate));
      duplicateRepository.resolve.mockResolvedValueOnce(Result.ok({ ...resolvedDuplicate, resolution: 'keep_both' }));

      const result = await useCase.execute({ id: 'dup-1', action: 'keep_both', resolvedByUserId: 'admin-1' });

      expect(result.isSuccess()).toBe(true);
      expect(bookRepository.permanentDelete).not.toHaveBeenCalled();
      expect(duplicateRepository.resolve).toHaveBeenCalledWith('dup-1', 'keep_both', 'admin-1');
    });
  });

  describe('error cases', () => {
    test('Returns BOOK_DUPLICATE_NOT_FOUND when duplicate does not exist', async () => {
      duplicateRepository.findById.mockResolvedValueOnce(Result.fail(new BookDuplicateNotFoundFailure()));

      const result = await useCase.execute({ id: 'missing-id', action: 'merge', resolvedByUserId: 'admin-1' });

      expect(result.isFailure()).toBe(true);
      expect(result.failure?.code).toBe('BOOK_DUPLICATE_NOT_FOUND');
      expect(bookRepository.permanentDelete).not.toHaveBeenCalled();
    });

    test('Returns BOOK_DUPLICATE_ALREADY_RESOLVED when already resolved', async () => {
      duplicateRepository.findById.mockResolvedValueOnce(Result.ok(resolvedDuplicate));

      const result = await useCase.execute({ id: 'dup-1', action: 'merge', resolvedByUserId: 'admin-1' });

      expect(result.isFailure()).toBe(true);
      expect(result.failure?.code).toBe('BOOK_DUPLICATE_ALREADY_RESOLVED');
      expect(bookRepository.permanentDelete).not.toHaveBeenCalled();
    });

    test('Passes resolvedByUserId to repository', async () => {
      duplicateRepository.findById.mockResolvedValueOnce(Result.ok(unresolvedDuplicate));
      duplicateRepository.resolve.mockResolvedValueOnce(Result.ok(resolvedDuplicate));

      await useCase.execute({ id: 'dup-1', action: 'keep_both', resolvedByUserId: 'specific-admin' });

      expect(duplicateRepository.resolve).toHaveBeenCalledWith('dup-1', 'keep_both', 'specific-admin');
    });
  });
});
