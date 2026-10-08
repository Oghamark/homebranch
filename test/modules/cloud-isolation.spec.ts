import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { CloudAdminOnlyGuard } from 'src/common/guards/cloud-admin-only.guard';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { OpdsV1Controller } from 'src/modules/opds/opds-v1.controller';
import { tenantScope } from 'src/common/utils/cloud';
import { EntitlementService } from 'src/modules/cloud/entitlement.service';

const contextFor = (request: object): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

describe('cloud isolation', () => {
  const original = process.env.CLOUD_MODE;
  afterEach(() => {
    if (original === undefined) delete process.env.CLOUD_MODE;
    else process.env.CLOUD_MODE = original;
  });

  describe('tenantScope', () => {
    it('restricts tenants to their own id in cloud mode', () => {
      process.env.CLOUD_MODE = 'true';
      expect(tenantScope({ id: 'u1', roles: ['USER'] })).toBe('u1');
    });

    it('does not scope admins', () => {
      process.env.CLOUD_MODE = 'true';
      expect(tenantScope({ id: 'a1', roles: ['ADMIN'] })).toBeUndefined();
    });

    it('does not scope when self-hosted', () => {
      delete process.env.CLOUD_MODE;
      expect(tenantScope({ id: 'u1', roles: ['USER'] })).toBeUndefined();
    });
  });

  describe('CloudAdminOnlyGuard', () => {
    const guard = new CloudAdminOnlyGuard();

    it('blocks tenants in cloud mode', () => {
      process.env.CLOUD_MODE = 'true';
      expect(() => guard.canActivate(contextFor({ user: { id: 'u1', roles: ['USER'] } }))).toThrow(ForbiddenException);
    });

    it('allows admins in cloud mode', () => {
      process.env.CLOUD_MODE = 'true';
      expect(guard.canActivate(contextFor({ user: { id: 'a1', roles: ['ADMIN'] } }))).toBe(true);
    });

    it('allows everyone when self-hosted', () => {
      delete process.env.CLOUD_MODE;
      expect(guard.canActivate(contextFor({ user: { id: 'u1', roles: ['USER'] } }))).toBe(true);
    });
  });

  describe('JwtAuthGuard entitlement', () => {
    const buildGuard = (state: 'active' | 'read_only' | 'blocked') => {
      const entitlements = { cloudMode: true, getState: jest.fn().mockResolvedValue(state) };
      const guard = new JwtAuthGuard(entitlements as unknown as EntitlementService);
      jest
        .spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype) as { canActivate: () => Promise<boolean> }, 'canActivate')
        .mockResolvedValue(true);
      return guard;
    };
    afterEach(() => jest.restoreAllMocks());

    const request = (method: string) => contextFor({ method, user: { id: 'u1', roles: ['USER'] } });

    it('rejects blocked tenants', async () => {
      await expect(buildGuard('blocked').canActivate(request('GET'))).rejects.toThrow(ForbiddenException);
    });

    it('allows reads but rejects writes when read-only', async () => {
      const guard = buildGuard('read_only');
      await expect(guard.canActivate(request('GET'))).resolves.toBe(true);
      await expect(guard.canActivate(request('POST'))).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(request('DELETE'))).rejects.toThrow(ForbiddenException);
    });

    it('allows everything for active tenants', async () => {
      await expect(buildGuard('active').canActivate(request('POST'))).resolves.toBe(true);
    });
  });
  describe('OPDS', () => {
    const request = (user: object) => ({ user, headers: {}, protocol: 'https', get: () => 'h' }) as never;
    const page = { data: [], total: 0, limit: 20, offset: 0, nextCursor: null };
    const build = () => {
      const books = { getBooks: jest.fn().mockResolvedValue(page), getNewArrivals: jest.fn().mockResolvedValue(page) };
      const shelves = {
        getBookShelves: jest.fn().mockResolvedValue(page),
        getBookShelfById: jest.fn().mockResolvedValue({ id: 's', title: 't' }),
        getBookShelfBooks: jest.fn().mockResolvedValue(page),
      };
      const builder = new Proxy({}, { get: () => () => '' });
      const controller = new OpdsV1Controller(books as never, shelves as never, builder as never, {} as never);
      return { controller, books, shelves };
    };

    it('scopes every OPDS listing to the tenant in cloud mode', async () => {
      process.env.CLOUD_MODE = 'true';
      const { controller, books, shelves } = build();
      const req = request({ id: 'u1', roles: ['USER'] });
      await controller.getAllBooks(req);
      await controller.getNewArrivals(req);
      await controller.search(req, 'x');
      await controller.getBookshelves(req);
      await controller.getBookshelfBooks(req, 's');
      expect(books.getBooks).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }));
      expect(books.getNewArrivals).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'u1');
      expect(shelves.getBookShelves).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'u1');
      expect(shelves.getBookShelfById).toHaveBeenCalledWith('s', 'u1');
      expect(shelves.getBookShelfBooks).toHaveBeenCalledWith('s', 'u1');
    });

    it('does not scope admins', async () => {
      process.env.CLOUD_MODE = 'true';
      const { controller, books } = build();
      await controller.getAllBooks(request({ id: 'a1', roles: ['ADMIN'] }));
      expect(books.getBooks).toHaveBeenCalledWith(expect.objectContaining({ userId: undefined }));
    });
  });
});
