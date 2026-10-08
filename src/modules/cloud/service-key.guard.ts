import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';

/** Authenticates server-to-server calls from the portal. */
@Injectable()
export class PortalServiceKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const expectedKey = process.env.PORTAL_SERVICE_KEY;
    if (!expectedKey) throw new UnauthorizedException();
    const provided = Buffer.from(request.headers.authorization?.replace(/^Bearer /, '') ?? '');
    const expected = Buffer.from(expectedKey);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
