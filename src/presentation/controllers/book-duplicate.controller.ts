import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from 'src/infrastructure/guards/jwt-auth.guard';
import { RolesGuard } from 'src/infrastructure/guards/roles.guard';
import { Roles } from 'src/infrastructure/guards/roles.decorator';
import { MapResultInterceptor } from '../interceptors/map_result.interceptor';
import { CurrentUser } from 'src/infrastructure/decorators/current-user.decorator';
import { PaginatedQuery } from 'src/core/paginated-query';
import { ListDuplicatesUseCase } from 'src/application/usecases/book/list-duplicates.usecase';
import { ResolveDuplicateUseCase } from 'src/application/usecases/book/resolve-duplicate.usecase';
import { ScanDuplicatesUseCase } from 'src/application/usecases/book/scan-duplicates.usecase';
import { ResolveDuplicateDto } from '../dtos/resolve-duplicate.dto';
import { Result } from 'src/core/result';

@Controller('books/duplicates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@UseInterceptors(MapResultInterceptor)
export class BookDuplicateController {
  constructor(
    private readonly listDuplicatesUseCase: ListDuplicatesUseCase,
    private readonly resolveDuplicateUseCase: ResolveDuplicateUseCase,
    private readonly scanDuplicatesUseCase: ScanDuplicatesUseCase,
  ) {}

  @Get()
  listDuplicates(@Query() query: PaginatedQuery) {
    return this.listDuplicatesUseCase.execute({ limit: query.limit, offset: query.offset });
  }

  @Post('scan')
  @HttpCode(202)
  async triggerScan() {
    await this.scanDuplicatesUseCase.execute();
    return Result.ok({ message: 'Duplicate scan job enqueued' });
  }

  @Post(':id/resolve')
  resolveDuplicate(
    @Param('id') id: string,
    @Body() dto: ResolveDuplicateDto,
    @CurrentUser() currentUser: Express.User,
  ) {
    return this.resolveDuplicateUseCase.execute({
      id,
      action: dto.action,
      resolvedByUserId: currentUser.id,
    });
  }
}
