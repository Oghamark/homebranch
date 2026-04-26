import { Test, TestingModule } from '@nestjs/testing';
import { IBookRepository } from 'src/application/interfaces/book-repository';
import { IBookDuplicateRepository } from 'src/application/interfaces/book-duplicate-repository';
import { IContentHashService } from 'src/application/interfaces/content-hash-service';
import { IFileService } from 'src/application/interfaces/file-service';
import { CreateBookUseCase } from 'src/application/usecases/book/create-book.usecase';
import { CreateBookRequest } from 'src/application/contracts/book/create-book-request';
import { IMetadataGateway } from 'src/application/interfaces/metadata-gateway';
import { IEpubParser } from 'src/application/interfaces/epub-parser';
import { IPdfParser } from 'src/application/interfaces/pdf-parser';
import { BookFactory } from 'src/domain/entities/book.factory';
import { BookFormat, BookFormatType } from 'src/domain/entities/book-format.entity';
import { mock } from 'jest-mock-extended';
import { mockBook } from 'test/mocks/bookMocks';
import { Result, UnexpectedFailure } from 'src/core/result';
import { BookNotFoundFailure } from 'src/domain/failures/book.failures';
import { BookFormatProcessingService } from 'src/infrastructure/services/book-format-processing.service';
import Mocked = jest.Mocked;

function expectPathContaining(relativePath: string): ReturnType<typeof expect.stringMatching> {
  const escapedSegments = relativePath
    .split(/[\\/]/)
    .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[/\\\\]');
  return expect.stringMatching(new RegExp(`${escapedSegments}$`));
}

describe('CreateBookUseCase', () => {
  let useCase: CreateBookUseCase;
  let bookRepository: Mocked<IBookRepository>;
  let duplicateRepository: Mocked<IBookDuplicateRepository>;
  let contentHashService: Mocked<IContentHashService>;
  let metadataGateway: Mocked<IMetadataGateway>;
  let epubParser: Mocked<IEpubParser>;
  let pdfParser: Mocked<IPdfParser>;
  let fileService: Mocked<IFileService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreateBookUseCase,
        BookFormatProcessingService,
        {
          provide: 'BookRepository',
          useValue: mock<IBookRepository>(),
        },
        {
          provide: 'BookDuplicateRepository',
          useValue: mock<IBookDuplicateRepository>(),
        },
        {
          provide: 'ContentHashService',
          useValue: mock<IContentHashService>(),
        },
        {
          provide: 'MetadataGateway',
          useValue: mock<IMetadataGateway>(),
        },
        {
          provide: 'EpubParser',
          useValue: mock<IEpubParser>(),
        },
        {
          provide: 'FileService',
          useValue: mock<IFileService>(),
        },
        {
          provide: 'PdfParser',
          useValue: mock<IPdfParser>(),
        },
      ],
    }).compile();

    useCase = module.get<CreateBookUseCase>(CreateBookUseCase);
    bookRepository = module.get('BookRepository');
    duplicateRepository = module.get('BookDuplicateRepository');
    contentHashService = module.get('ContentHashService');
    metadataGateway = module.get('MetadataGateway');
    epubParser = module.get('EpubParser');
    pdfParser = module.get('PdfParser');
    fileService = module.get('FileService');
    metadataGateway.enrichBook.mockResolvedValue(mockBook);
    epubParser.parse.mockResolvedValue({});
    pdfParser.parse.mockResolvedValue({});
    fileService.fileExists.mockReturnValue(false);
    fileService.writeFile.mockResolvedValue(undefined);
    fileService.moveFile.mockResolvedValue(undefined);
    fileService.deleteFile.mockResolvedValue(undefined);
    // Default: no duplicate found, hash computation returns a stable hash
    bookRepository.findByContentHash.mockResolvedValue(Result.fail(new BookNotFoundFailure()));
    bookRepository.findById.mockResolvedValue(Result.fail(new BookNotFoundFailure()));
    bookRepository.searchWithFilters.mockResolvedValue(
      Result.ok({ data: [], limit: 10, offset: 0, total: 0, nextCursor: null }),
    );
    bookRepository.searchByAuthorAndTitle.mockResolvedValue(
      Result.ok({ data: [], limit: 10, offset: 0, total: 0, nextCursor: null }),
    );
    contentHashService.computeHash.mockResolvedValue('abc123hash');
    duplicateRepository.create.mockResolvedValue(Result.ok({} as any));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('Successfully creates a book', async () => {
    bookRepository.create.mockResolvedValueOnce(Result.ok(mockBook));

    const result = await useCase.execute({
      title: 'Test Book',
      author: 'Test Author',
      fileName: 'test-book.epub',
      isFavorite: false,
      publishedYear: '2001',
      coverImageFileName: 'test-cover.jpg',
      uploadedByUserId: 'user-123',
    });

    expect(result.isSuccess()).toBe(true);
    expect(result.value?.skipped).toBe(false);
    expect(bookRepository.create).toHaveBeenCalledTimes(1);
    expect(bookRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Test Book', author: 'Test Author' }),
    );

    const calledWith = bookRepository.create.mock.calls[0][0];
    expect(calledWith.id).toBeDefined();
    expect(typeof calledWith.id).toBe('string');
  });

  test('Successfully creates a book with minimal fields', async () => {
    bookRepository.create.mockResolvedValueOnce(Result.ok(mockBook));

    const result = await useCase.execute({
      title: 'Test Book',
      author: 'Test Author',
      fileName: 'test-book.epub',
      uploadedByUserId: 'user-123',
    });

    expect(result.isSuccess()).toBe(true);
    expect(result.value?.skipped).toBe(false);
    expect(bookRepository.create).toHaveBeenCalledTimes(1);

    const calledWith = bookRepository.create.mock.calls[0][0];
    expect(calledWith.isFavorite).toBe(false);
    expect(calledWith.publishedYear).toBeUndefined();
    expect(calledWith.coverImageFileName).toBeUndefined();
  });

  test('Ignores invalid published year', async () => {
    bookRepository.create.mockResolvedValueOnce(Result.ok(mockBook));

    const result = await useCase.execute({
      title: 'Test Book',
      author: 'Test Author',
      fileName: 'test-book.epub',
      publishedYear: 'not-a-number',
      uploadedByUserId: 'user-123',
    });

    expect(result.isSuccess()).toBe(true);

    const calledWith = bookRepository.create.mock.calls[0][0];
    expect(calledWith.publishedYear).toBeUndefined();
  });

  test('Successfully parses valid published year', async () => {
    bookRepository.create.mockResolvedValueOnce(Result.ok(mockBook));

    const result = await useCase.execute({
      title: 'Test Book',
      author: 'Test Author',
      fileName: 'test-book.epub',
      publishedYear: '2015',
      uploadedByUserId: 'user-123',
    });

    expect(result.isSuccess()).toBe(true);

    const calledWith = bookRepository.create.mock.calls[0][0];
    expect(calledWith.publishedYear).toBe(2015);
  });

  test('Successfully handles isFavorite flag', async () => {
    bookRepository.create.mockResolvedValueOnce(Result.ok(mockBook));

    const result = await useCase.execute({
      title: 'Test Book',
      author: 'Test Author',
      fileName: 'test-book.epub',
      isFavorite: true,
      uploadedByUserId: 'user-123',
    });

    expect(result.isSuccess()).toBe(true);

    const calledWith = bookRepository.create.mock.calls[0][0];
    expect(calledWith.isFavorite).toBe(true);
  });

  test('Initiates background metadata enrichment after successful create', async () => {
    bookRepository.create.mockResolvedValueOnce(Result.ok(mockBook));
    bookRepository.update.mockResolvedValueOnce(Result.ok(mockBook));

    await useCase.execute({
      title: 'Test Book',
      author: 'Test Author',
      fileName: 'test-book.epub',
      uploadedByUserId: 'user-123',
    });

    // Allow fire-and-forget promise to resolve
    await new Promise((resolve) => setImmediate(resolve));

    expect(metadataGateway.enrichBook).toHaveBeenCalledWith(expect.objectContaining({ title: 'Test Book' }));
    expect(bookRepository.update).toHaveBeenCalledTimes(1);
  });

  test('Fails when repository create fails', async () => {
    const error = new UnexpectedFailure('Database error');
    bookRepository.create.mockResolvedValueOnce(Result.fail(error));

    const result = await useCase.execute({
      title: 'Test Book',
      author: 'Test Author',
      fileName: 'test-book.epub',
      uploadedByUserId: 'user-123',
    });

    expect(result.isFailure()).toBe(true);
    expect(bookRepository.create).toHaveBeenCalledTimes(1);
  });

  describe('Deduplication', () => {
    test('Returns existing book when exact duplicate detected (same content hash + same metadata)', async () => {
      bookRepository.findByContentHash.mockResolvedValueOnce(Result.ok(mockBook));

      const result = await useCase.execute({
        title: 'Test Book',
        author: 'Test Author',
        fileName: 'test-book.epub',
        uploadedByUserId: 'user-123',
      });

      expect(result.isSuccess()).toBe(true);
      expect(result.value?.skipped).toBe(true);
      expect(result.value?.book).toBe(mockBook);
      expect(bookRepository.create).not.toHaveBeenCalled();
    });

    test('Creates book and flags duplicate when same hash but different metadata', async () => {
      const existingBook = { ...mockBook, title: 'Different Title', author: 'Different Author', isbn: undefined };
      bookRepository.findByContentHash.mockResolvedValueOnce(Result.ok(existingBook as any));
      bookRepository.create.mockResolvedValueOnce(Result.ok(mockBook));

      const result = await useCase.execute({
        title: 'Test Book',
        author: 'Test Author',
        fileName: 'test-book.epub',
        uploadedByUserId: 'user-123',
      });

      expect(result.isSuccess()).toBe(true);
      expect(result.value?.skipped).toBe(false);
      expect(bookRepository.create).toHaveBeenCalledTimes(1);
      expect(duplicateRepository.create).toHaveBeenCalledTimes(1);
    });

    test('Sets fileContentHash on new book record', async () => {
      contentHashService.computeHash.mockResolvedValueOnce('deadbeef1234');
      bookRepository.create.mockResolvedValueOnce(Result.ok(mockBook));

      await useCase.execute({
        title: 'Test Book',
        author: 'Test Author',
        fileName: 'test-book.epub',
        uploadedByUserId: 'user-123',
      });

      const calledWith = bookRepository.create.mock.calls[0][0];
      expect(calledWith.fileContentHash).toBe('deadbeef1234');
    });
  });

  describe('EPUB metadata merge', () => {
    test('Fills blank fields from epub metadata', async () => {
      bookRepository.create.mockResolvedValueOnce(Result.ok(mockBook));
      epubParser.parse.mockResolvedValueOnce({
        language: 'fr',
        publisher: 'EPUB Publisher',
        publishedYear: 2020,
        isbn: '978-3-16-148410-0',
        summary: 'An epub summary.',
        genres: ['Fiction'],
        series: 'My Series',
        seriesPosition: 2,
      });

      await useCase.execute({
        title: 'Test Book',
        author: 'Test Author',
        fileName: 'test-book.epub',
        uploadedByUserId: 'user-123',
      });

      const calledWith = bookRepository.create.mock.calls[0][0];
      expect(calledWith.language).toBe('fr');
      expect(calledWith.publisher).toBe('EPUB Publisher');
      expect(calledWith.publishedYear).toBe(2020);
      expect(calledWith.isbn).toBe('978-3-16-148410-0');
      expect(calledWith.summary).toBe('An epub summary.');
      expect(calledWith.genres).toEqual(['Fiction']);
      expect(calledWith.series).toBe('My Series');
      expect(calledWith.seriesPosition).toBe(2);
    });

    test('User-provided fields take priority over epub metadata', async () => {
      bookRepository.create.mockResolvedValueOnce(Result.ok(mockBook));
      epubParser.parse.mockResolvedValueOnce({
        language: 'fr',
        publisher: 'EPUB Publisher',
        publishedYear: 1900,
        isbn: 'epub-isbn',
        genres: ['EPUB Genre'],
        series: 'EPUB Series',
        seriesPosition: 99,
      });

      await useCase.execute({
        title: 'Test Book',
        author: 'Test Author',
        fileName: 'test-book.epub',
        uploadedByUserId: 'user-123',
        language: 'en',
        publisher: 'User Publisher',
        publishedYear: '2024',
        isbn: 'user-isbn',
        genres: ['User Genre'],
        series: 'User Series',
        seriesPosition: 1,
      });

      const calledWith = bookRepository.create.mock.calls[0][0];
      expect(calledWith.language).toBe('en');
      expect(calledWith.publisher).toBe('User Publisher');
      expect(calledWith.publishedYear).toBe(2024);
      expect(calledWith.isbn).toBe('user-isbn');
      expect(calledWith.genres).toEqual(['User Genre']);
      expect(calledWith.series).toBe('User Series');
      expect(calledWith.seriesPosition).toBe(1);
    });

    test('Continues successfully when epub parser throws', async () => {
      bookRepository.create.mockResolvedValueOnce(Result.ok(mockBook));
      epubParser.parse.mockRejectedValueOnce(new Error('corrupt epub'));

      const result = await useCase.execute({
        title: 'Test Book',
        author: 'Test Author',
        fileName: 'test-book.epub',
        uploadedByUserId: 'user-123',
      });

      expect(result.isSuccess()).toBe(true);
      expect(bookRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Test Book', author: 'Test Author' }),
      );
    });

    test('Fails with MISSING_METADATA when title cannot be determined', async () => {
      epubParser.parse.mockResolvedValueOnce({ author: 'Some Author' });

      const result = await useCase.execute({
        title: '' as unknown as string,
        author: 'Test Author',
        fileName: '.epub',
        uploadedByUserId: 'user-123',
      });

      expect(result.isFailure()).toBe(true);
      expect(result.failure?.code).toBe('MISSING_METADATA');
      expect(bookRepository.create).not.toHaveBeenCalled();
    });

    test('Fails with MISSING_METADATA when author cannot be determined', async () => {
      epubParser.parse.mockResolvedValueOnce({ title: 'Some Title' });

      const result = await useCase.execute({
        title: 'Test Book',
        author: '' as unknown as string,
        fileName: 'test-book.epub',
        uploadedByUserId: 'user-123',
      });

      expect(result.isFailure()).toBe(true);
      expect(result.failure?.code).toBe('MISSING_METADATA');
      expect(bookRepository.create).not.toHaveBeenCalled();
    });

    test('Uses epub title/author when dto fields are absent', async () => {
      bookRepository.create.mockResolvedValueOnce(Result.ok(mockBook));
      epubParser.parse.mockResolvedValueOnce({ title: 'EPUB Title', author: 'EPUB Author' });

      const result = await useCase.execute({
        title: '' as unknown as string,
        author: '' as unknown as string,
        fileName: 'test-book.epub',
        uploadedByUserId: 'user-123',
      });

      expect(result.isSuccess()).toBe(true);
      expect(bookRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'EPUB Title', author: 'EPUB Author' }),
      );
    });
  });

  describe('PDF support', () => {
    test('Uses the PDF parser and persists a PDF format variant', async () => {
      bookRepository.create.mockResolvedValueOnce(Result.ok(mockBook));
      pdfParser.parse.mockResolvedValueOnce({ title: 'PDF Title', author: 'PDF Author', pageCount: 321 });

      const request = Object.assign(new CreateBookRequest(), {
        fileName: 'uploaded-book.pdf',
        uploadedByUserId: 'user-123',
      });

      const result = await useCase.execute(request);

      expect(result.isSuccess()).toBe(true);
      expect(pdfParser.parse).toHaveBeenCalledTimes(1);
      expect(epubParser.parse).not.toHaveBeenCalled();

      const createdBook = bookRepository.create.mock.calls[0][0];
      expect(createdBook.title).toBe('PDF Title');
      expect(createdBook.author).toBe('PDF Author');
      expect(createdBook.pageCount).toBe(321);
      expect(createdBook.formats).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            format: BookFormatType.PDF,
            fileName: 'PDF Author - PDF Title.pdf',
            fileContentHash: 'abc123hash',
          }),
        ]),
      );
      expect(fileService.moveFile).toHaveBeenCalledWith(
        expectPathContaining('/incoming/uploaded-book.pdf'),
        expectPathContaining('/books/PDF Author - PDF Title.pdf'),
      );
    });

    test('Falls back to the original upload filename when PDF metadata is sparse', async () => {
      bookRepository.create.mockResolvedValueOnce(Result.ok(mockBook));
      pdfParser.parse.mockResolvedValueOnce({});

      const request = Object.assign(new CreateBookRequest(), {
        fileName: '9f4f2a79-7a9f-49bc-8fe4-6de3b341e123.pdf',
        originalFileName: 'Converted Author - Converted Title.pdf',
        uploadedByUserId: 'user-123',
      });

      const result = await useCase.execute(request);

      expect(result.isSuccess()).toBe(true);
      expect(bookRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Converted Title',
          author: 'Converted Author',
        }),
      );
    });

    test('Attaches a PDF format to an existing logical book', async () => {
      const existingBook = BookFactory.create(
        'book-epub',
        'Shared Title',
        'Shared Author',
        'Shared Author - Shared Title.epub',
        false,
        [],
        undefined,
        undefined,
        undefined,
        'user-123',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'epub-hash',
        undefined,
        [
          new BookFormat({
            id: 'format-epub',
            format: BookFormatType.EPUB,
            fileName: 'Shared Author - Shared Title.epub',
            fileContentHash: 'epub-hash',
          }),
        ],
      );

      bookRepository.searchByAuthorAndTitle.mockResolvedValueOnce(
        Result.ok({ data: [existingBook], limit: 10, offset: 0, total: 1, nextCursor: null }),
      );
      bookRepository.findById.mockResolvedValueOnce(Result.ok(existingBook));
      bookRepository.update.mockImplementationOnce((_id, book) => Promise.resolve(Result.ok(book)));

      const result = await useCase.execute({
        title: 'Shared Title',
        author: 'Shared Author',
        fileName: 'fresh-upload.pdf',
        uploadedByUserId: 'user-123',
      });

      expect(result.isSuccess()).toBe(true);
      expect(result.value?.skipped).toBe(false);
      expect(bookRepository.create).not.toHaveBeenCalled();
      expect(bookRepository.update).toHaveBeenCalledTimes(1);

      const updatedBook = bookRepository.update.mock.calls[0][1];
      expect(updatedBook.formats).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ format: BookFormatType.EPUB }),
          expect.objectContaining({
            format: BookFormatType.PDF,
            fileName: 'Shared Author - Shared Title.pdf',
            fileContentHash: 'abc123hash',
          }),
        ]),
      );
      expect(fileService.moveFile).toHaveBeenCalledWith(
        expectPathContaining('/incoming/fresh-upload.pdf'),
        expectPathContaining('/books/Shared Author - Shared Title.pdf'),
      );
    });
  });
});
