import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Post,
  Query,
  Sse,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { IsArray, IsOptional, IsUUID } from 'class-validator';
import { JwtAuthGuard } from 'src/infrastructure/guards/jwt-auth.guard';
import { RolesGuard } from 'src/infrastructure/guards/roles.guard';
import { Roles } from 'src/infrastructure/guards/roles.decorator';
import { MapResultInterceptor } from 'src/presentation/interceptors/map_result.interceptor';
import { IBookRepository } from 'src/application/interfaces/book-repository';
import { Result } from 'src/core/result';
import { LibraryEventsService } from 'src/infrastructure/services/library-events.service';
import { Observable } from 'rxjs';

class OrphanedBooksDto {
  @IsArray()
  @IsUUID(undefined, { each: true })
  @IsOptional()
  knownUserIds: string[] = [];

  @IsOptional()
  limit?: number;

  @IsOptional()
  offset?: number;
}

@Controller('library')
@UseInterceptors(MapResultInterceptor)
export class LibrarySyncController {
  constructor(
    @InjectQueue('library-scan') private readonly libraryScanQueue: Queue,
    @InjectQueue('file-processing') private readonly fileProcessingQueue: Queue,
    @Inject('BookRepository') private readonly bookRepository: IBookRepository,
    private readonly libraryEventsService: LibraryEventsService,
  ) {}

  @Sse('events')
  @Header('Cache-Control', 'no-cache')
  @Header('X-Accel-Buffering', 'no')
  streamEvents(): Observable<MessageEvent> {
    return this.libraryEventsService.getStream();
  }

  @Post('scan')
  @UseGuards(JwtAuthGuard)
  async triggerScan() {
    const job = await this.libraryScanQueue.add(
      'scan-directory',
      {
        trigger: 'manual',
        booksDirectory: `${process.env.UPLOADS_DIRECTORY || './uploads'}/books`,
      },
      { removeOnComplete: 100, removeOnFail: 50 },
    );
    return Result.ok({ jobId: job.id });
  }

  @Post('books/:id/sync')
  @UseGuards(JwtAuthGuard)
  async triggerBookSync(@Param('id') id: string) {
    const job = await this.fileProcessingQueue.add(
      'sync-metadata',
      {
        bookId: id,
        fileName: '',
        filePath: '',
      },
      { jobId: `sync-${id}-manual`, removeOnComplete: 100, removeOnFail: 50 },
    );
    return Result.ok({ jobId: job.id });
  }

  @Get('unowned-books')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async getUnownedBooks(@Query('limit') limit?: number, @Query('offset') offset?: number) {
    const result = await this.bookRepository.findUnowned(limit ? Number(limit) : 20, offset ? Number(offset) : 0);
    if (!result.isSuccess()) return result;
    return Result.ok(result.value);
  }

  @Post('orphaned-books')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async getOrphanedBooks(@Body() dto: OrphanedBooksDto) {
    const result = await this.bookRepository.findOrphaned(dto.knownUserIds ?? [], dto.limit ?? 20, dto.offset ?? 0);
    if (!result.isSuccess()) return result;
    return Result.ok(result.value);
  }
}
