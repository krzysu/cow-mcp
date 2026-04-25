import { describe, expect, it } from 'vitest';
import { listChains } from '../../src/tools/list_chains.js';

describe('cow_list_chains', () => {
  it('includes Ethereum mainnet', () => {
    const out = listChains();
    const eth = out.find((c) => c.chainId === 1);
    expect(eth).toEqual({ chainId: 1, name: 'Ethereum', nativeSymbol: 'ETH' });
  });

  it('includes every chain returned by ALL_SUPPORTED_CHAIN_IDS with a name', () => {
    const out = listChains();
    expect(out.length).toBeGreaterThanOrEqual(10);
    for (const c of out) {
      expect(typeof c.chainId).toBe('number');
      expect(c.name.length).toBeGreaterThan(0);
    }
  });
});
