import { LATEST_APP_DATA_VERSION } from '@cowprotocol/cow-sdk';
import { appDataHash, stringifyDeterministic } from './eip712.js';

export const APP_CODE = 'cow-mcp';

/**
 * Build the appData payload for a v0.2 order. Returns both the deterministic
 * JSON content (sent inline to the orderbook) and its keccak-256 hash (the
 * `bytes32` field in the EIP-712 order struct).
 *
 * Inline appData avoids an IPFS round-trip — the orderbook accepts it
 * directly and computes its own hash for verification.
 */
export function buildAppData(opts: { slippageBps?: number }): {
  appDataContent: string;
  appDataHex: `0x${string}`;
} {
  const doc: Record<string, unknown> = {
    appCode: APP_CODE,
    metadata:
      typeof opts.slippageBps === 'number' ? { quote: { slippageBips: opts.slippageBps } } : {},
    version: LATEST_APP_DATA_VERSION,
  };
  const appDataContent = stringifyDeterministic(doc);
  return { appDataContent, appDataHex: appDataHash(appDataContent) };
}
