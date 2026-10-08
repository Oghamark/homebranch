import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { EntitlementService } from 'src/modules/cloud/entitlement.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly entitlements: EntitlementService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const authenticated = (await super.canActivate(context)) as boolean;
    if (!authenticated || !this.entitlements.cloudMode) return authenticated;

    const request = context.switchToHttp().getRequest<{ method: string; user?: { id: string; roles: string[] } }>();
    const user = request.user;
    if (!user) return false;
    if (user.roles.includes('ADMIN')) return true;

    const state = await this.entitlements.getState(user.id);
    if (state === 'blocked') {
      throw new ForbiddenException('Your subscription is inactive');
    }
    if (state === 'read_only' && !SAFE_METHODS.has(request.method)) {
      throw new ForbiddenException('Your subscription is past due; the library is read-only');
    }
    return true;
  }
}
