import { Inject, Injectable } from '@nestjs/common';
import { ISettingRepository } from 'src/application/interfaces/setting-repository';
import { Setting } from 'src/domain/entities/setting.entity';
import { Result } from 'src/core/result';
import { UseCase } from 'src/core/usecase';

export interface GetSettingRequest {
  key: string;
}

@Injectable()
export class GetSettingUseCase implements UseCase<GetSettingRequest, Setting> {
  constructor(@Inject('SettingRepository') private settingRepository: ISettingRepository) {}

  async execute(request: GetSettingRequest): Promise<Result<Setting>> {
    return this.settingRepository.findByKey(request.key);
  }
}
