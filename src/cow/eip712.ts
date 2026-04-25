import {
  COW_PROTOCOL_SETTLEMENT_CONTRACT_ADDRESS,
  COW_PROTOCOL_VAULT_RELAYER_ADDRESS,
} from '@cowprotocol/cow-sdk';
import { type TypedDataDomain, getAddress, hashTypedData, keccak256, toBytes } from 'viem';
import { assertSupportedChain } from './chains.js';

// EIP-712 type fields for GPv2 orders. Authoritative reference:
// @cowprotocol/sdk-contracts-ts ORDER_TYPE_FIELDS.
export const ORDER_TYPE_FIELDS = [
  { name: 'sellToken', type: 'address' },
  { name: 'buyToken', type: 'address' },
  { name: 'receiver', type: 'address' },
  { name: 'sellAmount', type: 'uint256' },
  { name: 'buyAmount', type: 'uint256' },
  { name: 'validTo', type: 'uint32' },
  { name: 'appData', type: 'bytes32' },
  { name: 'feeAmount', type: 'uint256' },
  { name: 'kind', type: 'string' },
  { name: 'partiallyFillable', type: 'bool' },
  { name: 'sellTokenBalance', type: 'string' },
  { name: 'buyTokenBalance', type: 'string' },
] as const;

export const CANCELLATIONS_TYPE_FIELDS = [{ name: 'orderUids', type: 'bytes[]' }] as const;

export const ORDER_PRIMARY_TYPE = 'Order' as const;
export const CANCELLATIONS_PRIMARY_TYPE = 'OrderCancellations' as const;

export function cowDomain(chainId: number): TypedDataDomain {
  const id = assertSupportedChain(chainId);
  const verifyingContract = COW_PROTOCOL_SETTLEMENT_CONTRACT_ADDRESS[id];
  if (!verifyingContract) {
    throw new Error(`no GPv2 settlement contract for chainId ${chainId}`);
  }
  return {
    name: 'Gnosis Protocol',
    version: 'v2',
    chainId,
    verifyingContract: getAddress(verifyingContract),
  };
}

export function vaultRelayerAddress(chainId: number): `0x${string}` {
  const id = assertSupportedChain(chainId);
  const addr = COW_PROTOCOL_VAULT_RELAYER_ADDRESS[id];
  if (!addr) throw new Error(`no GPv2 vault relayer for chainId ${chainId}`);
  return getAddress(addr);
}

export type EipOrderMessage = {
  sellToken: string;
  buyToken: string;
  receiver: string;
  sellAmount: string;
  buyAmount: string;
  validTo: number;
  appData: string;
  feeAmount: string;
  kind: 'sell' | 'buy';
  partiallyFillable: boolean;
  sellTokenBalance: string;
  buyTokenBalance: string;
};

// viem's hashTypedData type-narrows the message against the TypedDataParameter
// tuple, requiring `0x${string}`/bigint shapes the orderbook's wire format
// doesn't match. We pin a structural type here so callers stay type-safe while
// the boundary into viem stays one cast.
type RawTypedData = {
  domain: TypedDataDomain;
  types: Record<string, ReadonlyArray<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
};

export function hashOrderTypedData(
  domain: TypedDataDomain,
  message: EipOrderMessage
): `0x${string}` {
  const args: RawTypedData = {
    domain,
    types: { Order: ORDER_TYPE_FIELDS },
    primaryType: ORDER_PRIMARY_TYPE,
    message: { ...message },
  };
  return hashTypedData(args as Parameters<typeof hashTypedData>[0]);
}

/** Deterministic JSON.stringify with sorted keys, matching CoW's appData expectations. */
export function stringifyDeterministic(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stringifyDeterministic(v)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys
    .map(
      (k) => `${JSON.stringify(k)}:${stringifyDeterministic((value as Record<string, unknown>)[k])}`
    )
    .join(',')}}`;
}

export function appDataHash(appDataContent: string): `0x${string}` {
  return keccak256(toBytes(appDataContent));
}
