import { z } from 'zod';
import { buildAppData } from '../cow/appdata.js';
import { DEFAULT_CHAIN_ID } from '../cow/chains.js';
import {
  type EipOrderMessage,
  ORDER_PRIMARY_TYPE,
  ORDER_TYPE_FIELDS,
  cowDomain,
  hashOrderTypedData,
} from '../cow/eip712.js';
import { toMcpError } from '../errors.js';
import { AddressSchema, PositiveAmountSchema, checksumAddress } from '../validators.js';
import { resolveToken } from './list_tokens.js';

const DEFAULT_SLIPPAGE_BPS = 50;
const DEFAULT_VALID_FOR_SECONDS = 600;
// Cap order validity at 24h. Long-dated orders sit on the orderbook and
// telegraph intent to MEV searchers without meaningful upside — agents that
// genuinely need longer should pass it explicitly and we'll reject anyway.
const MAX_VALID_FOR_SECONDS = 24 * 60 * 60;

export const BuildOrderInput = {
  chainId: z.number().int().default(DEFAULT_CHAIN_ID),
  sellToken: z.string().min(1).describe('0x address or symbol'),
  buyToken: z.string().min(1).describe('0x address or symbol'),
  sellAmount: PositiveAmountSchema.describe(
    'Sell amount in base units (incl. fee for sell orders)'
  ),
  buyAmount: PositiveAmountSchema.describe('Buy amount in base units (from quote)'),
  kind: z.enum(['sell', 'buy']),
  from: AddressSchema.describe('Signer / order owner address (required)'),
  receiver: AddressSchema.optional().describe('Defaults to `from`'),
  slippageBps: z
    .number()
    .int()
    .min(0)
    .max(10000)
    .optional()
    .describe('Slippage in basis points; default 50 (0.5%)'),
  validFor: z
    .number()
    .int()
    .positive()
    .max(MAX_VALID_FOR_SECONDS)
    .optional()
    .describe(
      'Order validity in seconds; default 600 (10 min), max 86400 (24h). Pick the shortest window your flow tolerates — long-dated orders leak intent to MEV searchers.'
    ),
  partiallyFillable: z.boolean().optional(),
  quoteId: z
    .number()
    .int()
    .optional()
    .describe('Pass-through from cow_get_quote for orderbook analytics'),
};

export type BuildOrderOutput = {
  typedData: {
    domain: Record<string, unknown>;
    types: Record<string, ReadonlyArray<{ name: string; type: string }>>;
    primaryType: 'Order';
    message: EipOrderMessage;
  };
  orderDigest: string;
  appDataHash: string;
  appData: string;
  expectedBuyAmount: string;
  expectedSellAmount: string;
  validTo: number;
  quoteId?: number;
};

function applySlippage(args: {
  kind: 'sell' | 'buy';
  sellAmount: string;
  buyAmount: string;
  slippageBps: number;
}): { sellAmount: string; buyAmount: string } {
  const bps = BigInt(args.slippageBps);
  const denom = 10000n;
  const sell = BigInt(args.sellAmount);
  const buy = BigInt(args.buyAmount);

  if (args.kind === 'sell') {
    // Lock in sell, accept less buy.
    const minBuy = (buy * (denom - bps)) / denom;
    return { sellAmount: sell.toString(), buyAmount: minBuy.toString() };
  }
  // Buy: lock in buy, accept paying more sell.
  const maxSell = (sell * (denom + bps)) / denom;
  return { sellAmount: maxSell.toString(), buyAmount: buy.toString() };
}

export async function buildOrder(args: {
  chainId: number;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  kind: 'sell' | 'buy';
  from: string;
  receiver?: string;
  slippageBps?: number;
  validFor?: number;
  partiallyFillable?: boolean;
  quoteId?: number;
}): Promise<BuildOrderOutput> {
  try {
    const slippageBps = args.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
    const validFor = args.validFor ?? DEFAULT_VALID_FOR_SECONDS;
    const validTo = Math.floor(Date.now() / 1000) + validFor;

    const [sellToken, buyToken] = await Promise.all([
      resolveToken(args.chainId, args.sellToken),
      resolveToken(args.chainId, args.buyToken),
    ]);

    const adjusted = applySlippage({
      kind: args.kind,
      sellAmount: args.sellAmount,
      buyAmount: args.buyAmount,
      slippageBps,
    });

    const { appDataContent, appDataHex } = buildAppData({ slippageBps });

    const message: EipOrderMessage = {
      sellToken: checksumAddress(sellToken),
      buyToken: checksumAddress(buyToken),
      // Default receiver to the signer (`from`). The protocol treats 0x0 as
      // "send to from", but human reviewers and some wallets read the zero
      // address as a burn — set it explicitly for clarity.
      receiver: checksumAddress(args.receiver ?? args.from),
      sellAmount: adjusted.sellAmount,
      buyAmount: adjusted.buyAmount,
      validTo,
      appData: appDataHex,
      // feeAmount is always 0 for off-chain orders — fees are baked into the limit price.
      feeAmount: '0',
      kind: args.kind,
      partiallyFillable: args.partiallyFillable ?? false,
      sellTokenBalance: 'erc20',
      buyTokenBalance: 'erc20',
    };

    const domain = cowDomain(args.chainId);
    const orderDigest = hashOrderTypedData(domain, message);

    return {
      typedData: {
        domain: domain,
        types: { Order: ORDER_TYPE_FIELDS },
        primaryType: ORDER_PRIMARY_TYPE,
        message,
      },
      orderDigest,
      appDataHash: appDataHex,
      appData: appDataContent,
      expectedSellAmount: adjusted.sellAmount,
      expectedBuyAmount: adjusted.buyAmount,
      validTo,
      ...(args.quoteId !== undefined ? { quoteId: args.quoteId } : {}),
    };
  } catch (err) {
    throw toMcpError(err, 'cow_build_order');
  }
}
