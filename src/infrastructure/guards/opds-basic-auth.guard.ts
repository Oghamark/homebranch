import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { IAuthGateway } from 'src/application/interfaces/auth-gateway';
import { ITokenGateway } from 'src/application/interfaces/jwt-token.gateway';
import { InvalidTokenError, TokenExpiredError } from 'src/domain/exceptions/auth.exceptions';

@Injectable()
export class OpdsBasicAuthGuard implements CanActivate {
  constructor(
    @Inject('AuthGateway') private readonly authGateway: IAuthGateway,
    @Inject('TokenGateway') private readonly tokenGateway: ITokenGateway,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: Request = context.switchToHttp().getRequest();

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Basic ')) {
      throw new UnauthorizedException('Basic authentication required');
    }

    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
    const colonIndex = decoded.indexOf(':');
    if (colonIndex === -1) {
      throw new UnauthorizedException('Invalid Basic auth format');
    }

    const email = decoded.slice(0, colonIndex);
    const password = decoded.slice(colonIndex + 1);

    let accessToken: string;
    try {
      accessToken = await this.authGateway.login(email, password);
    } catch {
      throw new UnauthorizedException('Invalid credentials');
    }

    try {
      const payload = await this.tokenGateway.verifyAccessToken(accessToken);
      request['user'] = { id: payload.userId, email: payload.email, roles: payload.roles };
      return true;
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        throw new UnauthorizedException('Token has expired');
      }
      if (error instanceof InvalidTokenError) {
        throw error;
      }
      throw new UnauthorizedException('Invalid token');
    }
  }
}
