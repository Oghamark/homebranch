import { Inject, Injectable } from '@nestjs/common';
import { ISettingRepository } from 'src/application/interfaces/setting-repository';
import { Setting } from 'src/domain/entities/setting.entity';
import { Result } from 'src/core/result';
import { UseCase } from 'src/core/usecase';
import { UpsertSettingRequest } from 'src/application/contracts/setting/upsert-setting-request';

@Injectable()
export class UpsertSettingUseCase implements UseCase<UpsertSettingRequest, Setting> {
  constructor(@Inject('SettingRepository') private settingRepository: ISettingRepository) {}

  async execute(request: UpsertSettingRequest): Promise<Result<Setting>> {
    return this.settingRepository.upsert(new Setting(request.key, request.value));
  }
}
