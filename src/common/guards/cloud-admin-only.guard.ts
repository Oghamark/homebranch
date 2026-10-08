import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { isAdminUser, isCloudMode, TenantUser } from 'src/common/utils/cloud';

/** Blocks routes that expose instance-wide data or operations from tenants in cloud mode. */
@Injectable()
export class CloudAdminOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (!isCloudMode()) return true;
    const user = context.switchToHttp().getRequest<{ user?: TenantUser }>().user;
    if (!user || !isAdminUser(user)) {
      throw new ForbiddenException('Not available on the hosted service');
    }
    return true;
  }
}
