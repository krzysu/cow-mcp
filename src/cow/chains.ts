import { ALL_SUPPORTED_CHAIN_IDS, SupportedChainId } from '@cowprotocol/cow-sdk';

export type ChainId = number;

const NAMES: Record<number, { name: string; nativeSymbol: string }> = {
  [SupportedChainId.MAINNET]: { name: 'Ethereum', nativeSymbol: 'ETH' },
  [SupportedChainId.BNB]: { name: 'BNB Chain', nativeSymbol: 'BNB' },
  [SupportedChainId.GNOSIS_CHAIN]: { name: 'Gnosis', nativeSymbol: 'xDAI' },
  [SupportedChainId.POLYGON]: { name: 'Polygon', nativeSymbol: 'POL' },
  [SupportedChainId.BASE]: { name: 'Base', nativeSymbol: 'ETH' },
  [SupportedChainId.PLASMA]: { name: 'Plasma', nativeSymbol: 'XPL' },
  [SupportedChainId.ARBITRUM_ONE]: { name: 'Arbitrum One', nativeSymbol: 'ETH' },
  [SupportedChainId.AVALANCHE]: { name: 'Avalanche', nativeSymbol: 'AVAX' },
  [SupportedChainId.INK]: { name: 'Ink', nativeSymbol: 'ETH' },
  [SupportedChainId.LINEA]: { name: 'Linea', nativeSymbol: 'ETH' },
  [SupportedChainId.SEPOLIA]: { name: 'Sepolia', nativeSymbol: 'ETH' },
};

/**
 * Every chain ID supported by the CoW orderbook (sourced from cow-sdk so it
 * stays in sync with upstream). Names default to "chain-<id>" for any chain
 * we haven't manually labelled yet.
 */
export const CHAINS: Record<number, { name: string; nativeSymbol: string }> = Object.fromEntries(
  ALL_SUPPORTED_CHAIN_IDS.map((id) => [id, NAMES[id] ?? { name: `chain-${id}`, nativeSymbol: '' }])
);

export const SUPPORTED_CHAIN_IDS: number[] = [...ALL_SUPPORTED_CHAIN_IDS];

export const DEFAULT_CHAIN_ID: ChainId = SupportedChainId.MAINNET;

export function assertSupportedChain(chainId: number): SupportedChainId {
  if (!(chainId in CHAINS)) {
    throw new Error(`Unsupported chainId ${chainId}. Supported: ${SUPPORTED_CHAIN_IDS.join(', ')}`);
  }
  return chainId;
}
