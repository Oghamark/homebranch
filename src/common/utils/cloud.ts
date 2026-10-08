export interface TenantUser {
  id: string;
  roles?: string[];
}

export const isCloudMode = (): boolean => process.env.CLOUD_MODE === 'true';

export const isAdminUser = (user: TenantUser): boolean => user.roles?.includes('ADMIN') ?? false;

/** Owner id every query must be restricted to; undefined when not in cloud mode or for admins. */
export const tenantScope = (user: TenantUser): string | undefined =>
  isCloudMode() && !isAdminUser(user) ? user.id : undefined;
