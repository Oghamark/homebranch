import { Test, TestingModule } from '@nestjs/testing';
import { mock } from 'jest-mock-extended';
import Mocked = jest.Mocked;
import { IBookRepository } from 'src/application/interfaces/book-repository';
import { IFileService } from 'src/application/interfaces/file-service';
import { UnlinkBookFormatUseCase } from 'src/application/usecases/book/unlink-book-format.usecase';
import { Result } from 'src/core/result';
import { BookFactory } from 'src/domain/entities/book.factory';
import { BookFormat, BookFormatType } from 'src/domain/entities/book-format.entity';
import { BookFormatProcessingService } from 'src/infrastructure/services/book-format-processing.service';

describe('UnlinkBookFormatUseCase', () => {
  let useCase: UnlinkBookFormatUseCase;
  let bookRepository: Mocked<IBookRepository>;
  let fileService: Mocked<IFileService>;
  let bookFormatProcessingService: Mocked<BookFormatProcessingService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UnlinkBookFormatUseCase,
        {
          provide: 'BookRepository',
          useValue: mock<IBookRepository>(),
        },
        {
          provide: 'FileService',
          useValue: mock<IFileService>(),
        },
        {
          provide: BookFormatProcessingService,
          useValue: mock<BookFormatProcessingService>(),
        },
      ],
    }).compile();

    useCase = module.get(UnlinkBookFormatUseCase);
    bookRepository = module.get('BookRepository');
    fileService = module.get('FileService');
    bookFormatProcessingService = module.get(BookFormatProcessingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function buildLinkedBook() {
    const epubFormat = new BookFormat({
      id: 'format-epub',
      format: BookFormatType.EPUB,
      fileName: 'Linked Author - Linked Title.epub',
      fileMtime: 1001,
      fileContentHash: 'hash-epub',
    });
    const pdfFormat = new BookFormat({
      id: 'format-pdf',
      format: BookFormatType.PDF,
      fileName: 'Original Author - Original Title.pdf',
      fileMtime: 1002,
      fileContentHash: 'hash-pdf',
    });

    return BookFactory.create(
      'book-1',
      'Merged Title',
      'Merged Author',
      epubFormat.fileName,
      true,
      ['Fantasy'],
      2020,
      'merged-cover.jpg',
      'Merged summary',
      'user-123',
      'Merged Series',
      4,
      'merged-isbn',
      800,
      'Merged Publisher',
      'en',
      4.8,
      200,
      new Date('2024-01-01T00:00:00.000Z'),
      undefined,
      undefined,
      new Date('2024-01-02T00:00:00.000Z'),
      { title: 'Merged Title', author: 'Merged Author' },
      epubFormat.fileMtime,
      epubFormat.fileContentHash,
      new Date('2024-01-03T00:00:00.000Z'),
      [epubFormat, pdfFormat],
    );
  }

  test('rebuilds the unlinked book from file metadata instead of merged metadata', async () => {
    const linkedBook = buildLinkedBook();

    bookRepository.findById.mockResolvedValue(Result.ok(linkedBook));
    bookRepository.splitFormat.mockImplementation(async (_bookId, updatedBook) => Result.ok(updatedBook));
    bookFormatProcessingService.parseMetadata.mockResolvedValue({
      title: 'Original Title',
      author: 'Original Author',
      summary: 'Original summary',
      genres: ['Adventure'],
      publishedYear: 1999,
      isbn: 'original-isbn',
      pageCount: 321,
      publisher: 'Original Publisher',
      language: 'fr',
      coverImageBuffer: Buffer.from('cover'),
    });
    fileService.writeFile.mockResolvedValue();

    const result = await useCase.execute({
      bookId: linkedBook.id,
      formatId: 'format-pdf',
      requestingUserId: 'user-123',
      requestingUserRole: 'USER',
    });

    expect(result.isSuccess()).toBe(true);
    expect(bookFormatProcessingService.parseMetadata).toHaveBeenCalledWith(
      expect.stringContaining('Original Author - Original Title.pdf'),
      BookFormatType.PDF,
    );
    expect(fileService.writeFile).toHaveBeenCalledTimes(1);
    expect(bookRepository.splitFormat).toHaveBeenCalledTimes(1);

    const updatedBook = bookRepository.splitFormat.mock.calls[0][1];
    expect(updatedBook.formats).toHaveLength(1);
    expect(updatedBook.fileName).toBe('Linked Author - Linked Title.epub');

    const splitBook = bookRepository.splitFormat.mock.calls[0][2];
    expect(splitBook.title).toBe('Original Title');
    expect(splitBook.author).toBe('Original Author');
    expect(splitBook.summary).toBe('Original summary');
    expect(splitBook.genres).toEqual(['Adventure']);
    expect(splitBook.publishedYear).toBe(1999);
    expect(splitBook.isbn).toBe('original-isbn');
    expect(splitBook.pageCount).toBe(321);
    expect(splitBook.publisher).toBe('Original Publisher');
    expect(splitBook.language).toBe('fr');
    expect(splitBook.coverImageFileName).toMatch(/\.jpg$/);
    expect(splitBook.averageRating).toBeUndefined();
    expect(splitBook.ratingsCount).toBeUndefined();
    expect(splitBook.metadataFetchedAt).toBeUndefined();
    expect(splitBook.lastSyncedAt).toBeUndefined();
    expect(splitBook.syncedMetadata).toBeUndefined();
    expect(splitBook.formats).toEqual([
      expect.objectContaining({
        id: 'format-pdf',
        format: BookFormatType.PDF,
        fileName: 'Original Author - Original Title.pdf',
      }),
    ]);
  });
});
