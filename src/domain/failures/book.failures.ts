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
