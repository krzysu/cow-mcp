import { SupportedChainId } from '@cowprotocol/cow-sdk';
import {
  type Chain,
  createPublicClient,
  fallback,
  http,
  type PublicClient,
  type Transport,
} from 'viem';
import * as chains from 'viem/chains';
import { assertSupportedChain } from './chains.js';

const CHAIN_BY_ID: Record<number, Chain> = (() => {
  const out: Record<number, Chain> = {};
  for (const c of Object.values(chains) as Chain[]) {
    if (c && typeof c === 'object' && typeof c.id === 'number') out[c.id] = c;
  }
  return out;
})();

// publicnode.com endpoints — the viem-default public RPCs (cloudflare-eth,
// llamarpc, the chain's own gateway) are too slow for trade enrichment, which
// fans out to N parallel allowance/decimals reads. Override per-chain via
// `COW_RPC_URL_<id>`.
const PUBLICNODE_RPC: Record<number, string> = {
  [SupportedChainId.MAINNET]: 'https://ethereum-rpc.publicnode.com',
  [SupportedChainId.BNB]: 'https://bsc-rpc.publicnode.com',
  [SupportedChainId.GNOSIS_CHAIN]: 'https://gnosis-rpc.publicnode.com',
  [SupportedChainId.POLYGON]: 'https://polygon-bor-rpc.publicnode.com',
  [SupportedChainId.BASE]: 'https://base-rpc.publicnode.com',
  [SupportedChainId.ARBITRUM_ONE]: 'https://arbitrum-one-rpc.publicnode.com',
  [SupportedChainId.AVALANCHE]: 'https://avalanche-c-chain-rpc.publicnode.com',
  [SupportedChainId.LINEA]: 'https://linea-rpc.publicnode.com',
  [SupportedChainId.SEPOLIA]: 'https://ethereum-sepolia-rpc.publicnode.com',
};

const clients = new Map<number, PublicClient>();

const HTTP_OPTS = {
  // JSON-RPC batching: pack up to 32 calls issued within 16ms into one HTTP
  // request. Cuts trade-enrichment from N round-trips to ~1 on public RPCs
  // that support it (most do; viem's transport handles failures per-call).
  batch: { batchSize: 32, wait: 16 },
} as const;

function rpcUrlsFor(chainId: number, viemDefault: string): string[] {
  const override = process.env[`COW_RPC_URL_${chainId}`];
  if (override) return [override];
  const publicnode = PUBLICNODE_RPC[chainId];
  // Primary: publicnode (fast). Fallback: viem's chain default — same URL
  // dedup'd if we have no publicnode mapping for the chain.
  return publicnode && publicnode !== viemDefault ? [publicnode, viemDefault] : [viemDefault];
}

/**
 * Per-chain viem PublicClient, lazily constructed and cached. Primary RPC is
 * publicnode.com (viem's built-in defaults are too slow for trade
 * enrichment); falls back to the viem chain's public RPC if publicnode 5xxs
 * or times out. Override via `COW_RPC_URL_<id>` (single endpoint, no
 * fallback).
 */
export function getPublicClient(chainId: number): PublicClient {
  assertSupportedChain(chainId);
  const cached = clients.get(chainId);
  if (cached) return cached;
  const chain = CHAIN_BY_ID[chainId];
  if (!chain) throw new Error(`no viem chain definition for chainId ${chainId}`);
  const urls = rpcUrlsFor(chainId, chain.rpcUrls.default.http[0]!);
  const transport: Transport =
    urls.length > 1 ? fallback(urls.map((u) => http(u, HTTP_OPTS))) : http(urls[0], HTTP_OPTS);
  const client = createPublicClient({ chain, transport }) as PublicClient;
  clients.set(chainId, client);
  return client;
}

/** Reset (test-only). */
export function __resetRpc(): void {
  clients.clear();
}
