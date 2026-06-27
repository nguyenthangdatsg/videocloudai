import type { ProviderConfig, GenerationRequest, GenerationResult, RateLimitState } from '@videocloudai/shared';
import { getPool } from './key-pool';

export abstract class BaseProvider {
  protected config: ProviderConfig;
  private rateState: RateLimitState;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.rateState = {
      provider: config.name,
      requestCount: 0,
      windowStartMs: Date.now(),
      isLimited: false,
    };
  }

  abstract submit(request: GenerationRequest): Promise<string>;
  abstract poll(externalId: string): Promise<'processing' | 'completed' | 'failed'>;
  abstract download(externalId: string, destPath: string): Promise<GenerationResult>;

  get name(): string {
    return this.config.name;
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  protected async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const windowMs = 60_000;

    if (now - this.rateState.windowStartMs > windowMs) {
      this.rateState.requestCount = 0;
      this.rateState.windowStartMs = now;
      this.rateState.isLimited = false;
    }

    if (this.rateState.requestCount >= this.config.requestsPerMinute) {
      this.rateState.isLimited = true;
      const waitMs = windowMs - (now - this.rateState.windowStartMs);
      if (waitMs > 0) {
        await new Promise((r) => setTimeout(r, waitMs));
        this.rateState.requestCount = 0;
        this.rateState.windowStartMs = Date.now();
        this.rateState.isLimited = false;
      }
    }

    this.rateState.requestCount++;
  }

  protected async withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
    let lastError: Error | undefined;
    for (let i = 0; i <= retries; i++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err as Error;
        if (i < retries) {
          const delay = Math.min(1000 * Math.pow(2, i), 30000);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    throw lastError;
  }

  protected async withKeyRotatingRetry<T>(fn: (key: string) => Promise<T>): Promise<T> {
    const pool = getPool(this.config.name);
    if (!pool?.hasKeys) {
      return fn(this.config.apiKey ?? '');
    }
    let lastError: Error | undefined;
    for (let i = 0; i < pool.count; i++) {
      const entry = pool.getActiveKey();
      if (!entry) break;
      try {
        const result = await fn(entry.key);
        pool.markSuccess(entry.key);
        return result;
      } catch (err) {
        lastError = err as Error;
        pool.markFailed(entry.key, lastError.message);
      }
    }
    throw lastError ?? new Error(`All keys for ${this.config.name} exhausted`);
  }

  getRateState(): RateLimitState {
    return { ...this.rateState };
  }
}
