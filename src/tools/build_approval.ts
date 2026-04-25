import { encodeFunctionData, parseAbi } from 'viem';
import { z } from 'zod';
import { DEFAULT_CHAIN_ID } from '../cow/chains.js';
import { vaultRelayerAddress } from '../cow/eip712.js';
import { toMcpError } from '../errors.js';
import { AddressSchema, AmountSchema, checksumAddress } from '../validators.js';

const ERC20_APPROVE_ABI = parseAbi(['function approve(address spender, uint256 amount)']);

const MAX_UINT256 = 115792089237316195423570985008687907853269984665640564039457584007913129639935n;

export const BuildApprovalInput = {
  chainId: z.number().int().default(DEFAULT_CHAIN_ID),
  sellToken: AddressSchema.describe('ERC-20 token to approve'),
  amount: AmountSchema.optional().describe('Approval amount in base units; default unlimited'),
};

export type BuildApprovalOutput = {
  to: string;
  data: string;
  value: string;
  spender: string;
  amount: string;
};

export function buildApproval(args: {
  chainId: number;
  sellToken: string;
  amount?: string;
}): BuildApprovalOutput {
  try {
    const spender = vaultRelayerAddress(args.chainId);
    const amount = args.amount ? BigInt(args.amount) : MAX_UINT256;
    const data = encodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      functionName: 'approve',
      args: [spender, amount],
    });
    return {
      to: checksumAddress(args.sellToken),
      data,
      value: '0',
      spender: checksumAddress(spender),
      amount: amount.toString(),
    };
  } catch (err) {
    throw toMcpError(err, 'cow_build_approval');
  }
}
