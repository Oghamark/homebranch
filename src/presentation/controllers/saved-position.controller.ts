import { Body, Controller, Delete, Get, HttpCode, Param, Put, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from 'src/presentation/guards/jwt-auth.guard';
import { MapResultInterceptor } from '../interceptors/map_result.interceptor';
import { GetSavedPositionsUseCase } from 'src/application/usecases/saved-position/get-saved-positions.usecase';
import { GetSavedPositionUseCase } from 'src/application/usecases/saved-position/get-saved-position.usecase';
import { SavePositionUseCase } from 'src/application/usecases/saved-position/save-position.usecase';
import { DeleteSavedPositionUseCase } from 'src/application/usecases/saved-position/delete-saved-position.usecase';
import { SavePositionDto } from '../dtos/save-position.dto';
import { CurrentUser } from 'src/presentation/decorators/current-user.decorator';

@Controller('users/:userId/saved-positions')
@UseInterceptors(MapResultInterceptor)
@UseGuards(JwtAuthGuard)
export class SavedPositionController {
  constructor(
    private readonly getSavedPositionsUseCase: GetSavedPositionsUseCase,
    private readonly getSavedPositionUseCase: GetSavedPositionUseCase,
    private readonly savePositionUseCase: SavePositionUseCase,
    private readonly deleteSavedPositionUseCase: DeleteSavedPositionUseCase,
  ) {}

  @Get()
  getSavedPositions(@CurrentUser() currentUser: Express.User) {
    return this.getSavedPositionsUseCase.execute({ userId: currentUser.id });
  }

  @Get(':bookId')
  getSavedPosition(@CurrentUser() currentUser: Express.User, @Param('bookId') bookId: string) {
    return this.getSavedPositionUseCase.execute({ bookId, userId: currentUser.id });
  }

  @Put(':bookId')
  savePosition(
    @CurrentUser() currentUser: Express.User,
    @Param('bookId') bookId: string,
    @Body() dto: SavePositionDto,
  ) {
    return this.savePositionUseCase.execute({
      bookId,
      userId: currentUser.id,
      position: dto.position,
      deviceName: dto.deviceName,
      percentage: dto.percentage,
    });
  }

  @Delete(':bookId')
  @HttpCode(204)
  deleteSavedPosition(@CurrentUser() currentUser: Express.User, @Param('bookId') bookId: string) {
    return this.deleteSavedPositionUseCase.execute({ bookId, userId: currentUser.id });
  }
}
