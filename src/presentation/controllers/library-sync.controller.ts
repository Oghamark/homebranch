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
import { IsArray, IsOptional, IsUUID } from 'class-validator';
import { JwtAuthGuard } from 'src/presentation/guards/jwt-auth.guard';
import { RolesGuard } from 'src/presentation/guards/roles.guard';
import { Roles } from 'src/presentation/guards/roles.decorator';
import { MapResultInterceptor } from 'src/presentation/interceptors/map_result.interceptor';
import { ILibraryEventsService } from 'src/application/interfaces/library-events-service';
import { Observable } from 'rxjs';
import { TriggerLibraryScanUseCase } from 'src/application/usecases/library/trigger-library-scan.usecase';
import { TriggerBookMetadataSyncUseCase } from 'src/application/usecases/library/trigger-book-metadata-sync.usecase';
import { GetUnownedBooksUseCase } from 'src/application/usecases/book/get-unowned-books.usecase';
import { GetOrphanedBooksUseCase } from 'src/application/usecases/book/get-orphaned-books.usecase';

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
    private readonly triggerLibraryScanUseCase: TriggerLibraryScanUseCase,
    private readonly triggerBookMetadataSyncUseCase: TriggerBookMetadataSyncUseCase,
    private readonly getUnownedBooksUseCase: GetUnownedBooksUseCase,
    private readonly getOrphanedBooksUseCase: GetOrphanedBooksUseCase,
    @Inject('LibraryEventsService') private readonly libraryEventsService: ILibraryEventsService,
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
    const booksDirectory = `${process.env.UPLOADS_DIRECTORY || './uploads'}/books`;
    return this.triggerLibraryScanUseCase.execute({ booksDirectory });
  }

  @Post('books/:id/sync')
  @UseGuards(JwtAuthGuard)
  async triggerBookSync(@Param('id') id: string) {
    return this.triggerBookMetadataSyncUseCase.execute({ bookId: id });
  }

  @Get('unowned-books')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async getUnownedBooks(@Query('limit') limit?: number, @Query('offset') offset?: number) {
    return this.getUnownedBooksUseCase.execute({
      limit: limit ? Number(limit) : 20,
      offset: offset ? Number(offset) : 0,
    });
  }

  @Post('orphaned-books')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async getOrphanedBooks(@Body() dto: OrphanedBooksDto) {
    return this.getOrphanedBooksUseCase.execute({
      knownUserIds: dto.knownUserIds ?? [],
      limit: dto.limit ?? 20,
      offset: dto.offset ?? 0,
    });
  }
}
