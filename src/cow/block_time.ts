import { getPublicClient } from './rpc.js';

const cache = new Map<string, string>();
const cacheKey = (chainId: number, blockNumber: number) => `${chainId}:${blockNumber}`;

/**
 * Resolve ISO timestamps for a batch of block numbers on a given chain.
 * Best-effort — failed lookups are simply absent from the returned map.
 *
 * Issued as parallel `eth_getBlockByNumber` calls (no multicall available
 * for block headers). Caches per-chain results in-process.
 */
export async function blockTimestamps(
  chainId: number,
  blockNumbers: number[]
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (blockNumbers.length === 0) return out;

  const unique = [...new Set(blockNumbers)];
  const todo: number[] = [];
  for (const bn of unique) {
    const key = cacheKey(chainId, bn);
    const hit = cache.get(key);
    if (hit) out.set(bn, hit);
    else todo.push(bn);
  }
  if (todo.length === 0) return out;

  const client = getPublicClient(chainId);
  const settled = await Promise.allSettled(
    todo.map((bn) => client.getBlock({ blockNumber: BigInt(bn) }))
  );

  for (let i = 0; i < todo.length; i++) {
    const bn = todo[i]!;
    const res = settled[i]!;
    if (res.status === 'fulfilled') {
      const iso = new Date(Number(res.value.timestamp) * 1000).toISOString();
      cache.set(cacheKey(chainId, bn), iso);
      out.set(bn, iso);
    }
  }

  return out;
}

/** Reset (test-only). */
export function __resetBlockTimeCache(): void {
  cache.clear();
}
