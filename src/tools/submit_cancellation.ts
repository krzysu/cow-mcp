import { EcdsaSigningScheme, type OrderCancellations } from '@cowprotocol/cow-sdk';
import { z } from 'zod';
import { DEFAULT_CHAIN_ID } from '../cow/chains.js';
import { ctx, getCow } from '../cow/client.js';
import { toMcpError, withRetry } from '../errors.js';
import { OrderUidSchema } from '../validators.js';

const HexSchema = z.string().regex(/^0x[0-9a-fA-F]+$/, 'must be 0x-prefixed hex');

export const SubmitCancellationInput = {
  chainId: z.number().int().default(DEFAULT_CHAIN_ID),
  uid: OrderUidSchema,
  signature: HexSchema,
  signingScheme: z.enum(['eip712', 'ethsign']).default('eip712'),
};

export type SubmitCancellationOutput = { ok: true };

const SCHEME_MAP = {
  eip712: EcdsaSigningScheme.EIP712,
  ethsign: EcdsaSigningScheme.ETHSIGN,
} as const;

export async function submitCancellation(args: {
  chainId: number;
  uid: string;
  signature: string;
  signingScheme: 'eip712' | 'ethsign';
}): Promise<SubmitCancellationOutput> {
  const cow = getCow();
  try {
    const body: OrderCancellations = {
      orderUids: [args.uid],
      signature: args.signature,
      signingScheme: SCHEME_MAP[args.signingScheme],
    };
    await withRetry(() => cow.sendSignedOrderCancellations(body, ctx(args.chainId)));
    return { ok: true };
  } catch (err) {
    throw toMcpError(err, 'cow_submit_cancellation');
  }
}
