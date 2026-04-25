import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CowSdk from '@cowprotocol/cow-sdk';

const getOrderMock = vi.fn();
const getTradesMock = vi.fn();

vi.mock('@cowprotocol/cow-sdk', async () => {
  const actual = await vi.importActual<typeof CowSdk>('@cowprotocol/cow-sdk');
  return {
    ...actual,
    OrderBookApi: vi.fn().mockImplementation(() => ({
      getOrder: getOrderMock,
      getTrades: getTradesMock,
    })),
  };
});

const { getOrder } = await import('../../src/tools/get_order.js');
const { __resetCow } = await import('../../src/cow/client.js');
const { __resetTokenCache } = await import('../../src/tools/list_tokens.js');

const tokenList = {
  tokens: [
    { chainId: 1, address: '0xsell', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    { chainId: 1, address: '0xbuy', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  ],
};

describe('cow_get_order', () => {
  beforeEach(() => {
    getOrderMock.mockReset();
    getTradesMock.mockReset();
    __resetCow();
    __resetTokenCache();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => tokenList,
      }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns mapped fields and includes settlement tx for fulfilled orders', async () => {
    getOrderMock.mockResolvedValue({
      uid: '0xabc',
      owner: '0xowner',
      status: 'fulfilled',
      sellToken: '0xsell',
      buyToken: '0xbuy',
      sellAmount: '100',
      buyAmount: '200',
      executedSellAmount: '100',
      executedBuyAmount: '199',
      validTo: 999,
      creationDate: '2025-01-01T00:00:00Z',
    });
    getTradesMock.mockResolvedValue([
      { txHash: '0xdeadbeef', orderUid: '0xabc', blockNumber: 1, logIndex: 0 },
    ]);

    const out = await getOrder({ chainId: 1, uid: '0xabc' });
    expect(out.status).toBe('fulfilled');
    expect(out.txHash).toBe('0xdeadbeef');
    expect(out.executedBuyAmount).toBe('199');
    expect(out.sellTokenSymbol).toBe('WETH');
    expect(out.sellTokenDecimals).toBe(18);
    expect(out.buyTokenSymbol).toBe('USDC');
    expect(out.buyTokenDecimals).toBe(6);
    expect(getTradesMock).toHaveBeenCalledOnce();
  });

  it('does not call getTrades for an open order and omits txHash', async () => {
    getOrderMock.mockResolvedValue({
      uid: '0xopen',
      owner: '0xowner',
      status: 'open',
      sellToken: '0xs',
      buyToken: '0xb',
      sellAmount: '1',
      buyAmount: '1',
      executedSellAmount: '0',
      executedBuyAmount: '0',
      validTo: 1,
      creationDate: '2025-01-01T00:00:00Z',
    });

    const out = await getOrder({ chainId: 1, uid: '0xopen' });
    expect(out.status).toBe('open');
    expect(out.txHash).toBeUndefined();
    expect(getTradesMock).not.toHaveBeenCalled();
  });

  it('maps presignaturePending to "open"', async () => {
    getOrderMock.mockResolvedValue({
      uid: '0xp',
      owner: '0x',
      status: 'presignaturePending',
      sellToken: '0x',
      buyToken: '0x',
      sellAmount: '1',
      buyAmount: '1',
      executedSellAmount: '0',
      executedBuyAmount: '0',
      validTo: 1,
      creationDate: '2025-01-01T00:00:00Z',
    });
    const out = await getOrder({ chainId: 1, uid: '0xp' });
    expect(out.status).toBe('open');
  });

  it('maps a 404 to "not found" InvalidRequest', async () => {
    getOrderMock.mockRejectedValue({ status: 404, body: { description: 'gone' } });
    await expect(getOrder({ chainId: 1, uid: '0xmissing' })).rejects.toMatchObject({
      code: -32600,
      message: expect.stringContaining('not found'),
    });
  });

  it('returns EIP-55 checksummed addresses', async () => {
    getOrderMock.mockResolvedValue({
      uid: '0xabc',
      owner: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      status: 'open',
      sellToken: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      buyToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      sellAmount: '1',
      buyAmount: '1',
      executedSellAmount: '0',
      executedBuyAmount: '0',
      validTo: 1,
      creationDate: '2025-01-01T00:00:00Z',
    });
    const out = await getOrder({ chainId: 1, uid: '0xabc' });
    expect(out.owner).toBe('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
    expect(out.sellToken).toBe('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
    expect(out.buyToken).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
  });
});
