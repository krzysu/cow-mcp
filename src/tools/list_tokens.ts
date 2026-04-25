import { z } from 'zod';
import { CHAINS, DEFAULT_CHAIN_ID, assertSupportedChain } from '../cow/chains.js';
import { onChainTokenMeta } from '../cow/token_rpc.js';
import { toMcpError, withRetry } from '../errors.js';
import { checksumAddress, isAddress } from '../validators.js';

// CoW + the Ethereum ecosystem use this sentinel to mean the chain's native
// asset (ETH on mainnet, xDAI on Gnosis, etc.). The orderbook returns it as
// `buyToken` whenever the user buys native — but it isn't in any token list,
// so we resolve it by hand against our chains table.
const NATIVE_SENTINEL = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

export const ListTokensInput = {
  chainId: z.number().int().default(DEFAULT_CHAIN_ID),
  search: z.string().optional().describe('Filter by symbol/name/address (case-insensitive)'),
};

export type TokenOutput = {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
};

type RawToken = {
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
};

type TokenListJson = {
  tokens: RawToken[];
};

// CowSwap.json is CoW's own curated multi-chain list (~266 tokens across all
// supported chains, includes COW). CoinGecko.json from the same host is a
// 243-token mainnet-only snapshot — don't use it.
const TOKEN_LIST_URL = 'https://files.cow.fi/tokens/CowSwap.json';

type Cache = {
  tokens: RawToken[];
  byAddress: Map<number, Map<string, RawToken>>;
  fetchedAt: number;
};

let cached: Cache | undefined;
const TTL_MS = 10 * 60 * 1000;

function indexByAddress(tokens: RawToken[]): Map<number, Map<string, RawToken>> {
  const idx = new Map<number, Map<string, RawToken>>();
  for (const t of tokens) {
    if (!t.address) continue;
    let inner = idx.get(t.chainId);
    if (!inner) {
      inner = new Map();
      idx.set(t.chainId, inner);
    }
    inner.set(t.address.toLowerCase(), t);
  }
  return idx;
}

async function loadTokenList(): Promise<RawToken[]> {
  const now = Date.now();
  if (cached && now - cached.fetchedAt < TTL_MS) {
    return cached.tokens;
  }
  const res = await fetch(TOKEN_LIST_URL, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`token list fetch failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as TokenListJson;
  const tokens = Array.isArray(json?.tokens) ? json.tokens : [];
  cached = { tokens, byAddress: indexByAddress(tokens), fetchedAt: now };
  return tokens;
}

export type TokenMeta = { symbol: string; decimals: number };

/**
 * Resolve `{symbol, decimals}` for a batch of addresses on a given chain.
 * Returns a Map keyed by lowercased address.
 *
 * Tries the curated token list first, then falls back to an on-chain
 * `symbol()` + `decimals()` multicall for the remainder. Addresses that
 * resolve via neither path are absent from the returned map.
 */
export async function lookupTokenMeta(
  chainId: number,
  addresses: string[]
): Promise<Map<string, TokenMeta>> {
  if (addresses.length === 0) return new Map();
  await loadTokenList().catch(() => undefined);
  const onChain = cached?.byAddress.get(chainId);
  const native = CHAINS[chainId]?.nativeSymbol;
  const out = new Map<string, TokenMeta>();
  const unresolved: string[] = [];

  for (const addr of addresses) {
    const lower = addr.toLowerCase();
    if (lower === NATIVE_SENTINEL && native) {
      // All EVM-native assets we support use 18 decimals (ETH, BNB, xDAI, POL, AVAX, …).
      out.set(lower, { symbol: native, decimals: 18 });
      continue;
    }
    const t = onChain?.get(lower);
    if (t) {
      out.set(lower, { symbol: t.symbol, decimals: t.decimals });
      continue;
    }
    if (isAddress(addr)) unresolved.push(lower);
  }

  if (unresolved.length > 0) {
    const fromChain = await onChainTokenMeta(chainId, unresolved).catch(() => new Map());
    for (const [addr, meta] of fromChain) out.set(addr, meta);
  }

  return out;
}

export async function listTokens(args: {
  chainId: number;
  search?: string;
}): Promise<TokenOutput[]> {
  try {
    assertSupportedChain(args.chainId);
    const all = await withRetry(() => loadTokenList());
    const onChain = all.filter((t) => t.chainId === args.chainId);
    const q = args.search?.toLowerCase().trim();
    const filtered = q
      ? onChain.filter(
          (t) =>
            t.symbol?.toLowerCase().includes(q) ||
            t.name?.toLowerCase().includes(q) ||
            t.address?.toLowerCase() === q
        )
      : onChain;
    return filtered.map((t) => ({
      address: checksumAddress(t.address),
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
      ...(t.logoURI ? { logoURI: t.logoURI } : {}),
    }));
  } catch (err) {
    throw toMcpError(err, 'cow_list_tokens');
  }
}

/**
 * Resolve a user-supplied token reference to a 0x address.
 *
 * Accepts either a 40-char hex address (returned as-is) or a symbol like
 * `"WETH"` looked up against the chain's slice of the token list. Throws on
 * unknown or ambiguous symbols with the candidate addresses in the message.
 */
export async function resolveToken(chainId: number, query: string): Promise<string> {
  if (isAddress(query)) return query;

  assertSupportedChain(chainId);
  const all = await withRetry(() => loadTokenList());
  const onChain = all.filter((t) => t.chainId === chainId);
  const q = query.toLowerCase().trim();
  const matches = onChain.filter((t) => t.symbol?.toLowerCase() === q);

  if (matches.length === 0) {
    throw new Error(
      `token "${query}" not found on chain ${chainId}; pass a 0x address or call cow_list_tokens to look it up`
    );
  }
  if (matches.length > 1) {
    const candidates = matches.map((t) => `${t.symbol} (${t.address})`).join(', ');
    throw new Error(
      `token "${query}" is ambiguous on chain ${chainId}; pass an address. Candidates: ${candidates}`
    );
  }
  return matches[0]!.address;
}

/** Reset (test-only). */
export function __resetTokenCache(): void {
  cached = undefined;
}
