import { ArgumentsHost, UnauthorizedException } from '@nestjs/common';
import { Request, Response } from 'express';
import { OpdsAuthExceptionFilter } from 'src/common/filters/opds-auth-exception.filter';

describe('OpdsAuthExceptionFilter', () => {
  const authDocUrl = 'https://homebranch.example.com/api/opds/v1/auth';

  function callFilter(headers: Request['headers'] = {}) {
    const responseHeaders: Record<string, string> = {};
    const responseBody: string[] = [];
    const response = {
      status: jest.fn().mockReturnThis(),
      setHeader: jest.fn((name: string, value: string) => {
        responseHeaders[name] = value;
        return response;
      }),
      send: jest.fn((body: string) => {
        responseBody.push(body);
        return response;
      }),
    } as unknown as Response;
    const request = {
      headers,
      protocol: 'http',
      get: (name: string) => (name.toLowerCase() === 'host' ? 'internal:3000' : undefined),
    } as Request;
    const host = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;

    new OpdsAuthExceptionFilter().catch(new UnauthorizedException(), host);

    return { responseHeaders, responseBody };
  }

  test('includes the forwarded prefix in the challenge and auth document', () => {
    const { responseHeaders, responseBody } = callFilter({
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'homebranch.example.com',
      'x-forwarded-prefix': '/api',
    });

    expect(responseHeaders['WWW-Authenticate']).toBe(`OPDS location="${authDocUrl}"`);
    expect(responseHeaders.Link).toContain(`<${authDocUrl}>;`);
    expect((JSON.parse(responseBody[0]) as { id: string }).id).toBe(authDocUrl);
  });

  test('preserves the auth URL when no forwarded prefix is present', () => {
    const { responseHeaders, responseBody } = callFilter({
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'homebranch.example.com',
    });
    const expectedUrl = 'https://homebranch.example.com/opds/v1/auth';

    expect(responseHeaders['WWW-Authenticate']).toBe(`OPDS location="${expectedUrl}"`);
    expect(responseHeaders.Link).toContain(`<${expectedUrl}>;`);
    expect((JSON.parse(responseBody[0]) as { id: string }).id).toBe(expectedUrl);
  });
});
