import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetTokenCache, listTokens } from '../../src/tools/list_tokens.js';

const sampleList = {
  tokens: [
    {
      chainId: 1,
      address: '0xaaa',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
      logoURI: 'http://x',
    },
    {
      chainId: 1,
      address: '0xbbb',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
    },
    {
      chainId: 100,
      address: '0xccc',
      symbol: 'GNO',
      name: 'Gnosis',
      decimals: 18,
    },
  ],
};

describe('cow_list_tokens', () => {
  beforeEach(() => {
    __resetTokenCache();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => sampleList,
      }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('filters tokens by chainId', async () => {
    const out = await listTokens({ chainId: 1 });
    expect(out.map((t) => t.symbol).sort()).toEqual(['USDC', 'WETH']);
  });

  it('search matches symbol substring (case-insensitive)', async () => {
    const out = await listTokens({ chainId: 1, search: 'usd' });
    expect(out).toHaveLength(1);
    expect(out[0]?.symbol).toBe('USDC');
  });

  it('search matches address exactly', async () => {
    const out = await listTokens({ chainId: 1, search: '0xAAA' });
    expect(out).toHaveLength(1);
    expect(out[0]?.address).toBe('0xaaa');
  });

  it('omits logoURI when undefined', async () => {
    const out = await listTokens({ chainId: 1, search: 'usd' });
    expect(out[0]).not.toHaveProperty('logoURI');
  });

  it('rejects unsupported chain', async () => {
    await expect(listTokens({ chainId: 99999 })).rejects.toMatchObject({
      message: expect.stringContaining('Unsupported chainId'),
    });
  });
});
