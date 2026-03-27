import { Failure } from 'src/core/result';

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
    super('MISSING_METADATA', `Could not determine "${field}" from the EPUB file. Please provide it manually.`);
  }
}

export class BookContentEntryNotFoundFailure extends Failure {
  constructor(entryPath: string) {
    super('BOOK_CONTENT_ENTRY_NOT_FOUND', `Content entry "${entryPath}" not found in publication`);
  }
}
