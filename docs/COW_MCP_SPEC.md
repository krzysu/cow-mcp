# cow-mcp — Spec

MCP (Model Context Protocol) server exposing CoW Protocol to AI agents. Lets an agent fetch quotes, inspect orders, browse a wallet's trade history, and build/sign/submit orders without holding private keys.

## Goals

- First-class MCP server for CoW Protocol — there is no existing one.
- Agent-friendly: small, typed tool surface; good docstrings.
- Safe by construction: server never holds private keys.
- Multi-chain from day one: every CoW-supported chain (Ethereum, Gnosis, Arbitrum, Base, Sepolia, …) is exposed by `chainId`.

## Non-goals

- Custodial signing or key management.
- Replacing the CoW Swap UI.
- Solver / settlement infrastructure.
- TWAP / Programmatic Orders / hooks.
- IPFS appData pinning (orderbook accepts inline JSON).

---

## Read tools

All tools accept `chainId` (default: 1). Token addresses are checksummed 0x-strings; `"native"` is accepted as an alias for the chain's native asset where applicable.

### `cow_get_quote`

Fetch an indicative quote.

```ts
input: {
  chainId: number;
  sellToken: string;       // 0x address or symbol
  buyToken: string;        // 0x address or symbol
  kind: "sell" | "buy";
  amount: string;          // base units, decimal string
  from?: string;
  receiver?: string;
  validFor?: number;       // seconds; default 1800
}
output: {
  sellAmount: string;
  buyAmount: string;
  feeAmount: string;
  validTo: number;
  quoteId?: number;        // pass-through to cow_build_order
  expiration: string;
  verified: boolean;
}
```

### `cow_get_order`

Look up an order by uid. Returns full state — status, executed amounts, settlement tx if filled. Token addresses are enriched best-effort with `{symbol, decimals}` from per-chain CoW-hosted lists (CoinGecko + Uniswap mirrors), with on-chain ERC-20 fallback via Multicall3.

### `cow_get_trades`

Recent trades for an owner. Cap at 100, default 25. Same token enrichment as `cow_get_order`, plus best-effort `blockTimestamp` (ISO) per trade. The whole enrichment pass is wrapped in a 3 s timeout — if the public RPC is slow, trades are returned without enrichment and the agent can call `cow_resolve_token` for the addresses it actually needs.

### `cow_list_chains`

Every chain CoW Protocol supports, sourced from `@cowprotocol/cow-sdk` so the list stays in sync upstream.

### `cow_list_tokens`

Per-chain token list, sourced from CoW's CoinGecko + Uniswap mirrors and filtered by optional symbol/name/address search.

### `cow_resolve_token`

On-demand `{symbol, decimals}` lookup for one or more token addresses on a chain. Use this when `cow_get_trades` returned addresses without enriched metadata (slow RPC) and the agent only needs metadata for a couple of addresses — much faster than re-fetching the trade list.

### Token metadata resolution

`cow_get_order`, `cow_get_trades`, and `cow_resolve_token` enrich each token address with `{symbol, decimals}`:

1. **Native sentinel** — `0xeeee…eeee` resolves to the chain's native asset (ETH, xDAI, …) with `decimals: 18`.
2. **Per-chain CoW token lists** — `https://files.cow.fi/token-lists/CoinGecko.<chainId>.json` first (broadest, ~500 tokens on majors), then `Uniswap.<chainId>.json`. Cached 10 min per chain. Covers WETH/USDC/USDT/DAI/COW on every L2 CoW trades on (Mainnet, Arbitrum, Base, Polygon, BNB, Avalanche, Gnosis, Linea, …).
3. **On-chain ERC-20** — `symbol()` + `decimals()` via Multicall3, cached for the lifetime of the process. Uses viem's bundled per-chain RPCs with JSON-RPC batching enabled; override the URL with `COW_RPC_URL_<CHAIN_ID>`.

When all three fail, the `*Symbol` / `*Decimals` fields are simply omitted — callers always get the raw address as a stable fallback.

---

## Write tools (signed externally)

The agent / host's wallet signs; the server only carries unsigned payloads in and signed payloads out.

### Flow

```
agent → cow_get_quote                    → { sellAmount, buyAmount, quoteId }
agent → cow_check_approval               → { approved, allowance, spender }
  (if not approved)
  agent → cow_build_approval             → { to, data, value }
  host wallet broadcasts the approve tx on-chain
agent → cow_build_order(from, slippage)  → { typedData, orderDigest, appData }
host wallet signs typedData (EIP-712, externally to the MCP server)
agent → cow_submit_order(order, signature, appData) → { uid }
agent → cow_get_order(uid)               → polled until fulfilled
agent → cow_build_cancellation(uid)      → { typedData }
host wallet signs cancel
agent → cow_submit_cancellation(signedCancel)
```

### `cow_build_order`

Convert quote params into an EIP-712 payload ready to sign. Bakes in `appData` hash, sets `validTo`, applies slippage to the amounts.

```ts
input: {
  chainId: number;
  sellToken: string; buyToken: string;     // 0x address or symbol
  sellAmount: string; buyAmount: string;   // from cow_get_quote
  kind: "sell" | "buy";
  from: string;                            // signer address (required)
  receiver?: string;
  slippageBps?: number;                    // default COW_DEFAULT_SLIPPAGE_BPS or 50
  validFor?: number;                       // seconds, default 1800
  partiallyFillable?: boolean;
  quoteId?: number;                        // pass-through for orderbook analytics
}
output: {
  typedData: { domain, types, primaryType: "Order", message };  // EIP-712, ready for eth_signTypedData_v4
  orderDigest: string;
  appDataHash: string;
  appData: string;                         // inline JSON to send with cow_submit_order
  expectedSellAmount: string;              // after slippage
  expectedBuyAmount: string;               // after slippage
  validTo: number;
  quoteId?: number;
}
```

Slippage application:

- **Sell orders**: `sellAmount` is locked, `buyAmount` is shrunk by `slippageBps`.
- **Buy orders**: `buyAmount` is locked, `sellAmount` is grown by `slippageBps`.

`feeAmount` in the EIP-712 message is always `0` — current CoW Protocol bakes the solver fee into the limit price (`sellAmount` already reflects it for sell orders, `buyAmount` for buy orders). The `feeAmount` field surfaced in `cow_get_quote` is informational only and is not re-applied at build time.

### `cow_submit_order`

Post a signed order to the orderbook.

```ts
input: {
  chainId: number;
  order: {                                 // exact fields from cow_build_order
    sellToken; buyToken; receiver?; sellAmount; buyAmount;
    validTo; feeAmount; kind; partiallyFillable;
    sellTokenBalance; buyTokenBalance; from; quoteId?;
  };
  signature: string;                       // 0x...
  signingScheme: "eip712" | "ethsign" | "presign" | "eip1271";
  appData: string;                         // inline JSON from cow_build_order
  appDataHash?: string;
}
output: { uid: string }
```

### `cow_build_cancellation`

Build an off-chain cancellation EIP-712 payload.

```ts
input:  { chainId: number; uid: string }
output: { typedData: {...}; cancellationDigest: string }
```

### `cow_submit_cancellation`

```ts
input: {
  chainId: number;
  uid: string;
  signature: string;
  signingScheme: 'eip712' | 'ethsign';
}
output: {
  ok: true;
}
```

### `cow_check_approval`

Read on-chain `allowance(owner, vaultRelayer)`.

```ts
input: {
  chainId: number;
  owner: string;
  sellToken: string;
}
output: {
  approved: boolean;
  allowance: string;
  spender: string;
}
```

`approved` is `true` when the allowance is at least `2^128` — a practical cutoff that treats every "infinite approve" pattern (`MAX_UINT256` and the common `2^96 - 1` / `2^128 - 1` variants) as approved while flagging tiny finite allowances as not approved. Agents that need exact-amount checks should compare `allowance` against the order's `sellAmount` themselves.

### `cow_build_approval`

Encode `approve(spender, amount)` calldata for the GPv2 vault relayer. Server does not broadcast.

```ts
input:  { chainId: number; sellToken: string; amount?: string }   // default unlimited
output: { to: string; data: string; value: "0"; spender: string; amount: string }
```

---

## Wallet boundary

The MCP server:

- Never receives, stores, or logs private keys, mnemonics, or signed transaction broadcasts.
- Never calls `eth_sendRawTransaction` or any RPC method that mutates state.
- Returns typed-data payloads as plain JSON for the host's wallet integration to handle.

Enforced by `test/no_keys.test.ts` — a static check that `src/` contains no `signTypedData`, `sendTransaction`, `privateKey*`, `mnemonic*`, or related references.

### Signer integration

cow-mcp does not sign. Signing is delegated to whatever the host configures — a separate signer MCP server, an EIP-1193 provider, a viem `Account`, etc. The contract is the EIP-712 typed data returned by `cow_build_order` / `cow_build_cancellation` and the calldata returned by `cow_build_approval`.

Supported wallet shapes (all out of scope for this repo, all compatible without custom adapters):

- **LocalAccount** — `privateKeyToAccount` / `mnemonicToAccount` / `hdKeyToAccount` reading from an encrypted keystore.
- **JsonRpcAccount over EIP-1193** — any wallet exposing `eth_signTypedData_v4`. Browser extensions bridged via WalletConnect/Reown fit here.
- **SmartAccount** — Safe and other 4337 accounts. Pairs with `signingScheme: "presign" | "eip1271"` on `cow_submit_order`.
- **Embedded / MPC providers** — Privy, Turnkey, Coinbase CDP, Dynamic, etc.

### Reference signer (planned)

A companion `cow-mcp-signer` package is planned as a minimal reference signer: a separate stdio MCP server that wraps a viem `Account` and exposes a single `wallet_sign_typed_data(typedData) → signature` tool. With both `cow-mcp` and `cow-mcp-signer` configured in the host, the agent can run the full swap flow (build → sign → submit) with no other wallet install:

```
agent → cow_build_order             (cow-mcp)
agent → wallet_sign_typed_data      (cow-mcp-signer)
agent → cow_submit_order            (cow-mcp)
```

The contract between the two is just the EIP-712 typed data — any signer that satisfies the same `wallet_sign_typed_data` shape (custom CLI, hosted signer, browser extension bridge, …) works as a drop-in replacement.

### `appData` handling

Inline JSON, sent with the order via `cow_submit_order`. Default content:

```json
{ "appCode": "cow-mcp", "metadata": { "quote": { "slippageBips": 50 } }, "version": "1.4.0" }
```

The keccak-256 hash of the deterministic JSON is what the EIP-712 order struct commits to. IPFS pinning is **not** supported — orderbook accepts the inline form natively.

## Configuration

| Variable                 | Default | Purpose                                   |
| ------------------------ | ------- | ----------------------------------------- |
| `COW_RPC_URL_<CHAIN_ID>` | viem    | Override per-chain RPC for on-chain reads |

Slippage is an agent-controlled parameter on `cow_build_order` (`slippageBps`, default 50). It is intentionally not configurable via env — different swaps within the same session legitimately want different slippage, and the agent is the right place to decide.

## Errors

Map upstream errors to `McpError` codes:

- `404 NotFound` from orderbook → `InvalidRequest` ("not found").
- `400` (e.g. `InvalidQuote`, `InsufficientAllowance`, signature mismatch) → `InvalidRequest` with the orderbook reason verbatim.
- `5xx` / network → `InternalError`, retried once with 250 ms backoff.

---

## Out of scope

- Limit orders + TWAP via Composable CoW.
- Pre/post hooks.
- Solver competition / surplus analytics tools.
- Streaming order watch (push notifications when status changes).
- Web transport (HTTP/SSE) — stdio is sufficient for desktop hosts.
- Reference price endpoint (agents can derive from `cow_get_quote`).
- IPFS appData pinning.
- Bundling a signer or accepting a private key via env var.
