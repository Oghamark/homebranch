import { Body, Controller, Get, Param, Put, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from 'src/infrastructure/guards/jwt-auth.guard';
import { RolesGuard } from 'src/infrastructure/guards/roles.guard';
import { Roles } from 'src/infrastructure/guards/roles.decorator';
import { MapResultInterceptor } from '../interceptors/map_result.interceptor';
import { UpsertSettingUseCase } from 'src/application/usecases/setting/upsert-setting.usecase';
import { GetSettingUseCase } from 'src/application/usecases/setting/get-setting.usecase';
import { UpsertSettingDto } from '../dtos/upsert-setting.dto';

@Controller('settings')
@UseInterceptors(MapResultInterceptor)
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class SettingsController {
  constructor(
    private readonly upsertSettingUseCase: UpsertSettingUseCase,
    private readonly getSettingUseCase: GetSettingUseCase,
  ) {}

  @Get(':key')
  getSetting(@Param('key') key: string) {
    return this.getSettingUseCase.execute({ key });
  }

  @Put(':key')
  upsertSetting(@Param('key') key: string, @Body() dto: UpsertSettingDto) {
    return this.upsertSettingUseCase.execute({ key, value: dto.value });
  }
}
