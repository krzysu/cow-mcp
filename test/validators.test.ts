import { describe, expect, it } from 'vitest';
import { AddressSchema, OrderUidSchema, checksumAddress } from '../src/validators.js';

describe('AddressSchema', () => {
  it('accepts a valid 0x address', () => {
    expect(AddressSchema.parse('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')).toMatch(/^0x/i);
  });

  it('rejects a too-short address with a clear message', () => {
    const res = AddressSchema.safeParse('0xdeadbeef');
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]?.message).toContain('invalid address');
    }
  });

  it('rejects non-hex characters', () => {
    const res = AddressSchema.safeParse('0xZZZZ6bf26964af9d7eed9e03e53415d37aa96045');
    expect(res.success).toBe(false);
  });
});

describe('OrderUidSchema', () => {
  it('accepts a 0x-prefixed 56-byte hex uid', () => {
    const uid = '0x' + 'ab'.repeat(56);
    expect(OrderUidSchema.parse(uid)).toBe(uid);
  });

  it('rejects a short value with a clear message', () => {
    const res = OrderUidSchema.safeParse('0xdeadbeef');
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]?.message).toContain('invalid order uid');
    }
  });
});

describe('checksumAddress', () => {
  it('returns EIP-55 checksummed address for a valid lowercase input', () => {
    expect(checksumAddress('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')).toBe(
      '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
    );
  });

  it('returns the input unchanged when not a valid address', () => {
    expect(checksumAddress('0xunknown')).toBe('0xunknown');
  });
});
