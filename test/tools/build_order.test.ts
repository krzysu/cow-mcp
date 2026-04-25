import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

const tokenList = {
  tokens: [
    {
      chainId: 1,
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
    },
    {
      chainId: 1,
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
    },
  ],
};

const { buildOrder } = await import('../../src/tools/build_order.js');
const { __resetTokenCache } = await import('../../src/tools/list_tokens.js');

describe('cow_build_order', () => {
  beforeEach(() => {
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

  const FROM = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

  it('shrinks buyAmount on a sell order according to slippageBps', async () => {
    const out = await buildOrder({
      chainId: 1,
      sellToken: 'WETH',
      buyToken: 'USDC',
      sellAmount: '1000000000000000000',
      buyAmount: '4000000000',
      kind: 'sell',
      from: FROM,
      slippageBps: 50,
      validFor: 1800,
    });

    expect(out.expectedSellAmount).toBe('1000000000000000000');
    // 4_000_000_000 * (10000 - 50) / 10000 = 3_980_000_000
    expect(out.expectedBuyAmount).toBe('3980000000');
    expect(out.typedData.message.kind).toBe('sell');
    expect(out.typedData.message.feeAmount).toBe('0');
    expect(out.typedData.primaryType).toBe('Order');
    expect(out.typedData.types.Order).toBeDefined();
    expect(out.appData).toContain('"appCode":"cow-mcp"');
    expect(out.orderDigest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(out.appDataHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('grows sellAmount on a buy order according to slippageBps', async () => {
    const out = await buildOrder({
      chainId: 1,
      sellToken: 'WETH',
      buyToken: 'USDC',
      sellAmount: '1000000000000000000',
      buyAmount: '4000000000',
      kind: 'buy',
      from: FROM,
      slippageBps: 100,
    });
    // 1e18 * (10000 + 100) / 10000 = 1.01e18
    expect(out.expectedSellAmount).toBe('1010000000000000000');
    expect(out.expectedBuyAmount).toBe('4000000000');
  });

  it('produces a deterministic orderDigest for the same inputs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const a = await buildOrder({
      chainId: 1,
      sellToken: 'WETH',
      buyToken: 'USDC',
      sellAmount: '1000000000000000000',
      buyAmount: '4000000000',
      kind: 'sell',
      from: FROM,
      slippageBps: 50,
      validFor: 1800,
    });
    const b = await buildOrder({
      chainId: 1,
      sellToken: 'WETH',
      buyToken: 'USDC',
      sellAmount: '1000000000000000000',
      buyAmount: '4000000000',
      kind: 'sell',
      from: FROM,
      slippageBps: 50,
      validFor: 1800,
    });
    expect(a.orderDigest).toBe(b.orderDigest);
    expect(a.validTo).toBe(b.validTo);
    vi.useRealTimers();
  });

  it('rejects unsupported chainId', async () => {
    await expect(
      buildOrder({
        chainId: 999999,
        sellToken: 'WETH',
        buyToken: 'USDC',
        sellAmount: '1',
        buyAmount: '1',
        kind: 'sell',
        from: FROM,
      })
    ).rejects.toMatchObject({ code: -32603 });
  });
});
