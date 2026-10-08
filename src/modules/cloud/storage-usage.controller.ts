import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { StorageQuotaService } from './storage-quota.service';

@Controller('storage')
@UseGuards(JwtAuthGuard)
export class StorageUsageController {
  constructor(private readonly quota: StorageQuotaService) {}

  @Get('usage')
  getUsage(@CurrentUser() currentUser: Express.User) {
    return this.quota.getUsage(currentUser.id);
  }
}
