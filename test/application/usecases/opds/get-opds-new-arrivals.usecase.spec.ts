import { Test, TestingModule } from '@nestjs/testing';
import { IBookRepository } from 'src/application/interfaces/book-repository';
import { GetOpdsNewArrivalsUseCase } from 'src/application/usecases/opds/get-opds-new-arrivals.usecase';
import { mock } from 'jest-mock-extended';
import { mockBook } from 'test/mocks/bookMocks';
import { Result } from 'src/core/result';
import { PaginationResult } from 'src/core/pagination_result';
import { Book } from 'src/domain/entities/book.entity';
import Mocked = jest.Mocked;

describe('GetOpdsNewArrivalsUseCase', () => {
  let useCase: GetOpdsNewArrivalsUseCase;
  let bookRepository: Mocked<IBookRepository>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetOpdsNewArrivalsUseCase,
        {
          provide: 'BookRepository',
          useValue: mock<IBookRepository>(),
        },
      ],
    }).compile();

    useCase = module.get<GetOpdsNewArrivalsUseCase>(GetOpdsNewArrivalsUseCase);
    bookRepository = module.get('BookRepository');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('Returns paginated new arrivals', async () => {
    const paginationResult: PaginationResult<Book[]> = {
      data: [mockBook],
      limit: 20,
      offset: 0,
      total: 1,
      nextCursor: null,
    };
    bookRepository.findNewArrivals.mockResolvedValueOnce(Result.ok(paginationResult));

    const result = await useCase.execute({ limit: 20, offset: 0 });

    expect(bookRepository.findNewArrivals).toHaveBeenCalledWith(20, 0);
    expect(result.isSuccess()).toBe(true);
    expect(result.value).toEqual(paginationResult);
  });

  test('Returns empty list when no books exist', async () => {
    const paginationResult: PaginationResult<Book[]> = {
      data: [],
      limit: 20,
      offset: 0,
      total: 0,
      nextCursor: null,
    };
    bookRepository.findNewArrivals.mockResolvedValueOnce(Result.ok(paginationResult));

    const result = await useCase.execute({ limit: 20, offset: 0 });

    expect(bookRepository.findNewArrivals).toHaveBeenCalledWith(20, 0);
    expect(result.isSuccess()).toBe(true);
    expect(result.value!.data).toEqual([]);
    expect(result.value!.total).toBe(0);
  });

  test('Returns nextCursor when there are more results', async () => {
    const paginationResult: PaginationResult<Book[]> = {
      data: [mockBook],
      limit: 1,
      offset: 0,
      total: 5,
      nextCursor: 1,
    };
    bookRepository.findNewArrivals.mockResolvedValueOnce(Result.ok(paginationResult));

    const result = await useCase.execute({ limit: 1, offset: 0 });

    expect(result.isSuccess()).toBe(true);
    expect(result.value!.nextCursor).toBe(1);
  });
});
