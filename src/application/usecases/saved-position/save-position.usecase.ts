import { Inject, Injectable, Logger } from '@nestjs/common';
import { ISavedPositionRepository } from '../../interfaces/saved-position-repository';
import { SavePositionRequest } from '../../contracts/saved-position/save-position-request';
import { SavedPosition } from 'src/domain/entities/saved-position.entity';
import { SavedPositionFactory } from 'src/domain/entities/saved-position.factory';
import { Result } from 'src/core/result';
import { UseCase } from 'src/core/usecase';

@Injectable()
export class SavePositionUseCase implements UseCase<SavePositionRequest, SavedPosition> {
  constructor(
    @Inject('SavedPositionRepository')
    private savedPositionRepository: ISavedPositionRepository,
  ) {}

  logger = new Logger(SavePositionUseCase.name);

  async execute(request: SavePositionRequest): Promise<Result<SavedPosition>> {
    this.logger.debug('Received request to save position', {
      bookId: request.bookId,
      userId: request.userId,
      position: request.position,
      deviceName: request.deviceName,
      percentage: request.percentage,
    });
    const savedPosition = SavedPositionFactory.create(
      request.bookId,
      request.userId,
      request.position,
      request.deviceName,
      request.percentage,
    );
    const result = await this.savedPositionRepository.upsert(savedPosition);

    if (result.isFailure()) {
      this.logger.warn('Failed to save position');
    }

    this.logger.debug('Execution finished');
    return result;
  }
}
