import { BookDuplicateMapper } from 'src/infrastructure/mappers/book-duplicate.mapper';
import { BookDuplicateEntity } from 'src/infrastructure/database/book-duplicate.entity';
import { BookDuplicate } from 'src/domain/entities/book-duplicate.entity';
import { mockBook, mockBookFavorite } from 'test/mocks/bookMocks';
import { mockBookEntity } from 'test/mocks/entityMocks';

const detectedAt = new Date('2026-01-01T00:00:00Z');
const resolvedAt = new Date('2026-01-02T00:00:00Z');

const mockDuplicateEntity: BookDuplicateEntity = {
  id: 'dup-1',
  suspectBookId: 'book-456',
  originalBookId: 'book-fav',
  detectedAt,
  resolvedAt: undefined,
  resolution: undefined,
  resolvedByUserId: undefined,
  suspectBook: mockBookEntity,
  originalBook: { ...mockBookEntity, id: mockBookFavorite.id, title: mockBookFavorite.title, author: mockBookFavorite.author, fileName: mockBookFavorite.fileName, isFavorite: true },
};

const mockResolvedEntity: BookDuplicateEntity = {
  ...mockDuplicateEntity,
  id: 'dup-2',
  resolvedAt,
  resolution: 'merge',
  resolvedByUserId: 'admin-1',
};

describe('BookDuplicateMapper', () => {
  describe('toDomain', () => {
    test('Maps unresolved entity to domain object', () => {
      const result = BookDuplicateMapper.toDomain(mockDuplicateEntity);

      expect(result).toBeInstanceOf(BookDuplicate);
      expect(result.id).toBe('dup-1');
      expect(result.suspectBookId).toBe('book-456');
      expect(result.originalBookId).toBe('book-fav');
      expect(result.detectedAt).toBe(detectedAt);
      expect(result.resolvedAt).toBeUndefined();
      expect(result.resolution).toBeUndefined();
      expect(result.resolvedByUserId).toBeUndefined();
    });

    test('Maps resolved entity to domain object with resolution fields', () => {
      const result = BookDuplicateMapper.toDomain(mockResolvedEntity);

      expect(result.resolvedAt).toBe(resolvedAt);
      expect(result.resolution).toBe('merge');
      expect(result.resolvedByUserId).toBe('admin-1');
    });

    test('Maps keep_both resolution', () => {
      const entity = { ...mockResolvedEntity, resolution: 'keep_both' };
      const result = BookDuplicateMapper.toDomain(entity);
      expect(result.resolution).toBe('keep_both');
    });

    test('Maps replace resolution', () => {
      const entity = { ...mockResolvedEntity, resolution: 'replace' };
      const result = BookDuplicateMapper.toDomain(entity);
      expect(result.resolution).toBe('replace');
    });
  });

  describe('toDomainWithBooks', () => {
    test('Includes mapped suspect and original books', () => {
      const result = BookDuplicateMapper.toDomainWithBooks(mockDuplicateEntity);

      expect(result.duplicate).toBeInstanceOf(BookDuplicate);
      expect(result.suspectBook.id).toBe(mockBook.id);
      expect(result.originalBook.id).toBe(mockBookFavorite.id);
    });

    test('Duplicate inside result matches toDomain output', () => {
      const result = BookDuplicateMapper.toDomainWithBooks(mockDuplicateEntity);
      const fromToDomain = BookDuplicateMapper.toDomain(mockDuplicateEntity);

      expect(result.duplicate.id).toBe(fromToDomain.id);
      expect(result.duplicate.suspectBookId).toBe(fromToDomain.suspectBookId);
    });
  });

  describe('toPersistence', () => {
    test('Maps unresolved domain object to persistence', () => {
      const duplicate = new BookDuplicate('dup-1', 'book-456', 'book-fav', detectedAt);
      const result = BookDuplicateMapper.toPersistence(duplicate);

      expect(result.id).toBe('dup-1');
      expect(result.suspectBookId).toBe('book-456');
      expect(result.originalBookId).toBe('book-fav');
      expect(result.detectedAt).toBe(detectedAt);
      expect(result.resolvedAt).toBeNull();
      expect(result.resolution).toBeNull();
      expect(result.resolvedByUserId).toBeNull();
    });

    test('Maps resolved domain object to persistence with resolution fields', () => {
      const duplicate = new BookDuplicate('dup-2', 'book-456', 'book-fav', detectedAt, resolvedAt, 'merge', 'admin-1');
      const result = BookDuplicateMapper.toPersistence(duplicate);

      expect(result.resolvedAt).toBe(resolvedAt);
      expect(result.resolution).toBe('merge');
      expect(result.resolvedByUserId).toBe('admin-1');
    });

    test('Round-trips through toDomain → toPersistence', () => {
      const domain = BookDuplicateMapper.toDomain(mockResolvedEntity);
      const persistence = BookDuplicateMapper.toPersistence(domain);

      expect(persistence.id).toBe(mockResolvedEntity.id);
      expect(persistence.suspectBookId).toBe(mockResolvedEntity.suspectBookId);
      expect(persistence.originalBookId).toBe(mockResolvedEntity.originalBookId);
      expect(persistence.resolution).toBe(mockResolvedEntity.resolution);
    });
  });
});
