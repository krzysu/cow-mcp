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

/** EIP-55 checksum an address. Returns lowercased input unchanged when it isn't a valid address. */
export function checksumAddress(address: string): string {
  return isAddress(address) ? getAddress(address) : address;
}

export { isAddress };
