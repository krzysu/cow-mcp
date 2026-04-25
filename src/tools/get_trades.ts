import { z } from 'zod';
import { DEFAULT_CHAIN_ID } from '../cow/chains.js';
import { ctx, getCow } from '../cow/client.js';
import { toMcpError, withRetry } from '../errors.js';
import { AddressSchema, checksumAddress } from '../validators.js';
import { lookupTokenMeta } from './list_tokens.js';

export const GetTradesInput = {
  chainId: z.number().int().default(DEFAULT_CHAIN_ID),
  owner: AddressSchema.describe('Trader address (0x)'),
  limit: z.number().int().positive().max(100).optional().describe('Page size; default 25, max 100'),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Page offset; default 0. Use offset += limit to walk older trades.'),
};

export type TradeOutput = {
  orderUid: string;
  blockNumber: number;
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
  offset?: number;
}): Promise<TradeOutput[]> {
  const cow = getCow();
  const limit = Math.min(args.limit ?? 25, 100);
  const offset = args.offset ?? 0;
  try {
    const trades = await withRetry(() =>
      cow.getTrades({ owner: args.owner, limit, offset }, ctx(args.chainId))
    );
    // Defensive client-side slice: belt-and-braces against an SDK/orderbook
    // version that ignores `limit` server-side.
    const sliced = trades.slice(0, limit);

    const addrs = new Set<string>();
    for (const t of sliced) {
      addrs.add(t.sellToken.toLowerCase());
      addrs.add(t.buyToken.toLowerCase());
    }
    // Token list lookup is cached and best-effort. List-only — no on-chain
    // fallback — so it stays fast (~0ms after the first hit per chain).
    const meta = await lookupTokenMeta(args.chainId, [...addrs]).catch(() => new Map());

    return sliced.map((t) => {
      const sell = meta.get(t.sellToken.toLowerCase());
      const buy = meta.get(t.buyToken.toLowerCase());
      return {
        orderUid: t.orderUid,
        blockNumber: t.blockNumber,
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
