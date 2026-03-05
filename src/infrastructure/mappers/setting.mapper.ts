import { Setting } from 'src/domain/entities/setting.entity';
import { SettingEntity } from 'src/infrastructure/database/setting.entity';

export class SettingMapper {
  static toDomain(entity: SettingEntity): Setting {
    return new Setting(entity.key, entity.value);
  }

  static toPersistence(setting: Setting): SettingEntity {
    return { key: setting.key, value: setting.value };
  }
}
