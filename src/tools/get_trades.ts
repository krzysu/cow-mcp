import { z } from 'zod';
import { blockTimestamps } from '../cow/block_time.js';
import { DEFAULT_CHAIN_ID } from '../cow/chains.js';
import { ctx, getCow } from '../cow/client.js';
import { toMcpError, withRetry } from '../errors.js';
import { AddressSchema, checksumAddress } from '../validators.js';
import { lookupTokenMeta } from './list_tokens.js';

export const GetTradesInput = {
  chainId: z.number().int().default(DEFAULT_CHAIN_ID),
  owner: AddressSchema.describe('Trader address (0x)'),
  limit: z.number().int().positive().max(100).optional().describe('Default 25, max 100'),
};

export type TradeOutput = {
  orderUid: string;
  blockNumber: number;
  blockTimestamp?: string;
  logIndex: number;
  sellToken: string;
  buyToken: string;
  sellTokenSymbol?: string;
  sellTokenDecimals?: number;
  buyTokenSymbol?: string;
  buyTokenDecimals?: number;
  sellAmount: string;
  buyAmount: string;
  txHash: string;
};

export async function getTrades(args: {
  chainId: number;
  owner: string;
  limit?: number;
}): Promise<TradeOutput[]> {
  const cow = getCow();
  const limit = Math.min(args.limit ?? 25, 100);
  try {
    // The orderbook returns full trade history for an owner; we slice client-side.
    // Acceptable for v0.1 — revisit with server-side pagination if whale wallets become a problem.
    const trades = await withRetry(() => cow.getTrades({ owner: args.owner }, ctx(args.chainId)));
    const sliced = trades.slice(0, limit);

    const addrs = new Set<string>();
    const blocks = new Set<number>();
    for (const t of sliced) {
      addrs.add(t.sellToken.toLowerCase());
      addrs.add(t.buyToken.toLowerCase());
      blocks.add(t.blockNumber);
    }
    // Token + timestamp lookups are cached and best-effort — if either RPC
    // path fails we still return the raw orderbook fields.
    const [meta, times] = await Promise.all([
      lookupTokenMeta(args.chainId, [...addrs]).catch(() => new Map()),
      blockTimestamps(args.chainId, [...blocks]).catch(() => new Map()),
    ]);

    return sliced.map((t) => {
      const sell = meta.get(t.sellToken.toLowerCase());
      const buy = meta.get(t.buyToken.toLowerCase());
      const ts = times.get(t.blockNumber);
      return {
        orderUid: t.orderUid,
        blockNumber: t.blockNumber,
        ...(ts ? { blockTimestamp: ts } : {}),
        logIndex: t.logIndex,
        sellToken: checksumAddress(t.sellToken),
        buyToken: checksumAddress(t.buyToken),
        ...(sell ? { sellTokenSymbol: sell.symbol, sellTokenDecimals: sell.decimals } : {}),
        ...(buy ? { buyTokenSymbol: buy.symbol, buyTokenDecimals: buy.decimals } : {}),
        sellAmount: t.sellAmount,
        buyAmount: t.buyAmount,
        txHash: t.txHash ?? '',
      };
    });
  } catch (err) {
    throw toMcpError(err, 'cow_get_trades');
  }
}
