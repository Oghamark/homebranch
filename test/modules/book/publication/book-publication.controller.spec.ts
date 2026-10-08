import { Readable } from 'stream';
import { NotFoundException } from '@nestjs/common';
import { BookPublicationController } from 'src/modules/book/publication/book-publication.controller';
import { BookFormatType } from 'src/modules/book/format/book-format-type.enum';

describe('BookPublicationController', () => {
  const publicationService = {};
  const bookService = {
    getDownload: jest.fn(),
    assertAccess: jest.fn(),
  };
  const storage = {
    getFileStream: jest.fn(),
  };
  const user = { id: 'user-1', email: 'u@x.com', roles: ['USER'] };
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    bookService.assertAccess.mockResolvedValue(undefined);
  });

  it('streams guarded downloads from storage', async () => {
    bookService.getDownload.mockResolvedValue({
      book: { title: 'Storage Book' },
      format: BookFormatType.EPUB,
      fileName: 'Storage Book.epub',
    });
    storage.getFileStream.mockResolvedValue({
      stream: Readable.from(Buffer.from('book')),
      mimeType: 'application/epub+zip',
      size: 4,
    });
    const controller = new BookPublicationController(
      publicationService as never,
      bookService as never,
      storage as never,
    );

    await expect(controller.downloadBook(user, 'book-1', {}, response as never)).resolves.toBeDefined();
    expect(storage.getFileStream).toHaveBeenCalledWith('books/Storage Book.epub');
    expect(response.status).not.toHaveBeenCalled();
  });

  it('checks ownership in cloud mode before downloading', async () => {
    process.env.CLOUD_MODE = 'true';
    bookService.assertAccess.mockRejectedValue(new NotFoundException('Book not found'));
    const controller = new BookPublicationController(
      publicationService as never,
      bookService as never,
      storage as never,
    );

    await expect(controller.downloadBook(user, 'book-1', {}, response as never)).rejects.toThrow(NotFoundException);
    expect(bookService.assertAccess).toHaveBeenCalledWith('book-1', 'user-1');
    expect(bookService.getDownload).not.toHaveBeenCalled();
    delete process.env.CLOUD_MODE;
  });

  it('preserves the existing 404 response shape for missing files', async () => {
    bookService.getDownload.mockResolvedValue({
      book: { title: 'Missing Book' },
      format: BookFormatType.EPUB,
      fileName: 'missing.epub',
    });
    storage.getFileStream.mockRejectedValue(new NotFoundException('missing'));
    const controller = new BookPublicationController(
      publicationService as never,
      bookService as never,
      storage as never,
    );

    await controller.downloadBook(user, 'book-1', {}, response as never);

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      error: 'BOOK_FILE_NOT_FOUND',
      message: 'Book file not found on server',
    });
  });
});
