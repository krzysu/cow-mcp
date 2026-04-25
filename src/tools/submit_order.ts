import {
  BuyTokenDestination,
  type OrderCreation,
  OrderKind,
  SellTokenSource,
  SigningScheme,
} from '@cowprotocol/cow-sdk';
import { z } from 'zod';
import { DEFAULT_CHAIN_ID } from '../cow/chains.js';
import { ctx, getCow } from '../cow/client.js';
import { toMcpError, withRetry } from '../errors.js';
import { AddressSchema, AmountSchema, OrderUidSchema } from '../validators.js';

const HEX_RE = /^0x[0-9a-fA-F]+$/;
const HexSchema = z.string().regex(HEX_RE, 'must be 0x-prefixed hex');
// 65-byte ECDSA signature = `0x` + 130 hex chars; EIP-1271 signatures are
// variable-length contract-defined blobs, so the upper bound is generous.
const SignatureSchema = z
  .string()
  .regex(HEX_RE, 'must be 0x-prefixed hex')
  .describe('0x-prefixed hex signature (132 chars for ECDSA, longer for EIP-1271)');

export const SubmitOrderInput = {
  chainId: z.number().int().default(DEFAULT_CHAIN_ID),
  order: z
    .object({
      sellToken: AddressSchema,
      buyToken: AddressSchema,
      receiver: AddressSchema.optional(),
      sellAmount: AmountSchema,
      buyAmount: AmountSchema,
      validTo: z.number().int().positive(),
      feeAmount: AmountSchema.default('0'),
      kind: z.enum(['sell', 'buy']),
      partiallyFillable: z.boolean().default(false),
      sellTokenBalance: z.enum(['erc20', 'external', 'internal']).default('erc20'),
      buyTokenBalance: z.enum(['erc20', 'internal']).default('erc20'),
      from: AddressSchema.describe('Signer address — backend verifies signature recovery'),
      quoteId: z.number().int().optional(),
    })
    .describe('Order struct fields (matches the EIP-712 message from cow_build_order)'),
  signature: SignatureSchema,
  signingScheme: z
    .enum(['eip712', 'ethsign', 'eip1271'])
    .default('eip712')
    .describe(
      'Signing scheme used to produce `signature`. eip712 = standard EOA EIP-712 signature; ethsign = personal_sign over the digest; eip1271 = smart-account contract signature.'
    ),
  appData: z
    .string()
    .describe('Inline appData JSON string — must be the exact string from cow_build_order'),
  appDataHash: HexSchema.optional().describe(
    'Optional appData keccak-256 hash; backend verifies it matches `appData`'
  ),
};

export type SubmitOrderOutput = { uid: string };

const KIND_MAP = { sell: OrderKind.SELL, buy: OrderKind.BUY } as const;
const SCHEME_MAP = {
  eip712: SigningScheme.EIP712,
  ethsign: SigningScheme.ETHSIGN,
  eip1271: SigningScheme.EIP1271,
} as const;
const SELL_BALANCE_MAP = {
  erc20: SellTokenSource.ERC20,
  external: SellTokenSource.EXTERNAL,
  internal: SellTokenSource.INTERNAL,
} as const;
const BUY_BALANCE_MAP = {
  erc20: BuyTokenDestination.ERC20,
  internal: BuyTokenDestination.INTERNAL,
} as const;

export async function submitOrder(args: {
  chainId: number;
  order: {
    sellToken: string;
    buyToken: string;
    receiver?: string;
    sellAmount: string;
    buyAmount: string;
    validTo: number;
    feeAmount: string;
    kind: 'sell' | 'buy';
    partiallyFillable: boolean;
    sellTokenBalance: 'erc20' | 'external' | 'internal';
    buyTokenBalance: 'erc20' | 'internal';
    from: string;
    quoteId?: number;
  };
  signature: string;
  signingScheme: 'eip712' | 'ethsign' | 'eip1271';
  appData: string;
  appDataHash?: string;
}): Promise<SubmitOrderOutput> {
  const cow = getCow();
  try {
    const body: OrderCreation = {
      sellToken: args.order.sellToken,
      buyToken: args.order.buyToken,
      ...(args.order.receiver ? { receiver: args.order.receiver } : {}),
      sellAmount: args.order.sellAmount,
      buyAmount: args.order.buyAmount,
      validTo: args.order.validTo,
      feeAmount: args.order.feeAmount,
      kind: KIND_MAP[args.order.kind],
      partiallyFillable: args.order.partiallyFillable,
      sellTokenBalance: SELL_BALANCE_MAP[args.order.sellTokenBalance],
      buyTokenBalance: BUY_BALANCE_MAP[args.order.buyTokenBalance],
      signingScheme: SCHEME_MAP[args.signingScheme],
      signature: args.signature,
      from: args.order.from,
      ...(args.order.quoteId !== undefined ? { quoteId: args.order.quoteId } : {}),
      appData: args.appData,
      ...(args.appDataHash ? { appDataHash: args.appDataHash } : {}),
    };
    const uid = await withRetry(() => cow.sendOrder(body, ctx(args.chainId)));
    OrderUidSchema.parse(uid);
    return { uid };
  } catch (err) {
    throw toMcpError(err, 'cow_submit_order');
  }
}
