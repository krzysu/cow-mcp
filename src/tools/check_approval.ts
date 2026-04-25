import { type Address, parseAbi } from 'viem';
import { z } from 'zod';
import { DEFAULT_CHAIN_ID } from '../cow/chains.js';
import { vaultRelayerAddress } from '../cow/eip712.js';
import { getPublicClient } from '../cow/rpc.js';
import { toMcpError } from '../errors.js';
import { AddressSchema, checksumAddress } from '../validators.js';

const ERC20_ALLOWANCE_ABI = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
]);

export const CheckApprovalInput = {
  chainId: z.number().int().default(DEFAULT_CHAIN_ID),
  owner: AddressSchema.describe('Token owner / order signer'),
  sellToken: AddressSchema.describe('ERC-20 sell token address'),
};

export type CheckApprovalOutput = {
  approved: boolean;
  allowance: string;
  spender: string;
};

// "Reasonable" cutoff: an allowance < 2^128 is treated as not-approved-enough
// for practical orders. Mostly we expect MAX_UINT256 (when approved) or 0
// (when not); 2^128 is large enough that no realistic finite approval crosses
// it accidentally yet small enough that any "infinite-style" approval clears.
const APPROVAL_THRESHOLD = 1n << 128n;

export async function checkApproval(args: {
  chainId: number;
  owner: string;
  sellToken: string;
}): Promise<CheckApprovalOutput> {
  try {
    const spender = vaultRelayerAddress(args.chainId);
    const client = getPublicClient(args.chainId);
    const allowance = await client.readContract({
      address: args.sellToken as Address,
      abi: ERC20_ALLOWANCE_ABI,
      functionName: 'allowance',
      args: [args.owner as Address, spender],
    });

    return {
      approved: allowance >= APPROVAL_THRESHOLD,
      allowance: allowance.toString(),
      spender: checksumAddress(spender),
    };
  } catch (err) {
    throw toMcpError(err, 'cow_check_approval');
  }
}
