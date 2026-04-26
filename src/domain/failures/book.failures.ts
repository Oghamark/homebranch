import { Failure } from 'src/core/result';
import { BookFormatType } from 'src/domain/entities/book-format.entity';

export class BookNotFoundFailure extends Failure {
  constructor() {
    super('BOOK_NOT_FOUND', 'Book not found');
  }
}

export class DeleteBookForbiddenFailure extends Failure {
  constructor() {
    super('FORBIDDEN', 'Only the uploader or an admin can delete this book');
  }
}

export class BookMissingMetadataFailure extends Failure {
  constructor(field: string) {
    super('MISSING_METADATA', `Could not determine "${field}" from the uploaded file. Please provide it manually.`);
  }
}

export class BookContentEntryNotFoundFailure extends Failure {
  constructor(entryPath: string) {
    super('BOOK_CONTENT_ENTRY_NOT_FOUND', `Content entry "${entryPath}" not found in publication`);
  }
}

export class BookFormatNotAvailableFailure extends Failure {
  constructor(format: BookFormatType) {
    super('BOOK_FORMAT_NOT_AVAILABLE', `Format "${format}" is not available for this book`);
  }
}

export class BookFormatUnsupportedFailure extends Failure {
  constructor(format: BookFormatType, action: string) {
    super('BOOK_FORMAT_UNSUPPORTED', `Format "${format}" does not support ${action}`);
  }
}

export class LinkBooksForbiddenFailure extends Failure {
  constructor() {
    super('FORBIDDEN', 'Only an admin or the owner of both books can link them');
  }
}

export class LinkBooksSameBookFailure extends Failure {
  constructor() {
    super('BAD_REQUEST', 'You cannot link a book to itself');
  }
}

export class LinkBooksFormatConflictFailure extends Failure {
  constructor(format: BookFormatType) {
    super('CONFLICT', `Both books already contain the "${format}" format`);
  }
}

export class UnlinkFormatNotFoundFailure extends Failure {
  constructor() {
    super('NOT_FOUND', 'The specified format was not found on this book');
  }
}

export class UnlinkFormatForbiddenFailure extends Failure {
  constructor() {
    super('FORBIDDEN', 'Only an admin or the book owner can unlink a format');
  }
}

export class UnlinkFormatLastFormatFailure extends Failure {
  constructor() {
    super('BAD_REQUEST', 'Cannot unlink the only format of a book');
  }
}
