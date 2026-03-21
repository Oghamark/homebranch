import { BookDuplicate, DuplicateResolution } from 'src/domain/entities/book-duplicate.entity';
import { BookDuplicateEntity } from 'src/infrastructure/database/book-duplicate.entity';
import { BookMapper } from './book.mapper';
import { BookDuplicateWithBooks } from 'src/application/interfaces/book-duplicate-repository';

export class BookDuplicateMapper {
  static toDomain(entity: BookDuplicateEntity): BookDuplicate {
    return new BookDuplicate(
      entity.id,
      entity.suspectBookId,
      entity.originalBookId,
      entity.detectedAt,
      entity.resolvedAt ?? undefined,
      (entity.resolution as DuplicateResolution) ?? undefined,
      entity.resolvedByUserId ?? undefined,
    );
  }

  static toDomainWithBooks(entity: BookDuplicateEntity): BookDuplicateWithBooks {
    return {
      duplicate: BookDuplicateMapper.toDomain(entity),
      suspectBook: BookMapper.toDomain(entity.suspectBook),
      originalBook: BookMapper.toDomain(entity.originalBook),
    };
  }

  static toPersistence(duplicate: BookDuplicate): Partial<BookDuplicateEntity> {
    return {
      id: duplicate.id,
      suspectBookId: duplicate.suspectBookId,
      originalBookId: duplicate.originalBookId,
      detectedAt: duplicate.detectedAt,
      resolvedAt: duplicate.resolvedAt ?? (null as unknown as undefined),
      resolution: duplicate.resolution ?? (null as unknown as undefined),
      resolvedByUserId: duplicate.resolvedByUserId ?? (null as unknown as undefined),
    };
  }
}
