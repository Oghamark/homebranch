import { Job } from 'bullmq';
import { mock } from 'jest-mock-extended';
import { DuplicateScanProcessor } from 'src/infrastructure/processors/duplicate-scan.processor';
import { IBookRepository } from 'src/application/interfaces/book-repository';
import { IBookDuplicateRepository } from 'src/application/interfaces/book-duplicate-repository';
import { Result } from 'src/core/result';
import { Book } from 'src/domain/entities/book.entity';
import { BookDuplicate } from 'src/domain/entities/book-duplicate.entity';
import { BookNotFoundFailure } from 'src/domain/failures/book.failures';
import { BookDuplicateNotFoundFailure } from 'src/domain/failures/book-duplicate.failures';
import Mocked = jest.Mocked;

// Positions in Book constructor: id, title, author, fileName, isFavorite, genres, publishedYear,
// coverImageFileName, summary, uploadedByUserId, series, seriesPosition, isbn, pageCount,
// publisher, language, averageRating, ratingsCount, metadataFetchedAt, createdAt, deletedAt,
// lastSyncedAt, syncedMetadata, fileMtime, fileContentHash
const HASH_A = 'hash-abc';
const HASH_B = 'hash-xyz';

function makeBook(overrides: Partial<Book> & { id: string }): Book {
  const defaults: Book = new Book(
    overrides.id,
    overrides.title ?? 'Default Title',
    overrides.author ?? 'Default Author',
    overrides.fileName ?? 'file.epub',
    overrides.isFavorite ?? false,
    overrides.genres ?? [],
    overrides.publishedYear,
    overrides.coverImageFileName,
    overrides.summary,
    overrides.uploadedByUserId,
    overrides.series,
    overrides.seriesPosition,
    overrides.isbn,
    overrides.pageCount,
    overrides.publisher,
    overrides.language,
    overrides.averageRating,
    overrides.ratingsCount,
    overrides.metadataFetchedAt,
    overrides.createdAt ?? new Date('2026-01-01'),
    overrides.deletedAt,
    overrides.lastSyncedAt,
    overrides.syncedMetadata,
    overrides.fileMtime,
    overrides.fileContentHash,
  );
  return defaults;
}

const mockUpdateProgress = jest.fn().mockResolvedValue(undefined);
const scanJob = { name: 'scan-duplicates', updateProgress: mockUpdateProgress } as unknown as Job;
const unknownJob = { name: 'unknown-job', updateProgress: mockUpdateProgress } as unknown as Job;

describe('DuplicateScanProcessor', () => {
  let processor: DuplicateScanProcessor;
  let bookRepository: Mocked<IBookRepository>;
  let duplicateRepository: Mocked<IBookDuplicateRepository>;

  beforeEach(() => {
    bookRepository = mock<IBookRepository>();
    duplicateRepository = mock<IBookDuplicateRepository>();
    processor = new DuplicateScanProcessor(bookRepository, duplicateRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockUpdateProgress.mockClear();
  });

  test('Does nothing for unknown job names', async () => {
    await processor.process(unknownJob);

    expect(bookRepository.findAllActive).not.toHaveBeenCalled();
  });

  test('Does nothing when findAllActive fails', async () => {
    bookRepository.findAllActive.mockResolvedValueOnce(Result.fail(new BookNotFoundFailure()));

    await processor.process(scanJob);

    expect(duplicateRepository.create).not.toHaveBeenCalled();
  });

  test('Ignores books without a content hash', async () => {
    const bookWithoutHash = makeBook({ id: 'book-1' });
    bookRepository.findAllActive.mockResolvedValueOnce(Result.ok([bookWithoutHash]));

    await processor.process(scanJob);

    expect(duplicateRepository.findByBookIds).not.toHaveBeenCalled();
    expect(duplicateRepository.create).not.toHaveBeenCalled();
  });

  test('Does not flag pairs where metadata matches (exact duplicates)', async () => {
    const bookA = makeBook({ id: 'book-a', title: 'Same Title', author: 'Same Author', fileContentHash: HASH_A });
    const bookB = makeBook({ id: 'book-b', title: 'Same Title', author: 'Same Author', fileContentHash: HASH_A });
    bookRepository.findAllActive.mockResolvedValueOnce(Result.ok([bookA, bookB]));

    await processor.process(scanJob);

    expect(duplicateRepository.create).not.toHaveBeenCalled();
  });

  test('Flags pairs with same hash but different metadata', async () => {
    const bookA = makeBook({ id: 'book-a', title: 'Title One', author: 'Author', fileContentHash: HASH_A, createdAt: new Date('2026-01-01') });
    const bookB = makeBook({ id: 'book-b', title: 'Title Two', author: 'Author', fileContentHash: HASH_A, createdAt: new Date('2026-01-02') });
    bookRepository.findAllActive.mockResolvedValueOnce(Result.ok([bookA, bookB]));
    duplicateRepository.findByBookIds.mockResolvedValue(Result.fail(new BookDuplicateNotFoundFailure()));
    duplicateRepository.create.mockResolvedValueOnce(Result.ok({} as BookDuplicate));

    await processor.process(scanJob);

    expect(duplicateRepository.create).toHaveBeenCalledTimes(1);
  });

  test('Newer book is the suspect', async () => {
    const older = makeBook({ id: 'old-book', title: 'Title A', author: 'Author', fileContentHash: HASH_A, createdAt: new Date('2026-01-01') });
    const newer = makeBook({ id: 'new-book', title: 'Title B', author: 'Author', fileContentHash: HASH_A, createdAt: new Date('2026-06-01') });
    bookRepository.findAllActive.mockResolvedValueOnce(Result.ok([older, newer]));
    duplicateRepository.findByBookIds.mockResolvedValue(Result.fail(new BookDuplicateNotFoundFailure()));
    duplicateRepository.create.mockResolvedValueOnce(Result.ok({} as BookDuplicate));

    await processor.process(scanJob);

    const created: BookDuplicate = duplicateRepository.create.mock.calls[0][0];
    expect(created.suspectBookId).toBe('new-book');
    expect(created.originalBookId).toBe('old-book');
  });

  test('Does not re-flag pairs already in the duplicate table', async () => {
    const bookA = makeBook({ id: 'book-a', title: 'Title A', author: 'Author', fileContentHash: HASH_A });
    const bookB = makeBook({ id: 'book-b', title: 'Title B', author: 'Author', fileContentHash: HASH_A });
    bookRepository.findAllActive.mockResolvedValueOnce(Result.ok([bookA, bookB]));
    // Forward lookup succeeds — already tracked
    duplicateRepository.findByBookIds.mockResolvedValueOnce(Result.ok({} as BookDuplicate));

    await processor.process(scanJob);

    expect(duplicateRepository.create).not.toHaveBeenCalled();
  });

  test('Does not re-flag pairs already tracked in reverse order', async () => {
    const bookA = makeBook({ id: 'book-a', title: 'Title A', author: 'Author', fileContentHash: HASH_A });
    const bookB = makeBook({ id: 'book-b', title: 'Title B', author: 'Author', fileContentHash: HASH_A });
    bookRepository.findAllActive.mockResolvedValueOnce(Result.ok([bookA, bookB]));
    // Forward lookup fails, reverse lookup succeeds
    duplicateRepository.findByBookIds
      .mockResolvedValueOnce(Result.fail(new BookDuplicateNotFoundFailure()))
      .mockResolvedValueOnce(Result.ok({} as BookDuplicate));

    await processor.process(scanJob);

    expect(duplicateRepository.create).not.toHaveBeenCalled();
  });

  test('Books in different hash groups are not compared', async () => {
    const bookA = makeBook({ id: 'book-a', title: 'Title A', author: 'Author', fileContentHash: HASH_A });
    const bookB = makeBook({ id: 'book-b', title: 'Title B', author: 'Author', fileContentHash: HASH_B });
    bookRepository.findAllActive.mockResolvedValueOnce(Result.ok([bookA, bookB]));

    await processor.process(scanJob);

    expect(duplicateRepository.findByBookIds).not.toHaveBeenCalled();
    expect(duplicateRepository.create).not.toHaveBeenCalled();
  });

  test('Flags matching ISBN pairs as metadata match (no flagging)', async () => {
    const bookA = makeBook({ id: 'book-a', title: 'Title A', author: 'Author', isbn: '978-0000000001', fileContentHash: HASH_A });
    const bookB = makeBook({ id: 'book-b', title: 'Title B', author: 'Different Author', isbn: '978-0000000001', fileContentHash: HASH_A });
    bookRepository.findAllActive.mockResolvedValueOnce(Result.ok([bookA, bookB]));

    await processor.process(scanJob);

    // Same ISBN → metadataMatches() returns true → not flagged
    expect(duplicateRepository.create).not.toHaveBeenCalled();
  });
});
