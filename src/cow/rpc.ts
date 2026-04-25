import { type Chain, createPublicClient, http, type PublicClient } from 'viem';
import * as chains from 'viem/chains';
import { assertSupportedChain } from './chains.js';

const CHAIN_BY_ID: Record<number, Chain> = (() => {
  const out: Record<number, Chain> = {};
  for (const c of Object.values(chains) as Chain[]) {
    if (c && typeof c === 'object' && typeof c.id === 'number') out[c.id] = c;
  }
  return out;
})();

const clients = new Map<number, PublicClient>();

function rpcUrlFor(chainId: number, fallback: string): string {
  return process.env[`COW_RPC_URL_${chainId}`] ?? fallback;
}

/**
 * Per-chain viem PublicClient, lazily constructed and cached. Falls back to
 * the chain's public RPC from `viem/chains`; override via `COW_RPC_URL_<id>`.
 */
export function getPublicClient(chainId: number): PublicClient {
  assertSupportedChain(chainId);
  const cached = clients.get(chainId);
  if (cached) return cached;
  const chain = CHAIN_BY_ID[chainId];
  if (!chain) throw new Error(`no viem chain definition for chainId ${chainId}`);
  const url = rpcUrlFor(chainId, chain.rpcUrls.default.http[0]!);
  const client = createPublicClient({ chain, transport: http(url) }) as PublicClient;
  clients.set(chainId, client);
  return client;
}

/** Reset (test-only). */
export function __resetRpc(): void {
  clients.clear();
}
