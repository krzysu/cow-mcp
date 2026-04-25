import { OrderBookApi, SupportedChainId } from '@cowprotocol/cow-sdk';
import { assertSupportedChain } from './chains.js';

export type Cow = OrderBookApi;

let singleton: OrderBookApi | undefined;

export function getCow(): OrderBookApi {
  if (singleton) return singleton;
  singleton = new OrderBookApi({
    chainId: SupportedChainId.MAINNET,
    env: 'prod',
  });
  return singleton;
}

/** Get a context override for a per-call chainId, validated. */
export function ctx(chainId: number): { chainId: SupportedChainId } {
  return { chainId: assertSupportedChain(chainId) };
}

/** Reset (test-only). */
export function __resetCow(): void {
  singleton = undefined;
}
