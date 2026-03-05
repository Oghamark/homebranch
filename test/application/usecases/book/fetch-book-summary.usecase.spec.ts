import { Test, TestingModule } from '@nestjs/testing';
import { IBookRepository } from 'src/application/interfaces/book-repository';
import { FetchBookMetadataUseCase } from 'src/application/usecases/book/fetch-book-metadata-use-case.service';
import { IMetadataGateway } from 'src/application/interfaces/metadata-gateway';
import { mock } from 'jest-mock-extended';
import { mockBook } from 'test/mocks/bookMocks';
import { Result, UnexpectedFailure } from 'src/core/result';
import { BookNotFoundFailure } from 'src/domain/failures/book.failures';
import Mocked = jest.Mocked;

describe('FetchBookMetadataUseCase', () => {
  let useCase: FetchBookMetadataUseCase;
  let bookRepository: Mocked<IBookRepository>;
  let metadataGateway: Mocked<IMetadataGateway>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FetchBookMetadataUseCase,
        {
          provide: 'BookRepository',
          useValue: mock<IBookRepository>(),
        },
        {
          provide: 'MetadataGateway',
          useValue: mock<IMetadataGateway>(),
        },
      ],
    }).compile();

    useCase = module.get<FetchBookMetadataUseCase>(FetchBookMetadataUseCase);
    bookRepository = module.get('BookRepository');
    metadataGateway = module.get('MetadataGateway');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('Enriches and persists book metadata', async () => {
    const enrichedBook = { ...mockBook, summary: 'An enriched summary.', genres: ['Fiction'] };
    bookRepository.findById.mockResolvedValueOnce(Result.ok(mockBook));
    metadataGateway.enrichBook.mockResolvedValueOnce(enrichedBook);
    bookRepository.update.mockResolvedValueOnce(Result.ok(enrichedBook));

    const result = await useCase.execute({ id: mockBook.id });

    expect(result.isSuccess()).toBe(true);
    expect(metadataGateway.enrichBook).toHaveBeenCalledWith(mockBook);
    expect(bookRepository.update).toHaveBeenCalledWith(mockBook.id, enrichedBook);
  });

  test('Returns failure when book is not found', async () => {
    bookRepository.findById.mockResolvedValueOnce(Result.fail(new BookNotFoundFailure()));

    const result = await useCase.execute({ id: 'nonexistent-id' });

    expect(result.isFailure()).toBe(true);
    expect(bookRepository.update).not.toHaveBeenCalled();
    expect(metadataGateway.enrichBook).not.toHaveBeenCalled();
  });

  test('Returns failure when repository update fails', async () => {
    bookRepository.findById.mockResolvedValueOnce(Result.ok(mockBook));
    metadataGateway.enrichBook.mockResolvedValueOnce(mockBook);
    bookRepository.update.mockResolvedValueOnce(Result.fail(new UnexpectedFailure('Database error')));

    const result = await useCase.execute({ id: mockBook.id });

    expect(result.isFailure()).toBe(true);
  });
});
