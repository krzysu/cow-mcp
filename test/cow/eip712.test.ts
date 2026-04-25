import { describe, expect, it } from 'vitest';
import {
  appDataHash,
  cowDomain,
  type EipOrderMessage,
  hashOrderTypedData,
  stringifyDeterministic,
} from '../../src/cow/eip712.js';

describe('stringifyDeterministic', () => {
  // Pinned because this is what the EIP-712 appData hash commits to. If the
  // serializer drifts, every previously-signed order stops verifying — so
  // any change here must be intentional.
  it('produces sorted-key JSON with no whitespace', () => {
    expect(stringifyDeterministic({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('recurses into nested objects and arrays', () => {
    const input = { z: [{ y: 1, x: 2 }, 'lit'], a: { d: 4, c: 3 } };
    expect(stringifyDeterministic(input)).toBe('{"a":{"c":3,"d":4},"z":[{"x":2,"y":1},"lit"]}');
  });

  it('handles primitive values', () => {
    expect(stringifyDeterministic(null)).toBe('null');
    expect(stringifyDeterministic(42)).toBe('42');
    expect(stringifyDeterministic('hi')).toBe('"hi"');
    expect(stringifyDeterministic(true)).toBe('true');
  });

  it('appDataHash matches a known cow-mcp default appData payload', () => {
    // The cow-mcp default appData (slippageBps=50). Pinned hash so any
    // change to the serializer or default appData shape is caught here.
    const content = stringifyDeterministic({
      appCode: 'cow-mcp',
      metadata: { quote: { slippageBips: 50 } },
      version: '1.4.0',
    });
    expect(content).toBe(
      '{"appCode":"cow-mcp","metadata":{"quote":{"slippageBips":50}},"version":"1.4.0"}'
    );
    expect(appDataHash(content)).toBe(
      '0xf7f68632f42cbba043af03627bd2eb94572e029c2cdfdd5b7780f54e25681275'
    );
  });
});

describe('hashOrderTypedData', () => {
  // Frozen vector: catches any drift in the EIP-712 domain (`Gnosis Protocol`
  // / `v2` / settlement contract) or the ORDER_TYPE_FIELDS list. If this
  // hash changes, every previously-signed order stops verifying — the test
  // must be updated only after a deliberate, reviewed change.
  it('matches a pinned digest for a fixed mainnet order', () => {
    const message: EipOrderMessage = {
      sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
      buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      receiver: '0x1111111111111111111111111111111111111111',
      sellAmount: '1000000000000000000',
      buyAmount: '3000000000',
      validTo: 2_000_000_000,
      appData: '0xf7f68632f42cbba043af03627bd2eb94572e029c2cdfdd5b7780f54e25681275',
      feeAmount: '0',
      kind: 'sell',
      partiallyFillable: false,
      sellTokenBalance: 'erc20',
      buyTokenBalance: 'erc20',
    };
    expect(hashOrderTypedData(cowDomain(1), message)).toBe(
      '0x5a7e3fdd541505e317f21cfe5e5334f5d1757867df071f4374928397ada0a1d0'
    );
  });
});
