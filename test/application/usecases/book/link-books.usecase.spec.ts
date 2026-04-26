import { Test, TestingModule } from '@nestjs/testing';
import { mock } from 'jest-mock-extended';
import Mocked = jest.Mocked;
import { IBookRepository } from 'src/application/interfaces/book-repository';
import { LinkBooksUseCase } from 'src/application/usecases/book/link-books.usecase';
import { Result } from 'src/core/result';
import { BookFactory } from 'src/domain/entities/book.factory';
import { BookFormat, BookFormatType } from 'src/domain/entities/book-format.entity';
import {
  LinkBooksForbiddenFailure,
  LinkBooksFormatConflictFailure,
  LinkBooksSameBookFailure,
} from 'src/domain/failures/book.failures';

describe('LinkBooksUseCase', () => {
  let useCase: LinkBooksUseCase;
  let bookRepository: Mocked<IBookRepository>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LinkBooksUseCase,
        {
          provide: 'BookRepository',
          useValue: mock<IBookRepository>(),
        },
      ],
    }).compile();

    useCase = module.get(LinkBooksUseCase);
    bookRepository = module.get('BookRepository');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function buildBook(id: string, title: string, author: string, format: BookFormatType, fileName: string, owner = 'user-123') {
    return BookFactory.create(
      id,
      title,
      author,
      fileName,
      false,
      [],
      undefined,
      undefined,
      undefined,
      owner,
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
      `${id}-hash`,
      undefined,
      [
        new BookFormat({
          id: `format-${id}`,
          format,
          fileName,
          fileContentHash: `${id}-hash`,
        }),
      ],
    );
  }

  test('links a source PDF book into a target EPUB book', async () => {
    const target = buildBook('target', 'Shared Title', 'Shared Author', BookFormatType.EPUB, 'Shared Author - Shared Title.epub');
    const source = buildBook('source', 'Shared Title', 'Shared Author', BookFormatType.PDF, 'Shared Author - Shared Title.pdf');

    bookRepository.findById.mockResolvedValueOnce(Result.ok(target)).mockResolvedValueOnce(Result.ok(source));
    bookRepository.update.mockImplementation(async (_id, book) => Result.ok(book));
    bookRepository.permanentDelete.mockResolvedValue(Result.ok(source));

    const result = await useCase.execute({
      targetBookId: target.id,
      sourceBookId: source.id,
      requestingUserId: 'user-123',
      requestingUserRole: 'USER',
    });

    expect(result.isSuccess()).toBe(true);
    expect(bookRepository.update).toHaveBeenCalledTimes(2);
    expect(bookRepository.permanentDelete).toHaveBeenCalledWith(source.id);

    const updatedTarget = bookRepository.update.mock.calls[0][1];
    expect(updatedTarget.formats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ format: BookFormatType.EPUB }),
        expect.objectContaining({ format: BookFormatType.PDF }),
      ]),
    );

    const preparedSource = bookRepository.update.mock.calls[1][1];
    expect(preparedSource.formats).toEqual([]);
  });

  test('rejects linking a book to itself', async () => {
    const result = await useCase.execute({
      targetBookId: 'book-1',
      sourceBookId: 'book-1',
      requestingUserId: 'user-123',
      requestingUserRole: 'USER',
    });

    expect(result.isFailure()).toBe(true);
    expect(result.failure).toBeInstanceOf(LinkBooksSameBookFailure);
  });

  test('rejects linking when both books already have the same format', async () => {
    const target = buildBook('target', 'Shared Title', 'Shared Author', BookFormatType.EPUB, 'one.epub');
    const source = buildBook('source', 'Shared Title', 'Shared Author', BookFormatType.EPUB, 'two.epub');

    bookRepository.findById.mockResolvedValueOnce(Result.ok(target)).mockResolvedValueOnce(Result.ok(source));

    const result = await useCase.execute({
      targetBookId: target.id,
      sourceBookId: source.id,
      requestingUserId: 'user-123',
      requestingUserRole: 'USER',
    });

    expect(result.isFailure()).toBe(true);
    expect(result.failure).toBeInstanceOf(LinkBooksFormatConflictFailure);
  });

  test('rejects linking when the requester does not own both books', async () => {
    const target = buildBook('target', 'Shared Title', 'Shared Author', BookFormatType.EPUB, 'one.epub', 'user-123');
    const source = buildBook('source', 'Shared Title', 'Shared Author', BookFormatType.PDF, 'two.pdf', 'user-456');

    bookRepository.findById.mockResolvedValueOnce(Result.ok(target)).mockResolvedValueOnce(Result.ok(source));

    const result = await useCase.execute({
      targetBookId: target.id,
      sourceBookId: source.id,
      requestingUserId: 'user-123',
      requestingUserRole: 'USER',
    });

    expect(result.isFailure()).toBe(true);
    expect(result.failure).toBeInstanceOf(LinkBooksForbiddenFailure);
  });
});
