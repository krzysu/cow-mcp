import { type Hex, hashTypedData } from 'viem';
import { z } from 'zod';
import { DEFAULT_CHAIN_ID } from '../cow/chains.js';
import { CANCELLATIONS_PRIMARY_TYPE, CANCELLATIONS_TYPE_FIELDS, cowDomain } from '../cow/eip712.js';
import { toMcpError } from '../errors.js';
import { OrderUidSchema } from '../validators.js';

export const BuildCancellationInput = {
  chainId: z.number().int().default(DEFAULT_CHAIN_ID),
  uid: OrderUidSchema.describe('Order UID to cancel'),
};

export type BuildCancellationOutput = {
  typedData: {
    domain: Record<string, unknown>;
    types: Record<string, ReadonlyArray<{ name: string; type: string }>>;
    primaryType: 'OrderCancellations';
    message: { orderUids: string[] };
  };
  cancellationDigest: string;
};

export function buildCancellation(args: { chainId: number; uid: string }): BuildCancellationOutput {
  try {
    const domain = cowDomain(args.chainId);
    const message = { orderUids: [args.uid as Hex] };
    const types = { OrderCancellations: CANCELLATIONS_TYPE_FIELDS } as const;

    const cancellationDigest = hashTypedData({
      domain,
      types,
      primaryType: CANCELLATIONS_PRIMARY_TYPE,
      message,
    });

    return {
      typedData: {
        domain,
        types,
        primaryType: CANCELLATIONS_PRIMARY_TYPE,
        message,
      },
      cancellationDigest,
    };
  } catch (err) {
    throw toMcpError(err, 'cow_build_cancellation');
  }
}
