export type KeyStatus = 'active' | 'rate-limited' | 'quota-exceeded' | 'error';

export interface StoredKey {
  key: string;
  label: string;
}

interface PoolEntry extends StoredKey {
  status: KeyStatus;
  failedAt?: number;
  cooldownMs: number;
  errorCount: number;
  lastError?: string;
  successCount: number;
}

export interface KeyPoolStatus {
  label: string;
  keyPreview: string;
  status: KeyStatus;
  resetAt?: number;
  lastError?: string;
  successCount: number;
}

function classifyError(msg: string): { status: KeyStatus; cooldownMs: number } {
  const m = msg.toLowerCase();
  if (m.includes('429') || m.includes('rate limit') || m.includes('user_rate_limit') || m.includes('too many requests')) {
    return { status: 'rate-limited', cooldownMs: 60_000 };
  }
  if (m.includes('quota') || m.includes('resource_exhausted') || m.includes('daily limit') || m.includes('exceeded') || m.includes('billing')) {
    return { status: 'quota-exceeded', cooldownMs: 3_600_000 };
  }
  return { status: 'error', cooldownMs: 30_000 };
}

export class KeyPool {
  private entries: PoolEntry[];
  private cursor = 0;
  readonly providerName: string;

  constructor(providerName: string, keys: StoredKey[]) {
    this.providerName = providerName;
    this.entries = keys
      .filter((k) => k.key.trim().length > 0)
      .map((k) => ({
        ...k,
        key: k.key.trim(),
        status: 'active' as KeyStatus,
        cooldownMs: 0,
        errorCount: 0,
        successCount: 0,
      }));
  }

  get count(): number { return this.entries.length; }
  get hasKeys(): boolean { return this.entries.length > 0; }

  getActiveKey(): PoolEntry | null {
    const now = Date.now();
    for (let i = 0; i < this.entries.length; i++) {
      const idx = (this.cursor + i) % this.entries.length;
      const e = this.entries[idx];
      if (e.status !== 'active' && e.failedAt && now - e.failedAt >= e.cooldownMs) {
        e.status = 'active';
        e.failedAt = undefined;
        e.errorCount = 0;
      }
      if (e.status === 'active') return e;
    }
    return null;
  }

  markFailed(key: string, errorMsg: string): void {
    const idx = this.entries.findIndex((e) => e.key === key);
    if (idx === -1) return;
    const e = this.entries[idx];
    const { status, cooldownMs } = classifyError(errorMsg);
    e.errorCount++;
    e.failedAt = Date.now();
    e.lastError = errorMsg.slice(0, 200);
    e.status = status;
    e.cooldownMs = cooldownMs;
    this.cursor = (idx + 1) % this.entries.length;
    console.log(`[KeyPool:${this.providerName}] ${e.label} → ${status} (${cooldownMs / 1000}s cooldown). Rotating.`);
  }

  markSuccess(key: string): void {
    const e = this.entries.find((e) => e.key === key);
    if (!e) return;
    e.status = 'active';
    e.errorCount = 0;
    e.failedAt = undefined;
    e.lastError = undefined;
    e.successCount++;
  }

  getStatus(): KeyPoolStatus[] {
    return this.entries.map((e) => ({
      label: e.label,
      keyPreview: e.key.length > 8 ? `${e.key.slice(0, 4)}••••${e.key.slice(-4)}` : '••••••••',
      status: e.status,
      resetAt: e.failedAt ? e.failedAt + e.cooldownMs : undefined,
      lastError: e.lastError,
      successCount: e.successCount,
    }));
  }
}

// Global pools registry
const pools = new Map<string, KeyPool>();

export function getPool(name: string): KeyPool | undefined {
  return pools.get(name);
}

export function setPool(name: string, pool: KeyPool): void {
  pools.set(name, pool);
}

export function getAllPoolStatus(): Record<string, KeyPoolStatus[]> {
  const result: Record<string, KeyPoolStatus[]> = {};
  for (const [name, pool] of pools) {
    result[name] = pool.getStatus();
  }
  return result;
}
