import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ISettingRepository } from 'src/application/interfaces/setting-repository';
import { Setting } from 'src/domain/entities/setting.entity';
import { Result, UnexpectedFailure } from 'src/core/result';
import { SettingEntity } from 'src/infrastructure/database/setting.entity';
import { SettingMapper } from 'src/infrastructure/mappers/setting.mapper';
import { SettingNotFoundFailure } from 'src/domain/failures/setting.failures';

@Injectable()
export class TypeOrmSettingRepository implements ISettingRepository {
  private readonly logger = new Logger(TypeOrmSettingRepository.name);

  constructor(
    @InjectRepository(SettingEntity)
    private settingRepository: Repository<SettingEntity>,
  ) {}

  async findByKey(key: string): Promise<Result<Setting>> {
    try {
      const entity = await this.settingRepository.findOneBy({ key });
      if (!entity) {
        return Result.fail(new SettingNotFoundFailure());
      }
      return Result.ok(SettingMapper.toDomain(entity));
    } catch (error) {
      this.logger.error(error);
      return Result.fail(new UnexpectedFailure('Failed to retrieve setting'));
    }
  }

  async upsert(setting: Setting): Promise<Result<Setting>> {
    try {
      const entity = SettingMapper.toPersistence(setting);
      await this.settingRepository.save(entity);
      return Result.ok(setting);
    } catch (error) {
      this.logger.error(error);
      return Result.fail(new UnexpectedFailure('Failed to save setting'));
    }
  }
}
