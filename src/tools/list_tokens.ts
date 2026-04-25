import { z } from 'zod';
import { CHAINS, DEFAULT_CHAIN_ID, assertSupportedChain } from '../cow/chains.js';
import { loadChainTokens, tokensByAddress } from '../cow/token_lists.js';
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

export type TokenMeta = { symbol: string; decimals: number };

/**
 * Resolve `{symbol, decimals}` for a batch of addresses on a given chain
 * against the per-chain token list. Returns a Map keyed by lowercased
 * address. Addresses missing from the list are absent from the map — the
 * caller treats that as "no enrichment" and surfaces the raw address.
 */
export async function lookupTokenMeta(
  chainId: number,
  addresses: string[]
): Promise<Map<string, TokenMeta>> {
  if (addresses.length === 0) return new Map();
  const byAddress = await tokensByAddress(chainId).catch(() => new Map());
  const native = CHAINS[chainId]?.nativeSymbol;
  const out = new Map<string, TokenMeta>();

  for (const addr of addresses) {
    const lower = addr.toLowerCase();
    if (lower === NATIVE_SENTINEL && native) {
      // All EVM-native assets we support use 18 decimals (ETH, BNB, xDAI, POL, AVAX, …).
      out.set(lower, { symbol: native, decimals: 18 });
      continue;
    }
    const t = byAddress.get(lower);
    if (t) out.set(lower, { symbol: t.symbol, decimals: t.decimals });
  }

  return out;
}

export async function listTokens(args: {
  chainId: number;
  search?: string;
}): Promise<TokenOutput[]> {
  try {
    assertSupportedChain(args.chainId);
    const all = await withRetry(() => loadChainTokens(args.chainId));
    const q = args.search?.toLowerCase().trim();
    const filtered = q
      ? all.filter(
          (t) =>
            t.symbol?.toLowerCase().includes(q) ||
            t.name?.toLowerCase().includes(q) ||
            t.address?.toLowerCase() === q
        )
      : all;
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
 * `"WETH"` looked up against the chain's token list. Throws on unknown or
 * ambiguous symbols with the candidate addresses in the message.
 */
export async function resolveToken(chainId: number, query: string): Promise<string> {
  if (isAddress(query)) return query;

  assertSupportedChain(chainId);
  const all = await withRetry(() => loadChainTokens(chainId));
  const q = query.toLowerCase().trim();
  const matches = all.filter((t) => t.symbol?.toLowerCase() === q);

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

/** Reset (test-only). Re-exported from token_lists for backwards-compatible test imports. */
export { __resetTokenLists as __resetTokenCache } from '../cow/token_lists.js';
