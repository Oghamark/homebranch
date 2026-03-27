import { Inject, Injectable, Logger } from '@nestjs/common';
import { IBookRepository } from 'src/application/interfaces/book-repository';
import { IPublicationManifestService } from 'src/application/interfaces/publication-manifest-service';
import { Result } from 'src/core/result';
import { UseCase } from 'src/core/usecase';

export interface GetBookManifestRequest {
  id: string;
  baseUrl: string;
}

@Injectable()
export class GetBookManifestUseCase implements UseCase<GetBookManifestRequest, object> {
  private readonly logger = new Logger(GetBookManifestUseCase.name);

  constructor(
    @Inject('BookRepository') private readonly bookRepository: IBookRepository,
    @Inject('PublicationManifestService')
    private readonly manifestService: IPublicationManifestService,
  ) {}

  async execute({ id, baseUrl }: GetBookManifestRequest): Promise<Result<object>> {
    this.logger.log(`Generating publication manifest for book "${id}"`);

    const bookResult = await this.bookRepository.findById(id);
    if (bookResult.isFailure()) return Result.fail(bookResult.failure);

    const manifest = this.manifestService.generateManifest(bookResult.value!, baseUrl);
    return Result.ok(manifest);
  }
}
