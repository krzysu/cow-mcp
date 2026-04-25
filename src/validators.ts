import { getAddress, isAddress } from 'viem';
import { z } from 'zod';

// CoW order UID = 32-byte orderDigest + 20-byte owner + 4-byte validTo = 56 bytes (114 chars).
const ORDER_UID_RE = /^0x[0-9a-fA-F]{112}$/;

export const AddressSchema = z
  .string()
  .refine((s) => isAddress(s), 'invalid address: must be 0x-prefixed 20-byte hex (42 chars)');

export const OrderUidSchema = z
  .string()
  .regex(ORDER_UID_RE, 'invalid order uid: must be 0x-prefixed 56-byte hex (114 chars)');

/**
 * Token amount in base units (decimal string).
 *
 * `PositiveAmountSchema` rejects "0" — used for order inputs where a zero
 * sell/buy amount can't produce a real swap (`cow_get_quote`, `cow_build_order`).
 *
 * `AmountSchema` allows "0" — used at the wire boundary (`cow_submit_order`,
 * `cow_build_approval`) where `feeAmount: '0'` is the valid protocol default.
 */
export const PositiveAmountSchema = z
  .string()
  .regex(/^[1-9]\d*$/, 'must be a positive integer in base units (decimal string)');

export const AmountSchema = z
  .string()
  .regex(/^\d+$/, 'must be a non-negative integer in base units (decimal string)');

/** EIP-55 checksum an address. Returns lowercased input unchanged when it isn't a valid address. */
export function checksumAddress(address: string): string {
  return isAddress(address) ? getAddress(address) : address;
}

export { isAddress };
