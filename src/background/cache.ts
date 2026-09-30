// Jev's labels, cached per hostname in chrome.storage.local. Labels are theme-independent
// tokens, so switching themes never needs Jev again. The content script reads the cache
// directly; only the background writes it, one host at a time, so writes never race.

import { cacheKey, type HostCache } from '../shared/settings.ts';
import type { Labels } from '../shared/tokens.ts';

/** Entries this old are dropped entirely (expired-but-younger entries are still shown while Jev refreshes them). */
const PRUNE_AFTER_MS = 14 * 24 * 3600_000;
const MAX_ENTRIES_PER_HOST = 5000;

const queues = new Map<string, Promise<unknown>>();

function serialize<T>(host: string, fn: () => Promise<T>): Promise<T> {
  const next = (queues.get(host) ?? Promise.resolve()).then(fn, fn);
  queues.set(host, next.catch(() => undefined));
  return next;
}

export async function readHost(host: string): Promise<HostCache> {
  return ((await chrome.storage.local.get(cacheKey(host)))[cacheKey(host)] as HostCache | undefined) ?? {};
}

export function writeLabels(host: string, labels: Record<string, Labels>, now = Date.now()): Promise<void> {
  return serialize(host, async () => {
    const cache = await readHost(host);
    for (const [sig, l] of Object.entries(labels)) cache[sig] = { l, t: now };
    let entries = Object.entries(cache).filter(([, e]) => now - e.t < PRUNE_AFTER_MS);
    if (entries.length > MAX_ENTRIES_PER_HOST) entries = entries.sort((a, b) => b[1].t - a[1].t).slice(0, MAX_ENTRIES_PER_HOST);
    await chrome.storage.local.set({ [cacheKey(host)]: Object.fromEntries(entries) });
  });
}

export function clearHost(host: string): Promise<void> {
  return serialize(host, () => chrome.storage.local.remove(cacheKey(host)));
}
