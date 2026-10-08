import { Injectable, Logger } from '@nestjs/common';

export type EntitlementState = 'active' | 'read_only' | 'blocked';

interface CacheEntry {
  state: EntitlementState;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;

@Injectable()
export class EntitlementService {
  private readonly logger = new Logger(EntitlementService.name);
  private readonly cache = new Map<string, CacheEntry>();

  get cloudMode(): boolean {
    return process.env.CLOUD_MODE === 'true';
  }

  async getState(userId: string): Promise<EntitlementState> {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.state;

    const state = await this.fetchState(userId);
    this.cache.set(userId, { state, expiresAt: Date.now() + CACHE_TTL_MS });
    return state;
  }

  // Fails closed: any problem reaching the portal blocks access.
  private async fetchState(userId: string): Promise<EntitlementState> {
    const portalUrl = process.env.PORTAL_URL;
    const serviceKey = process.env.PORTAL_SERVICE_KEY;
    if (!portalUrl || !serviceKey) {
      this.logger.error('CLOUD_MODE requires PORTAL_URL and PORTAL_SERVICE_KEY');
      return 'blocked';
    }

    try {
      const response = await fetch(`${portalUrl}/internal/entitlements/${encodeURIComponent(userId)}`, {
        headers: { Authorization: `Bearer ${serviceKey}` },
      });
      if (!response.ok) return 'blocked';
      const body = (await response.json()) as { state?: EntitlementState };
      return body.state === 'active' || body.state === 'read_only' ? body.state : 'blocked';
    } catch (err) {
      this.logger.error('Failed to reach portal for entitlement check', err);
      return 'blocked';
    }
  }
}
