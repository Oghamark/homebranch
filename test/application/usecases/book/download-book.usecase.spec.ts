import { Test, TestingModule } from '@nestjs/testing';
import { IBookRepository } from 'src/application/interfaces/book-repository';
import { DownloadBookUseCase } from 'src/application/usecases/book/download-book.usecase';
import { mock } from 'jest-mock-extended';
import { mockBook } from 'test/mocks/bookMocks';
import { Result } from 'src/core/result';
import { BookNotFoundFailure } from 'src/domain/failures/book.failures';
import { BookFactory } from 'src/domain/entities/book.factory';
import Mocked = jest.Mocked;

describe('DownloadBookUseCase', () => {
  let useCase: DownloadBookUseCase;
  let bookRepository: Mocked<IBookRepository>;

  const bookNotFoundFailure = new BookNotFoundFailure();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DownloadBookUseCase,
        {
          provide: 'BookRepository',
          useValue: mock<IBookRepository>(),
        },
      ],
    }).compile();

    useCase = module.get<DownloadBookUseCase>(DownloadBookUseCase);
    bookRepository = module.get('BookRepository');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('Successfully retrieves a book by id for download', async () => {
    bookRepository.findById.mockResolvedValueOnce(Result.ok(mockBook));

    const result = await useCase.execute({ id: mockBook.id });

    expect(bookRepository.findById).toHaveBeenCalledTimes(1);
    expect(bookRepository.findById).toHaveBeenCalledWith(mockBook.id);
    expect(result.isSuccess()).toBe(true);
    expect(result.value).toEqual({
      book: mockBook,
      format: 'EPUB',
      fileName: mockBook.fileName,
    });
  });

  test('Falls back to the legacy root file when format rows have not been backfilled yet', async () => {
    const legacyBook = BookFactory.create('legacy-book', 'Legacy Book', 'Legacy Author', 'legacy-book.epub');
    bookRepository.findById.mockResolvedValueOnce(Result.ok(legacyBook));

    const result = await useCase.execute({ id: legacyBook.id });

    expect(result.isSuccess()).toBe(true);
    expect(result.value).toEqual({
      book: legacyBook,
      format: 'EPUB',
      fileName: 'legacy-book.epub',
    });
  });

  test('Fails when book not found', async () => {
    bookRepository.findById.mockResolvedValueOnce(Result.fail(bookNotFoundFailure));

    const result = await useCase.execute({ id: 'non-existent-id' });

    expect(bookRepository.findById).toHaveBeenCalledTimes(1);
    expect(bookRepository.findById).toHaveBeenCalledWith('non-existent-id');
    expect(result.isFailure()).toBe(true);
    expect(result.failure).toEqual(bookNotFoundFailure);
  });
});
