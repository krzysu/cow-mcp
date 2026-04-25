import { type Address, parseAbi } from 'viem';
import { getPublicClient } from './rpc.js';

export type TokenMeta = { symbol: string; decimals: number };

const ERC20_ABI = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
]);

// Cache positive AND negative results for the lifetime of the process.
// Negative results (`null`) prevent re-querying the chain for known-broken
// tokens (proxies returning bytes32 instead of string, etc.).
const cache = new Map<string, TokenMeta | null>();
const cacheKey = (chainId: number, addr: string) => `${chainId}:${addr.toLowerCase()}`;

/**
 * Resolve `{symbol, decimals}` for a batch of addresses by reading ERC-20
 * `symbol()` + `decimals()` via Multicall3. Addresses that revert (non-ERC20,
 * proxy quirks, …) are simply absent from the returned map.
 */
export async function onChainTokenMeta(
  chainId: number,
  addresses: string[]
): Promise<Map<string, TokenMeta>> {
  const out = new Map<string, TokenMeta>();
  if (addresses.length === 0) return out;

  const todo: string[] = [];
  for (const addr of addresses) {
    const key = cacheKey(chainId, addr);
    if (cache.has(key)) {
      const hit = cache.get(key);
      if (hit) out.set(addr.toLowerCase(), hit);
    } else {
      todo.push(addr);
    }
  }
  if (todo.length === 0) return out;

  const client = getPublicClient(chainId);
  const contracts = todo.flatMap((address) => [
    { address: address as Address, abi: ERC20_ABI, functionName: 'symbol' as const },
    { address: address as Address, abi: ERC20_ABI, functionName: 'decimals' as const },
  ]);

  const results = await client.multicall({ contracts, allowFailure: true });

  for (let i = 0; i < todo.length; i++) {
    const addr = todo[i]!;
    const symbolRes = results[i * 2];
    const decimalsRes = results[i * 2 + 1];
    const key = cacheKey(chainId, addr);

    if (
      symbolRes?.status === 'success' &&
      decimalsRes?.status === 'success' &&
      typeof symbolRes.result === 'string' &&
      symbolRes.result.length > 0 &&
      typeof decimalsRes.result === 'number'
    ) {
      const meta = { symbol: symbolRes.result, decimals: decimalsRes.result };
      cache.set(key, meta);
      out.set(addr.toLowerCase(), meta);
    } else {
      cache.set(key, null);
    }
  }

  return out;
}

/** Reset (test-only). */
export function __resetTokenRpcCache(): void {
  cache.clear();
}
