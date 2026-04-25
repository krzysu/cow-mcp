import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CowSdk from '@cowprotocol/cow-sdk';

const getTradesMock = vi.fn();
const blockTimestampsMock = vi.fn();
const onChainTokenMetaMock = vi.fn();

vi.mock('@cowprotocol/cow-sdk', async () => {
  const actual = await vi.importActual<typeof CowSdk>('@cowprotocol/cow-sdk');
  return {
    ...actual,
    OrderBookApi: vi.fn().mockImplementation(() => ({ getTrades: getTradesMock })),
  };
});

vi.mock('../../src/cow/block_time.js', () => ({
  blockTimestamps: blockTimestampsMock,
}));

vi.mock('../../src/cow/token_rpc.js', () => ({
  onChainTokenMeta: onChainTokenMetaMock,
}));

const { getTrades } = await import('../../src/tools/get_trades.js');
const { __resetCow } = await import('../../src/cow/client.js');
const { __resetTokenCache } = await import('../../src/tools/list_tokens.js');

const SELL = '0x1111111111111111111111111111111111111111';
const BUY = '0x2222222222222222222222222222222222222222';

const tokenList = {
  tokens: [
    { chainId: 1, address: SELL, symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    { chainId: 1, address: BUY, symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  ],
};

function makeTrade(i: number) {
  return {
    orderUid: `0xuid${i}`,
    blockNumber: 100 + i,
    logIndex: i,
    sellToken: SELL,
    buyToken: BUY,
    sellAmount: `${i}`,
    buyAmount: `${i * 2}`,
    txHash: `0xtx${i}`,
  };
}

describe('cow_get_trades', () => {
  beforeEach(() => {
    getTradesMock.mockReset();
    blockTimestampsMock.mockReset().mockResolvedValue(new Map());
    onChainTokenMetaMock.mockReset().mockResolvedValue(new Map());
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
      sellTokenSymbol: 'WETH',
      sellTokenDecimals: 18,
      buyTokenSymbol: 'USDC',
      buyTokenDecimals: 6,
    });
  });

  it('falls back to on-chain symbol/decimals for tokens missing from curated list', async () => {
    const longTail = '0x9999999999999999999999999999999999999999';
    getTradesMock.mockResolvedValue([{ ...makeTrade(0), buyToken: longTail }]);
    onChainTokenMetaMock.mockResolvedValue(
      new Map([[longTail.toLowerCase(), { symbol: 'AIRDROP', decimals: 9 }]])
    );
    const out = await getTrades({ chainId: 1, owner: '0xabc' });
    expect(onChainTokenMetaMock).toHaveBeenCalled();
    expect(out[0]).toMatchObject({
      buyTokenSymbol: 'AIRDROP',
      buyTokenDecimals: 9,
    });
  });

  it('omits symbol/decimals when on-chain fallback also fails', async () => {
    const longTail = '0x9999999999999999999999999999999999999999';
    getTradesMock.mockResolvedValue([{ ...makeTrade(0), sellToken: longTail }]);
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

  it('attaches blockTimestamp when RPC resolves the block', async () => {
    getTradesMock.mockResolvedValue([makeTrade(0)]);
    blockTimestampsMock.mockResolvedValue(new Map([[100, '2025-01-02T03:04:05.000Z']]));
    const out = await getTrades({ chainId: 1, owner: '0xabc' });
    expect(out[0]?.blockTimestamp).toBe('2025-01-02T03:04:05.000Z');
  });

  it('omits blockTimestamp when RPC fallback returns nothing', async () => {
    getTradesMock.mockResolvedValue([makeTrade(0)]);
    const out = await getTrades({ chainId: 1, owner: '0xabc' });
    expect(out[0]).not.toHaveProperty('blockTimestamp');
  });

  it('returns EIP-55 checksummed token addresses', async () => {
    getTradesMock.mockResolvedValue([
      {
        ...makeTrade(0),
        sellToken: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        buyToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      },
    ]);
    const out = await getTrades({ chainId: 1, owner: '0xabc' });
    expect(out[0]?.sellToken).toBe('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
    expect(out[0]?.buyToken).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
  });
});
