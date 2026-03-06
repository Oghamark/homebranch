import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingEntity } from 'src/infrastructure/database/setting.entity';
import { TypeOrmSettingRepository } from 'src/infrastructure/repositories/setting.repository';
import { UpsertSettingUseCase } from 'src/application/usecases/setting/upsert-setting.usecase';
import { GetSettingUseCase } from 'src/application/usecases/setting/get-setting.usecase';
import { SettingsController } from 'src/presentation/controllers/settings.controller';
import { AuthModule } from 'src/modules/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([SettingEntity]), AuthModule],
  providers: [
    {
      provide: 'SettingRepository',
      useClass: TypeOrmSettingRepository,
    },
    UpsertSettingUseCase,
    GetSettingUseCase,
  ],
  controllers: [SettingsController],
  exports: ['SettingRepository'],
})
export class SettingsModule {}
