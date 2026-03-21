import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { BookDuplicateEntity } from 'src/infrastructure/database/book-duplicate.entity';
import { BookDuplicateMapper } from 'src/infrastructure/mappers/book-duplicate.mapper';
import {
  IBookDuplicateRepository,
  BookDuplicateWithBooks,
} from 'src/application/interfaces/book-duplicate-repository';
import { BookDuplicate, DuplicateResolution } from 'src/domain/entities/book-duplicate.entity';
import { BookDuplicateNotFoundFailure } from 'src/domain/failures/book-duplicate.failures';
import { Result } from 'src/core/result';
import { PaginationResult } from 'src/core/pagination_result';

@Injectable()
export class TypeOrmBookDuplicateRepository implements IBookDuplicateRepository {
  constructor(
    @InjectRepository(BookDuplicateEntity)
    private readonly repository: Repository<BookDuplicateEntity>,
  ) {}

  async create(duplicate: BookDuplicate): Promise<Result<BookDuplicate>> {
    const entity = this.repository.create(BookDuplicateMapper.toPersistence(duplicate));
    const saved = await this.repository.save(entity);
    return Result.ok(BookDuplicateMapper.toDomain(saved));
  }

  async findById(id: string): Promise<Result<BookDuplicate>> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) return Result.fail(new BookDuplicateNotFoundFailure());
    return Result.ok(BookDuplicateMapper.toDomain(entity));
  }

  async findByBookIds(suspectBookId: string, originalBookId: string): Promise<Result<BookDuplicate>> {
    const entity = await this.repository.findOne({
      where: { suspectBookId, originalBookId, resolvedAt: IsNull() },
    });
    if (!entity) return Result.fail(new BookDuplicateNotFoundFailure());
    return Result.ok(BookDuplicateMapper.toDomain(entity));
  }

  async listUnresolved(limit?: number, offset?: number): Promise<Result<PaginationResult<BookDuplicateWithBooks[]>>> {
    const [entities, total] = await this.repository.findAndCount({
      where: { resolvedAt: IsNull() },
      relations: { suspectBook: true, originalBook: true },
      order: { detectedAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return Result.ok({
      data: entities.map((e) => BookDuplicateMapper.toDomainWithBooks(e)),
      limit,
      offset,
      total,
      nextCursor: offset != null && limit != null && total > offset + limit ? offset + limit : null,
    });
  }

  async resolve(id: string, resolution: DuplicateResolution, resolvedByUserId: string): Promise<Result<BookDuplicate>> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) return Result.fail(new BookDuplicateNotFoundFailure());

    entity.resolution = resolution;
    entity.resolvedAt = new Date();
    entity.resolvedByUserId = resolvedByUserId;

    const saved = await this.repository.save(entity);
    return Result.ok(BookDuplicateMapper.toDomain(saved));
  }
}
