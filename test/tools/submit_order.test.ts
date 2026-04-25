import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CowSdk from '@cowprotocol/cow-sdk';

const sendOrderMock = vi.fn();

vi.mock('@cowprotocol/cow-sdk', async () => {
  const actual = await vi.importActual<typeof CowSdk>('@cowprotocol/cow-sdk');
  return {
    ...actual,
    OrderBookApi: vi.fn().mockImplementation(() => ({ sendOrder: sendOrderMock })),
  };
});

const { submitOrder } = await import('../../src/tools/submit_order.js');
const { __resetCow } = await import('../../src/cow/client.js');

const VALID_UID = '0x' + 'a'.repeat(64) + 'd8da6bf26964af9d7eed9e03e53415d37aa96045' + '00000000';

const baseOrder = {
  sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  sellAmount: '1000000000000000000',
  buyAmount: '3980000000',
  validTo: 1800,
  feeAmount: '0',
  kind: 'sell' as const,
  partiallyFillable: false,
  sellTokenBalance: 'erc20' as const,
  buyTokenBalance: 'erc20' as const,
  from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
};

describe('cow_submit_order', () => {
  beforeEach(() => {
    sendOrderMock.mockReset();
    __resetCow();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forwards the order + signature and returns the uid', async () => {
    sendOrderMock.mockResolvedValue(VALID_UID);
    const out = await submitOrder({
      chainId: 1,
      order: baseOrder,
      signature: '0x' + '00'.repeat(65),
      signingScheme: 'eip712',
      appData: '{"appCode":"cow-mcp","metadata":{},"version":"1.4.0"}',
    });
    expect(out).toEqual({ uid: VALID_UID });
    expect(sendOrderMock).toHaveBeenCalledOnce();
    const body = sendOrderMock.mock.calls[0]![0];
    expect(body.kind).toBe('sell');
    expect(body.signingScheme).toBe('eip712');
    expect(body.appData).toContain('cow-mcp');
  });

  it('maps a 400 InsufficientAllowance to InvalidRequest', async () => {
    sendOrderMock.mockRejectedValue({
      status: 400,
      body: { errorType: 'InsufficientAllowance', description: 'approve first' },
    });
    await expect(
      submitOrder({
        chainId: 1,
        order: baseOrder,
        signature: '0x' + '00'.repeat(65),
        signingScheme: 'eip712',
        appData: '{}',
      })
    ).rejects.toMatchObject({ code: -32600 });
  });
});
