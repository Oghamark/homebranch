import { Controller, Delete, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { isCloudMode } from 'src/common/utils/cloud';
import { PortalServiceKeyGuard } from './service-key.guard';
import { TenantPurgeService } from './tenant-purge.service';

@Controller('internal/tenants')
@UseGuards(PortalServiceKeyGuard)
export class TenantPurgeController {
  constructor(private readonly purgeService: TenantPurgeService) {}

  @Delete(':userId')
  purge(@Param('userId') userId: string) {
    if (!isCloudMode()) throw new NotFoundException();
    return this.purgeService.purge(userId);
  }
}
