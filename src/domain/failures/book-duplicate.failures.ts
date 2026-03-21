import { Failure } from 'src/core/result';

export class BookDuplicateNotFoundFailure extends Failure {
  constructor() {
    super('BOOK_DUPLICATE_NOT_FOUND', 'Book duplicate record not found');
  }
}

export class BookDuplicateAlreadyResolvedFailure extends Failure {
  constructor() {
    super('BOOK_DUPLICATE_ALREADY_RESOLVED', 'This duplicate has already been resolved');
  }
}
