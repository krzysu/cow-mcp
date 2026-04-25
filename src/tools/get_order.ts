import { z } from 'zod';
import { DEFAULT_CHAIN_ID } from '../cow/chains.js';
import { ctx, getCow } from '../cow/client.js';
import { toMcpError, withRetry } from '../errors.js';
import { OrderUidSchema, checksumAddress } from '../validators.js';
import { lookupTokenMeta } from './list_tokens.js';

export const GetOrderInput = {
  chainId: z.number().int().default(DEFAULT_CHAIN_ID),
  uid: OrderUidSchema.describe('Order UID: 0x-prefixed 56-byte hex (114 chars)'),
};

type OrderStatus = 'open' | 'fulfilled' | 'cancelled' | 'expired' | 'unknown';

const STATUS_MAP: Record<string, OrderStatus> = {
  open: 'open',
  presignaturePending: 'open',
  fulfilled: 'fulfilled',
  cancelled: 'cancelled',
  expired: 'expired',
};

export type GetOrderOutput = {
  uid: string;
  owner: string;
  status: OrderStatus;
  sellToken: string;
  buyToken: string;
  sellTokenSymbol?: string;
  sellTokenDecimals?: number;
  buyTokenSymbol?: string;
  buyTokenDecimals?: number;
  sellAmount: string;
  buyAmount: string;
  executedSellAmount: string;
  executedBuyAmount: string;
  validTo: number;
  creationDate: string;
  txHash?: string;
  solver?: string;
};

export async function getOrder(args: { chainId: number; uid: string }): Promise<GetOrderOutput> {
  const cow = getCow();
  try {
    const order = await withRetry(() => cow.getOrder(args.uid, ctx(args.chainId)));
    const trades =
      order.status === 'fulfilled'
        ? await withRetry(() => cow.getTrades({ orderUid: args.uid }, ctx(args.chainId))).catch(
            () => []
          )
        : [];
    const settledTx = trades.find((t) => t.txHash)?.txHash ?? undefined;

    // Token list lookup is cached and best-effort — if it fails, return raw addresses.
    const meta = await lookupTokenMeta(args.chainId, [order.sellToken, order.buyToken]).catch(
      () => new Map()
    );
    const sell = meta.get(order.sellToken.toLowerCase());
    const buy = meta.get(order.buyToken.toLowerCase());

    return {
      uid: order.uid,
      owner: checksumAddress(order.owner),
      status: STATUS_MAP[order.status] ?? 'unknown',
      sellToken: checksumAddress(order.sellToken),
      buyToken: checksumAddress(order.buyToken),
      ...(sell ? { sellTokenSymbol: sell.symbol, sellTokenDecimals: sell.decimals } : {}),
      ...(buy ? { buyTokenSymbol: buy.symbol, buyTokenDecimals: buy.decimals } : {}),
      sellAmount: order.sellAmount,
      buyAmount: order.buyAmount,
      executedSellAmount: order.executedSellAmount,
      executedBuyAmount: order.executedBuyAmount,
      validTo: order.validTo,
      creationDate: order.creationDate,
      ...(settledTx ? { txHash: settledTx } : {}),
    };
  } catch (err) {
    throw toMcpError(err, 'cow_get_order');
  }
}
