import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { InvalidTokenError, TokenExpiredError } from 'src/modules/auth/auth.exceptions';
import { HttpAuthGateway } from 'src/modules/auth/http-auth.gateway';
import { JwtTokenGateway } from 'src/modules/auth/jwt-token.gateway';

@Injectable()
export class OpdsBasicAuthGuard implements CanActivate {
  private readonly logger = new Logger(OpdsBasicAuthGuard.name);

  constructor(
    private readonly authGateway: HttpAuthGateway,
    private readonly tokenGateway: JwtTokenGateway,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: Request = context.switchToHttp().getRequest();

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Basic ')) {
      this.logger.warn('OPDS Basic authentication failed: missing or invalid authorization header');
      throw new UnauthorizedException('Basic authentication required');
    }

    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
    const colonIndex = decoded.indexOf(':');
    if (colonIndex === -1) {
      this.logger.warn('OPDS Basic authentication failed: invalid authorization header format');
      throw new UnauthorizedException('Invalid Basic auth format');
    }

    const email = decoded.slice(0, colonIndex);
    const password = decoded.slice(colonIndex + 1);

    let accessToken: string;
    try {
      accessToken = await this.authGateway.login(email, password);
    } catch {
      this.logger.warn('OPDS Basic authentication failed: invalid credentials');
      throw new UnauthorizedException('Invalid credentials');
    }

    try {
      const payload = await this.tokenGateway.verifyAccessToken(accessToken);
      request['user'] = { id: payload.userId, email: payload.email, roles: payload.roles };
      this.logger.log(`OPDS Basic authentication succeeded (user id: ${payload.userId})`);
      return true;
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        this.logger.warn('OPDS Basic authentication failed: token expired');
        throw new UnauthorizedException('Token has expired');
      }
      if (error instanceof InvalidTokenError) {
        this.logger.warn('OPDS Basic authentication failed: invalid token');
        throw error;
      }
      this.logger.warn('OPDS Basic authentication failed: token verification error');
      throw new UnauthorizedException('Invalid token');
    }
  }
}
