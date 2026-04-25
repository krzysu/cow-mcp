// Per-chain token lists hosted by CoW. The single multi-chain CowSwap.json
// covers ~170 tokens on mainnet but only a handful on Base/Arbitrum/Polygon —
// so symbol → address resolution for "WETH" on chainId 8453 used to fail.
// These per-chain endpoints are what the CoW Swap UI itself consumes and
// inherit from CoinGecko + Uniswap, giving us hundreds of tokens per L2.

export type RawToken = {
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
};

type ChainCache = {
  tokens: RawToken[];
  byAddress: Map<string, RawToken>;
  fetchedAt: number;
};

type TokenListJson = { tokens?: RawToken[] };

// Priority order: CoinGecko first (broadest, ~500/chain on majors), Uniswap
// second (curated, fills gaps). When both have an address, CoinGecko wins.
const SOURCES: Array<(chainId: number) => string> = [
  (chainId) => `https://files.cow.fi/token-lists/CoinGecko.${chainId}.json`,
  (chainId) => `https://files.cow.fi/token-lists/Uniswap.${chainId}.json`,
];

const TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 4_000;

const cache = new Map<number, ChainCache>();
const inflight = new Map<number, Promise<ChainCache>>();

async function fetchOne(url: string): Promise<RawToken[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const json = (await res.json()) as TokenListJson;
    return Array.isArray(json?.tokens) ? json.tokens : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function load(chainId: number): Promise<ChainCache> {
  const lists = await Promise.all(SOURCES.map((s) => fetchOne(s(chainId))));
  const byAddress = new Map<string, RawToken>();
  const tokens: RawToken[] = [];
  for (const list of lists) {
    for (const t of list) {
      if (!t.address || t.chainId !== chainId) continue;
      const key = t.address.toLowerCase();
      if (byAddress.has(key)) continue;
      byAddress.set(key, t);
      tokens.push(t);
    }
  }
  return { tokens, byAddress, fetchedAt: Date.now() };
}

/** Per-chain token list, fetched once per chain with a 10-min TTL. */
export async function loadChainTokens(chainId: number): Promise<RawToken[]> {
  const hit = cache.get(chainId);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit.tokens;

  const existing = inflight.get(chainId);
  if (existing) return (await existing).tokens;

  const p = load(chainId);
  inflight.set(chainId, p);
  try {
    const entry = await p;
    cache.set(chainId, entry);
    return entry.tokens;
  } finally {
    inflight.delete(chainId);
  }
}

/** Lowercased-address index for a chain. Populates the cache as a side effect. */
export async function tokensByAddress(chainId: number): Promise<Map<string, RawToken>> {
  await loadChainTokens(chainId);
  return cache.get(chainId)?.byAddress ?? new Map();
}

/** Reset (test-only). */
export function __resetTokenLists(): void {
  cache.clear();
  inflight.clear();
}
