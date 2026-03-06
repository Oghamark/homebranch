import { Setting } from 'src/domain/entities/setting.entity';
import { Result } from 'src/core/result';

export interface ISettingRepository {
  findByKey(key: string): Promise<Result<Setting>>;
  upsert(setting: Setting): Promise<Result<Setting>>;
}
