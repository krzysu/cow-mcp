import {
  OrderQuoteSideKindBuy,
  OrderQuoteSideKindSell,
  type OrderQuoteRequest,
} from '@cowprotocol/cow-sdk';
import { z } from 'zod';
import { DEFAULT_CHAIN_ID } from '../cow/chains.js';
import { ctx, getCow } from '../cow/client.js';
import { toMcpError, withRetry } from '../errors.js';
import { resolveToken } from './list_tokens.js';

export const GetQuoteInput = {
  chainId: z.number().int().default(DEFAULT_CHAIN_ID),
  sellToken: z
    .string()
    .describe('Sell token: 0x address or symbol like "WETH" (resolved per chain)'),
  buyToken: z.string().describe('Buy token: 0x address or symbol like "USDC" (resolved per chain)'),
  kind: z.enum(['sell', 'buy']),
  amount: z.string().describe('Amount in base units (decimal string)'),
  from: z.string().optional().describe('Trader address; improves quote accuracy'),
  receiver: z.string().optional(),
  validFor: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Quote validity in seconds; default 1800'),
};

export type GetQuoteOutput = {
  sellAmount: string;
  buyAmount: string;
  feeAmount: string;
  validTo: number;
  quoteId?: number;
  expiration: string;
  verified: boolean;
};

// Anonymous-quote sentinel: orderbook accepts the zero address as `from` when the
// caller hasn't supplied a trader, returning a generic (less accurate) quote.
const ZERO = '0x0000000000000000000000000000000000000000';

export async function getQuote(args: {
  chainId: number;
  sellToken: string;
  buyToken: string;
  kind: 'sell' | 'buy';
  amount: string;
  from?: string;
  receiver?: string;
  validFor?: number;
}): Promise<GetQuoteOutput> {
  const cow = getCow();
  const validFor = args.validFor ?? 1800;
  const from = args.from ?? ZERO;

  const side =
    args.kind === 'sell'
      ? { kind: OrderQuoteSideKindSell.SELL, sellAmountBeforeFee: args.amount }
      : { kind: OrderQuoteSideKindBuy.BUY, buyAmountAfterFee: args.amount };

  try {
    const [sellToken, buyToken] = await Promise.all([
      resolveToken(args.chainId, args.sellToken),
      resolveToken(args.chainId, args.buyToken),
    ]);

    const req = {
      sellToken,
      buyToken,
      from,
      ...(args.receiver ? { receiver: args.receiver } : {}),
      validFor,
      ...side,
    } as OrderQuoteRequest;

    const res = await withRetry(() => cow.getQuote(req, ctx(args.chainId)));
    return {
      sellAmount: res.quote.sellAmount,
      buyAmount: res.quote.buyAmount,
      feeAmount: res.quote.feeAmount,
      validTo: res.quote.validTo,
      ...(res.id !== undefined ? { quoteId: res.id } : {}),
      expiration: res.expiration,
      verified: res.verified,
    };
  } catch (err) {
    throw toMcpError(err, 'cow_get_quote');
  }
}
