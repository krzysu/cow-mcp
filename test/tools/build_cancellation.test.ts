import { describe, expect, it } from 'vitest';
import { buildCancellation } from '../../src/tools/build_cancellation.js';

const UID =
  '0x' +
  'a'.repeat(64) + // orderDigest
  'd8da6bf26964af9d7eed9e03e53415d37aa96045' + // owner
  '00000000'; // validTo

describe('cow_build_cancellation', () => {
  it('returns typedData with the orderUid in message and a digest', () => {
    const out = buildCancellation({ chainId: 1, uid: UID });
    expect(out.typedData.primaryType).toBe('OrderCancellations');
    expect(out.typedData.message.orderUids).toEqual([UID]);
    expect(out.cancellationDigest).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('different chainId yields different digest (domain-separated)', () => {
    const a = buildCancellation({ chainId: 1, uid: UID });
    const b = buildCancellation({ chainId: 100, uid: UID });
    expect(a.cancellationDigest).not.toBe(b.cancellationDigest);
  });
});
