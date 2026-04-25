import { describe, expect, it } from 'vitest';
import { buildApproval } from '../../src/tools/build_approval.js';

const SELL = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

describe('cow_build_approval', () => {
  it('produces approve(spender, MAX_UINT256) calldata by default', () => {
    const out = buildApproval({ chainId: 1, sellToken: SELL });
    expect(out.to).toBe(SELL);
    expect(out.value).toBe('0');
    // Function selector for `approve(address,uint256)` is 0x095ea7b3.
    expect(out.data.startsWith('0x095ea7b3')).toBe(true);
    // MAX_UINT256 ends with 64 'f'.
    expect(out.data.endsWith('f'.repeat(64))).toBe(true);
    expect(out.amount).toBe(
      '115792089237316195423570985008687907853269984665640564039457584007913129639935'
    );
  });

  it('encodes a custom amount', () => {
    const out = buildApproval({ chainId: 1, sellToken: SELL, amount: '1000' });
    expect(out.amount).toBe('1000');
    expect(out.data.startsWith('0x095ea7b3')).toBe(true);
  });
});
