import {
  BookDuplicateNotFoundFailure,
  BookDuplicateAlreadyResolvedFailure,
} from 'src/domain/failures/book-duplicate.failures';

describe('BookDuplicateNotFoundFailure', () => {
  test('Has correct error code', () => {
    const failure = new BookDuplicateNotFoundFailure();
    expect(failure.code).toBe('BOOK_DUPLICATE_NOT_FOUND');
  });

  test('Has a descriptive message', () => {
    const failure = new BookDuplicateNotFoundFailure();
    expect(failure.message).toBeTruthy();
    expect(typeof failure.message).toBe('string');
  });
});

describe('BookDuplicateAlreadyResolvedFailure', () => {
  test('Has correct error code', () => {
    const failure = new BookDuplicateAlreadyResolvedFailure();
    expect(failure.code).toBe('BOOK_DUPLICATE_ALREADY_RESOLVED');
  });

  test('Has a descriptive message', () => {
    const failure = new BookDuplicateAlreadyResolvedFailure();
    expect(failure.message).toBeTruthy();
    expect(typeof failure.message).toBe('string');
  });

  test('Distinct codes from each other', () => {
    const notFound = new BookDuplicateNotFoundFailure();
    const alreadyResolved = new BookDuplicateAlreadyResolvedFailure();
    expect(notFound.code).not.toBe(alreadyResolved.code);
  });
});
