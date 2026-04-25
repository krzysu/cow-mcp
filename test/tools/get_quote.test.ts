import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CowSdk from '@cowprotocol/cow-sdk';

const getQuoteMock = vi.fn();

vi.mock('@cowprotocol/cow-sdk', async () => {
  const actual = await vi.importActual<typeof CowSdk>('@cowprotocol/cow-sdk');
  return {
    ...actual,
    OrderBookApi: vi.fn().mockImplementation(() => ({ getQuote: getQuoteMock })),
  };
});

const { getQuote } = await import('../../src/tools/get_quote.js');
const { __resetCow } = await import('../../src/cow/client.js');
const { __resetTokenCache } = await import('../../src/tools/list_tokens.js');

const SELL = '0x' + 'a'.repeat(40);
const BUY = '0x' + 'b'.repeat(40);

const baseQuoteResponse = {
  quote: {
    sellAmount: '1000000000000000000',
    buyAmount: '3500000000',
    feeAmount: '1000000000000000',
    validTo: 1_700_000_000,
    sellToken: SELL,
    buyToken: BUY,
    appData: '0x',
    kind: 'sell',
    partiallyFillable: false,
  },
  expiration: '2025-01-01T00:00:00Z',
  verified: true,
  id: 42,
};

describe('cow_get_quote', () => {
  beforeEach(() => {
    getQuoteMock.mockReset();
    __resetCow();
    __resetTokenCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns mapped quote fields for a sell order (addresses pass through)', async () => {
    getQuoteMock.mockResolvedValue(baseQuoteResponse);

    const out = await getQuote({
      chainId: 1,
      sellToken: SELL,
      buyToken: BUY,
      kind: 'sell',
      amount: '1000000000000000000',
    });

    expect(out).toEqual({
      sellAmount: '1000000000000000000',
      buyAmount: '3500000000',
      feeAmount: '1000000000000000',
      validTo: 1_700_000_000,
      quoteId: 42,
      expiration: '2025-01-01T00:00:00Z',
      verified: true,
    });
    const [req, ctx] = getQuoteMock.mock.calls[0]!;
    expect(req.sellToken).toBe(SELL);
    expect(req.buyToken).toBe(BUY);
    expect(req.kind).toBe('sell');
    expect(req.sellAmountBeforeFee).toBe('1000000000000000000');
    expect(req.validFor).toBe(1800);
    expect(ctx.chainId).toBe(1);
  });

  it('uses buyAmountAfterFee for buy kind', async () => {
    getQuoteMock.mockResolvedValue(baseQuoteResponse);
    await getQuote({
      chainId: 100,
      sellToken: SELL,
      buyToken: BUY,
      kind: 'buy',
      amount: '5',
    });
    const [req] = getQuoteMock.mock.calls[0]!;
    expect(req.kind).toBe('buy');
    expect(req.buyAmountAfterFee).toBe('5');
  });

  it('resolves symbols to addresses via the token list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          tokens: [
            { chainId: 1, address: SELL, symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
            { chainId: 1, address: BUY, symbol: 'USDC', name: 'USD Coin', decimals: 6 },
          ],
        }),
      }))
    );
    getQuoteMock.mockResolvedValue(baseQuoteResponse);

    await getQuote({
      chainId: 1,
      sellToken: 'WETH',
      buyToken: 'usdc',
      kind: 'sell',
      amount: '1',
    });

    const [req] = getQuoteMock.mock.calls[0]!;
    expect(req.sellToken).toBe(SELL);
    expect(req.buyToken).toBe(BUY);
  });

  it('errors with a helpful message on unknown symbol', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ tokens: [] }),
      }))
    );

    await expect(
      getQuote({
        chainId: 1,
        sellToken: 'NOPE',
        buyToken: BUY,
        kind: 'sell',
        amount: '1',
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining('"NOPE" not found on chain 1'),
    });
  });

  it('errors on ambiguous symbol with candidates', async () => {
    const altAddr = '0x' + 'c'.repeat(40);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          tokens: [
            { chainId: 1, address: SELL, symbol: 'FOO', name: 'Foo', decimals: 18 },
            { chainId: 1, address: altAddr, symbol: 'FOO', name: 'Other Foo', decimals: 18 },
          ],
        }),
      }))
    );

    await expect(
      getQuote({
        chainId: 1,
        sellToken: 'FOO',
        buyToken: BUY,
        kind: 'sell',
        amount: '1',
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining('ambiguous'),
    });
  });

  it('maps a 400 to InvalidRequest with body description', async () => {
    getQuoteMock.mockRejectedValue({
      status: 400,
      body: { errorType: 'InvalidQuote', description: 'no liquidity' },
    });
    await expect(
      getQuote({
        chainId: 1,
        sellToken: SELL,
        buyToken: BUY,
        kind: 'sell',
        amount: '1',
      })
    ).rejects.toMatchObject({
      code: -32600,
      message: expect.stringContaining('InvalidQuote: no liquidity'),
    });
  });

  it('rejects unsupported chain', async () => {
    await expect(
      getQuote({
        chainId: 99999,
        sellToken: SELL,
        buyToken: BUY,
        kind: 'sell',
        amount: '1',
      })
    ).rejects.toMatchObject({ message: expect.stringContaining('Unsupported chainId') });
  });
});
