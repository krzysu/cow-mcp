import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CowSdk from '@cowprotocol/cow-sdk';

const getTradesMock = vi.fn();

vi.mock('@cowprotocol/cow-sdk', async () => {
  const actual = await vi.importActual<typeof CowSdk>('@cowprotocol/cow-sdk');
  return {
    ...actual,
    OrderBookApi: vi.fn().mockImplementation(() => ({ getTrades: getTradesMock })),
  };
});

const { getTrades } = await import('../../src/tools/get_trades.js');
const { __resetCow } = await import('../../src/cow/client.js');
const { __resetTokenCache } = await import('../../src/tools/list_tokens.js');

const tokenList = {
  tokens: [
    { chainId: 1, address: '0xsell', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    { chainId: 1, address: '0xbuy', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  ],
};

function makeTrade(i: number) {
  return {
    orderUid: `0xuid${i}`,
    blockNumber: 100 + i,
    logIndex: i,
    sellToken: '0xsell',
    buyToken: '0xbuy',
    sellAmount: `${i}`,
    buyAmount: `${i * 2}`,
    txHash: `0xtx${i}`,
  };
}

describe('cow_get_trades', () => {
  beforeEach(() => {
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

  it('caps results at limit (default 25)', async () => {
    getTradesMock.mockResolvedValue(Array.from({ length: 60 }, (_, i) => makeTrade(i)));
    const out = await getTrades({ chainId: 1, owner: '0xabc' });
    expect(out).toHaveLength(25);
    expect(out[0]?.orderUid).toBe('0xuid0');
  });

  it('honours an explicit limit and clamps to 100', async () => {
    getTradesMock.mockResolvedValue(Array.from({ length: 200 }, (_, i) => makeTrade(i)));
    const out = await getTrades({ chainId: 1, owner: '0xabc', limit: 500 });
    expect(out).toHaveLength(100);
  });

  it('passes owner filter and chain context to the orderbook', async () => {
    getTradesMock.mockResolvedValue([]);
    await getTrades({ chainId: 100, owner: '0xowner' });
    expect(getTradesMock).toHaveBeenCalledWith({ owner: '0xowner' }, { chainId: 100 });
  });

  it('coerces null txHash to empty string', async () => {
    getTradesMock.mockResolvedValue([{ ...makeTrade(0), txHash: null }]);
    const out = await getTrades({ chainId: 1, owner: '0xabc' });
    expect(out[0]?.txHash).toBe('');
  });

  it('enriches trades with symbol/decimals from the token list', async () => {
    getTradesMock.mockResolvedValue([makeTrade(0)]);
    const out = await getTrades({ chainId: 1, owner: '0xabc' });
    expect(out[0]).toMatchObject({
      sellToken: '0xsell',
      sellTokenSymbol: 'WETH',
      sellTokenDecimals: 18,
      buyToken: '0xbuy',
      buyTokenSymbol: 'USDC',
      buyTokenDecimals: 6,
    });
  });

  it('omits symbol/decimals for unknown addresses', async () => {
    getTradesMock.mockResolvedValue([
      { ...makeTrade(0), sellToken: '0xunknown', buyToken: '0xbuy' },
    ]);
    const out = await getTrades({ chainId: 1, owner: '0xabc' });
    expect(out[0]).not.toHaveProperty('sellTokenSymbol');
    expect(out[0]?.buyTokenSymbol).toBe('USDC');
  });

  it('resolves the native ETH sentinel to chain native symbol', async () => {
    getTradesMock.mockResolvedValue([
      {
        ...makeTrade(0),
        buyToken: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      },
    ]);
    const out = await getTrades({ chainId: 1, owner: '0xabc' });
    expect(out[0]).toMatchObject({
      buyTokenSymbol: 'ETH',
      buyTokenDecimals: 18,
    });
  });
});
