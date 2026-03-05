import { Inject, Injectable } from '@nestjs/common';
import { IAuthorRepository } from 'src/application/interfaces/author-repository';
import { GetAuthorRequest } from 'src/application/contracts/author/get-author-request';
import { Author } from 'src/domain/entities/author.entity';
import { AuthorFactory } from 'src/domain/entities/author.factory';
import { randomUUID } from 'crypto';
import { Result } from 'src/core/result';
import { UseCase } from 'src/core/usecase';
import { IMetadataGateway } from 'src/application/interfaces/metadata-gateway';

@Injectable()
export class GetAuthorUseCase implements UseCase<GetAuthorRequest, Author> {
  constructor(
    @Inject('AuthorRepository') private authorRepository: IAuthorRepository,
    @Inject('MetadataGateway') private readonly metadataGateway: IMetadataGateway,
  ) {}

  async execute({ name }: GetAuthorRequest): Promise<Result<Author>> {
    const existingResult = await this.authorRepository.findByName(name);
    if (existingResult.isSuccess()) {
      const existing = existingResult.value;
      if (existing.biography !== null || existing.profilePictureUrl !== null) {
        return existingResult;
      }
      // Author exists but was stored without enrichment — retry Open Library
      const author = await this.metadataGateway.enrichAuthor(existing);
      return await this.authorRepository.updateByName(author.name, author);
    }

    let author = AuthorFactory.create(randomUUID(), name);
    author = await this.metadataGateway.enrichAuthor(author);

    return await this.authorRepository.create(author);
  }
}
