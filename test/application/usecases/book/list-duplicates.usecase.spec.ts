import { Test, TestingModule } from '@nestjs/testing';
import { ListDuplicatesUseCase } from 'src/application/usecases/book/list-duplicates.usecase';
import { IBookDuplicateRepository, BookDuplicateWithBooks } from 'src/application/interfaces/book-duplicate-repository';
import { mock } from 'jest-mock-extended';
import { Result, UnexpectedFailure } from 'src/core/result';
import { PaginationResult } from 'src/core/pagination_result';
import { BookDuplicate } from 'src/domain/entities/book-duplicate.entity';
import { mockBook, mockBookFavorite } from 'test/mocks/bookMocks';
import Mocked = jest.Mocked;

const mockDuplicate = new BookDuplicate('dup-1', mockBook.id, mockBookFavorite.id, new Date('2026-01-01'));

const mockDuplicateWithBooks: BookDuplicateWithBooks = {
  duplicate: mockDuplicate,
  suspectBook: mockBook,
  originalBook: mockBookFavorite,
};

const paginationResult: PaginationResult<BookDuplicateWithBooks[]> = {
  data: [mockDuplicateWithBooks],
  limit: 10,
  offset: 0,
  total: 1,
  nextCursor: null,
};

describe('ListDuplicatesUseCase', () => {
  let useCase: ListDuplicatesUseCase;
  let duplicateRepository: Mocked<IBookDuplicateRepository>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ListDuplicatesUseCase,
        {
          provide: 'BookDuplicateRepository',
          useValue: mock<IBookDuplicateRepository>(),
        },
      ],
    }).compile();

    useCase = module.get<ListDuplicatesUseCase>(ListDuplicatesUseCase);
    duplicateRepository = module.get('BookDuplicateRepository');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('Returns paginated list of unresolved duplicates', async () => {
    duplicateRepository.listUnresolved.mockResolvedValueOnce(Result.ok(paginationResult));

    const result = await useCase.execute({ limit: 10, offset: 0 });

    expect(result.isSuccess()).toBe(true);
    expect(result.value?.data).toHaveLength(1);
    expect(result.value?.total).toBe(1);
    expect(result.value?.data[0].duplicate.id).toBe('dup-1');
  });

  test('Passes limit and offset to repository', async () => {
    duplicateRepository.listUnresolved.mockResolvedValueOnce(Result.ok(paginationResult));

    await useCase.execute({ limit: 5, offset: 10 });

    expect(duplicateRepository.listUnresolved).toHaveBeenCalledWith(5, 10);
  });

  test('Works with no pagination parameters', async () => {
    duplicateRepository.listUnresolved.mockResolvedValueOnce(Result.ok(paginationResult));

    await useCase.execute({});

    expect(duplicateRepository.listUnresolved).toHaveBeenCalledWith(undefined, undefined);
  });

  test('Propagates repository failure', async () => {
    const error = new UnexpectedFailure('DB error');
    duplicateRepository.listUnresolved.mockResolvedValueOnce(Result.fail(error));

    const result = await useCase.execute({ limit: 10, offset: 0 });

    expect(result.isFailure()).toBe(true);
    expect(result.failure?.code).toBe('UNEXPECTED_ERROR');
  });

  test('Returns duplicate with both suspect and original books populated', async () => {
    duplicateRepository.listUnresolved.mockResolvedValueOnce(Result.ok(paginationResult));

    const result = await useCase.execute({});

    const item = result.value!.data[0];
    expect(item.suspectBook.id).toBe(mockBook.id);
    expect(item.originalBook.id).toBe(mockBookFavorite.id);
  });
});
