import { BaseProvider } from './base.provider';
import { KeyPool, getPool, setPool, getAllPoolStatus } from './key-pool';
import type { StoredKey } from './key-pool';
import type { ProviderConfig, ProviderName } from '@videocloudai/shared';
import { getSettings } from '../services/settings.service';

const providers = new Map<ProviderName, BaseProvider>();

export function initProviders(): void {
  // No built-in providers — kept for future extensibility
}

export function getProvider(name: ProviderName): BaseProvider {
  const p = providers.get(name);
  if (!p) throw new Error(`Provider ${name} not initialized`);
  return p;
}

export function getAvailableProviders(): ProviderName[] {
  return Array.from(providers.entries())
    .filter(([, p]) => p.enabled)
    .map(([name]) => name);
}

export function getAllProviders(): Map<ProviderName, BaseProvider> {
  return providers;
}

export { BaseProvider, getAllPoolStatus, getPool };
