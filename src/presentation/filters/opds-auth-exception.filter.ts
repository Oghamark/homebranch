import { ArgumentsHost, Catch, ExceptionFilter, UnauthorizedException } from '@nestjs/common';
import { Request, Response } from 'express';

export function buildOpdsAuthDocument(authDocUrl: string) {
  return {
    '@context': 'http://opds-spec.org/auth/v1.0/context.jsonld',
    id: authDocUrl,
    title: 'Homebranch',
    description: 'Sign in to access your Homebranch catalog',
    authentication: [
      {
        type: 'http://opds-spec.org/auth/basic',
        labels: {
          login: 'Email',
          password: 'Password',
        },
      },
    ],
    links: [{ rel: 'logo', href: 'https://homebranch.app/logo.png', type: 'image/png' }],
  };
}

/**
 * Intercepts 401 responses on OPDS routes and returns an OPDS Authentication 1.0
 * document so that compliant clients (e.g. Thorium) display a login prompt.
 * Thorium discovers the auth document via the `WWW-Authenticate: OPDS location=` header.
 */
@Catch(UnauthorizedException)
export class OpdsAuthExceptionFilter implements ExceptionFilter {
  catch(_exception: UnauthorizedException, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const proto = String(request.headers['x-forwarded-proto'] ?? request.protocol);
    const host_ = String(request.headers['x-forwarded-host'] ?? request.headers.host ?? 'localhost');
    const baseUrl = `${proto}://${host_}`;
    const authDocUrl = `${baseUrl}/opds/v1/auth`;

    response
      .status(401)
      .setHeader('WWW-Authenticate', `OPDS location="${authDocUrl}"`)
      .setHeader('Content-Type', 'application/opds-authentication+json')
      .setHeader(
        'Link',
        `<${authDocUrl}>; rel="http://opds-spec.org/auth/document"; type="application/opds-authentication+json"`,
      )
      .send(JSON.stringify(buildOpdsAuthDocument(authDocUrl)));
  }
}
