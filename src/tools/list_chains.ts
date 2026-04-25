import { CHAINS, SUPPORTED_CHAIN_IDS } from '../cow/chains.js';

export type ChainInfo = {
  chainId: number;
  name: string;
  nativeSymbol: string;
};

export function listChains(): ChainInfo[] {
  return SUPPORTED_CHAIN_IDS.map((chainId) => {
    const meta = CHAINS[chainId]!;
    return { chainId, name: meta.name, nativeSymbol: meta.nativeSymbol };
  });
}
