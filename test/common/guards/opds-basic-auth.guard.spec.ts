/* eslint-disable */
import { ForbiddenException } from '@nestjs/common';
import { OpdsBasicAuthGuard } from 'src/common/guards/opds-basic-auth.guard';

function build(opts: { cloud: boolean; roles?: string[]; state?: string }) {
  const authGateway = { login: jest.fn().mockResolvedValue('tok') };
  const tokenGateway = {
    verifyAccessToken: jest.fn().mockResolvedValue({ userId: 'u1', email: 'a@b.c', roles: opts.roles ?? ['USER'] }),
  };
  const entitlements = { cloudMode: opts.cloud, getState: jest.fn().mockResolvedValue(opts.state ?? 'active') };
  const guard = new OpdsBasicAuthGuard(authGateway as any, tokenGateway as any, entitlements as any);
  const request: any = { headers: { authorization: 'Basic ' + Buffer.from('a@b.c:pw').toString('base64') } };
  const ctx: any = { switchToHttp: () => ({ getRequest: () => request }) };
  return { guard, ctx, entitlements };
}

describe('OpdsBasicAuthGuard entitlement', () => {
  it('allows when not in cloud mode', async () => {
    const { guard, ctx, entitlements } = build({ cloud: false, state: 'blocked' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(entitlements.getState).not.toHaveBeenCalled();
  });

  it('rejects blocked accounts with 403', async () => {
    const { guard, ctx } = build({ cloud: true, state: 'blocked' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows read_only accounts to read', async () => {
    const { guard, ctx } = build({ cloud: true, state: 'read_only' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('exempts admins', async () => {
    const { guard, ctx } = build({ cloud: true, roles: ['ADMIN'], state: 'blocked' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
