import { PayloadTooLargeException } from '@nestjs/common';
import { StorageQuotaService } from 'src/modules/cloud/storage-quota.service';

describe('StorageQuotaService', () => {
  const build = (used: number) => {
    const qb = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ total: String(used) }),
    };
    return new StorageQuotaService({ createQueryBuilder: () => qb } as never);
  };

  afterEach(() => delete process.env.STORAGE_QUOTA_BYTES);

  it('defaults to 5 GiB and honors the env override', () => {
    expect(build(0).quotaBytes).toBe(5 * 1024 ** 3);
    process.env.STORAGE_QUOTA_BYTES = '100';
    expect(build(0).quotaBytes).toBe(100);
  });

  it('allows uploads up to the quota and rejects beyond it', async () => {
    process.env.STORAGE_QUOTA_BYTES = '100';
    await expect(build(60).assertCanStore('u', 40)).resolves.toBeUndefined();
    await expect(build(60).assertCanStore('u', 41)).rejects.toThrow(PayloadTooLargeException);
  });

  it('reports usage', async () => {
    process.env.STORAGE_QUOTA_BYTES = '100';
    await expect(build(25).getUsage('u')).resolves.toEqual({ usedBytes: 25, quotaBytes: 100 });
  });
});
