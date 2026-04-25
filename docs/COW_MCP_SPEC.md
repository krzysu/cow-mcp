# cow-mcp — Spec

MCP (Model Context Protocol) server exposing CoW Protocol to AI agents. Lets an
agent fetch quotes, inspect orders, browse a wallet's trade history, and (in
v0.2) build, sign, and submit orders without holding private keys.

This document is the source of truth to bootstrap a new repository. v0.1 is
read-only and can ship in isolation. v0.2 layers in the sign/submit flow.

---

## Goals

- First-class MCP server for CoW Protocol — there is no existing one.
- Agent-friendly: small, typed tool surface; good docstrings; cheap re-reads
  via resources.
- Safe by construction: server never holds private keys.
- Multi-chain from day one: Ethereum, Gnosis, Arbitrum, Base, Sepolia.

## Non-goals

- Custodial signing or key management.
- Replacing the CoW Swap UI.
- Solver / settlement infrastructure.
- TWAP / Programmatic Orders / hooks (deferred past v0.2).

---

## v0.1 — Read-only

Ship a useful, low-risk surface first. No mutations, no signatures, no wallet
state on the server.

### Tools

All tools accept `chainId` (default: 1). Token addresses are checksummed
0x-strings; `"native"` is accepted as an alias for the chain's native asset
where applicable.

#### `cow_get_quote`

Fetch an indicative quote.

```ts
input: {
  chainId: number;
  sellToken: string;       // 0x address
  buyToken: string;        // 0x address
  kind: "sell" | "buy";
  amount: string;          // base units, decimal string
  from?: string;           // optional, improves quote accuracy
  receiver?: string;
  validFor?: number;       // seconds; default 1800
}
output: {
  sellAmount: string;
  buyAmount: string;
  feeAmount: string;
  validTo: number;
  priceImpactBps?: number;
  quoteId?: number;        // pass-through to v0.2 build_order
}
```

#### `cow_get_order`

Look up an order by uid.

```ts
input:  { chainId: number; uid: string }
output: {
  uid: string;
  owner: string;
  status: "open" | "fulfilled" | "cancelled" | "expired" | "unknown";
  sellToken: string; buyToken: string;
  sellTokenSymbol?: string; sellTokenDecimals?: number;  // best-effort, see below
  buyTokenSymbol?: string;  buyTokenDecimals?: number;
  sellAmount: string; buyAmount: string;
  executedSellAmount: string; executedBuyAmount: string;
  validTo: number; creationDate: string;
  txHash?: string;         // settlement tx, if filled
  solver?: string;
}
```

#### `cow_get_trades`

Recent trades for an owner.

```ts
input:  { chainId: number; owner: string; limit?: number /* default 25, max 100 */ }
output: Array<{
  orderUid: string;
  blockNumber: number; logIndex: number;
  sellToken: string; buyToken: string;
  sellTokenSymbol?: string; sellTokenDecimals?: number;  // best-effort, see below
  buyTokenSymbol?: string;  buyTokenDecimals?: number;
  sellAmount: string; buyAmount: string;
  txHash: string;
}>
```

#### `cow_list_tokens`

Supported tokens for a chain.

```ts
input:  { chainId: number; search?: string }
output: Array<{ address: string; symbol: string; name: string; decimals: number; logoURI?: string }>
```

### Token metadata resolution

`cow_get_order` and `cow_get_trades` enrich each `sellToken`/`buyToken` address
with `{symbol, decimals}` when possible. Resolution is best-effort and tiered:

1. **Native sentinel** — `0xeeee…eeee` is the orderbook's stand-in for the
   chain's native asset on the buy side. Resolved against the chain's
   `nativeSymbol` (ETH, xDAI, AVAX, …) with `decimals: 18`. All EVM-native
   assets we support are 18-decimal.
2. **Curated CoW token list** — `https://files.cow.fi/tokens/CowSwap.json`,
   fetched once per process and cached for 10 minutes. Indexed by
   `(chainId, lowercased address)` for O(1) lookup. Covers majors (WETH,
   USDC, DAI, COW, …) across all chains the list spans.
3. **On-chain ERC-20 fallback** — _not implemented in v0.1; see Open questions._
   For addresses missing from the curated list (long-tail tokens, recent
   listings, airdrops), batch `symbol()`/`decimals()` via Multicall3 with
   `allowFailure: true`. Required to make outputs like vitalik.eth's
   airdrop-dump trades fully readable. Adds `viem` as a dep, uses chain
   defaults for RPC with `COW_RPC_URL_<CHAIN_ID>` overrides, and caches
   results (positive + negative) for the lifetime of the process.

When resolution fails, the `*Symbol` / `*Decimals` fields are simply omitted
— callers always get the raw `*Token` address as a stable fallback.

### Errors

Map upstream errors to `McpError` codes:

- `404 NotFound` from orderbook → `InvalidRequest` ("order not found").
- `400 InvalidQuote` → `InvalidRequest` with the orderbook reason verbatim.
- `5xx` / network → `InternalError`, retried once with 250ms backoff.

---

## v0.2 — Sign & submit

Adds the write path while keeping keys out of the server. The agent / host's
wallet signs; the server only carries unsigned payloads in and signed payloads
out.

### Flow

```
agent → cow_get_quote          (v0.1)
agent → cow_build_order        → returns { typedData, orderDigest, quoteId }
host wallet signs typedData (EIP-712, externally to the MCP server)
agent → cow_submit_order(signedOrder) → returns { uid }
agent → cow_get_order(uid)     (v0.1, polled)
agent → cow_cancel_order(uid)  → returns { typedData } for off-chain cancel
host wallet signs cancel
agent → cow_submit_cancellation(signedCancel)
```

### New tools

#### `cow_build_order`

Convert a quote (or raw params) into an EIP-712 payload ready to sign. Bakes
in `appData` hash, sets `validTo`, and applies sane slippage defaults.

```ts
input: {
  chainId: number;
  quoteId?: number;                // preferred; carry-over from get_quote
  // OR raw params:
  sellToken?: string; buyToken?: string;
  sellAmount?: string; buyAmount?: string;
  kind?: "sell" | "buy";
  from: string;                    // signer address (required)
  receiver?: string;
  slippageBps?: number;             // default 50 (0.5%)
  validFor?: number;                // seconds, default 1800
  appData?: object;                 // optional override; otherwise default
  partiallyFillable?: boolean;
}
output: {
  typedData: {                      // EIP-712, ready for eth_signTypedData_v4
    domain: object; types: object; message: object; primaryType: "Order";
  };
  orderDigest: string;              // 0x-keccak of typed data
  appDataHash: string;
  expectedBuyAmount: string;        // useful UX for the agent
}
```

#### `cow_submit_order`

Post a signed order to the orderbook.

```ts
input: {
  chainId: number;
  order: SignedOrder; // shape per cow-sdk
  signature: string; // 0x...
  signingScheme: 'eip712' | 'ethsign' | 'presign' | 'eip1271';
}
output: {
  uid: string;
}
```

#### `cow_cancel_order`

Build an off-chain cancellation payload.

```ts
input: {
  chainId: number;
  uid: string;
  from: string;
}
output: {
  typedData: object;
} // signed by host wallet
```

#### `cow_submit_cancellation`

```ts
input: {
  chainId: number;
  uid: string;
  signature: string;
}
output: {
  ok: true;
}
```

### New helper tools

These are read-only but specifically support the write flow:

- `cow_check_approval(chainId, owner, sellToken)` → `{ approved: boolean, allowance: string, spender: string }` for the GPv2 vault relayer.
- `cow_build_approval_tx(chainId, sellToken, amount?)` → `{ to, data, value }` calldata the host wallet can submit on-chain. Server does not broadcast.
- `cow_native_price(chainId, token)` → reference price, helps agents reason about slippage.

### Wallet boundary — explicit

The MCP server:

- Never receives, stores, or logs private keys, mnemonics, or signed
  transaction broadcasts.
- Never calls `eth_sendRawTransaction` or any RPC method that mutates state.
- Returns typed-data payloads as plain JSON for the host's wallet integration
  to handle.

These are testable invariants — add a unit test asserting no `signTypedData`,
`sendTransaction`, or `privateKey` references in `src/`.

### Signer integration

cow-mcp does not sign. Signing is delegated to a separate process that the
host configures. The boundary between cow-mcp and that process is defined as
viem's [`Account`](https://viem.sh/docs/accounts/local) interface — anything
that produces an `Account` works without custom adapters.

Concretely, the agent's tool chain is:

```
cow_build_order            (cow-mcp)
  → wallet_sign_typed_data (signer process — separate MCP server or RPC)
  → cow_submit_order       (cow-mcp)
```

The signer process is out of scope for this repo, but the supported backends
are documented and exercised in the v0.2 demo:

- **LocalAccount** — `privateKeyToAccount` / `mnemonicToAccount` /
  `hdKeyToAccount` reading from an encrypted keystore. Right default for
  headless dev and CI.
- **JsonRpcAccount over EIP-1193** — any wallet exposing a local or remote
  JSON-RPC endpoint that handles `eth_signTypedData_v4`. Browser extensions
  bridged via WalletConnect/Reown also fit here.
- **SmartAccount** — Safe and other 4337 accounts via permissionless.js.
  Pairs with `signingScheme: "presign" | "eip1271"` on `cow_submit_order`.
- **Embedded / MPC providers** — Privy, Turnkey, Coinbase CDP, Dynamic, etc.
  All ship viem-compatible `Account` adapters; credentials live in the host's
  signer process, never in cow-mcp.

Reference signer: ship a minimal `cow-mcp-signer` companion (separate package)
that wraps a viem `Account` and exposes `wallet_sign_typed_data` over MCP. The
v0.2 README demo uses it with a LocalAccount + keystore so the end-to-end
flow runs with one extra `npx` command and no external wallet install.

Non-goal: cow-mcp will not bundle a signer, embed AgentKit-style action
providers, or accept a private key via env var. Users who want a different
signer (their own MCP, a custom CLI, a hosted signer) only need to satisfy
the same `wallet_sign_typed_data` contract over MCP, or hand the signature
back to the agent through any other channel before calling
`cow_submit_order`.

### `appData` handling

- Default appData includes a `cow-mcp` referrer tag and the agent-supplied
  `slippageBps`.
- Optional IPFS pinning via Pinata / web3.storage if `COW_APPDATA_PIN_URL`
  is set; otherwise the appData JSON is sent inline (orderbook supports both).

### Configuration additions

- `COW_REFERRER_APP_CODE` — referrer string baked into appData (default
  `cow-mcp`).
- `COW_APPDATA_PIN_URL` + `COW_APPDATA_PIN_TOKEN` — optional IPFS pinning.
- `COW_DEFAULT_SLIPPAGE_BPS` — default 50.

### Acceptance criteria for v0.2

1. End-to-end demo on Sepolia: agent quotes → builds → host wallet signs →
   submits → polls until fulfilled. Recorded in README.
2. Cancel flow works on a real open order.
3. Approval helper correctly identifies un-approved tokens and produces
   calldata that, when broadcast externally, makes a subsequent
   `cow_submit_order` succeed.
4. No-keys invariant test passes.
5. Backwards compatible: all v0.1 tools and resources unchanged.

---

## Skills (paired with v0.2)

Skills are agent-side prompt recipes that compose cow-mcp tools into a
workflow. They live alongside the server (e.g. shipped as a separate
package or referenced in README) and are loaded by the host (Claude Code,
Claude Desktop, etc.) — cow-mcp itself remains a pure tool/resource provider.

### Why skills (and when not)

A skill is justified when it bundles **multi-step coordination, decision
gates, or formatting** that an agent shouldn't have to re-invent each
session. A skill is **not** justified when it just paraphrases a tool that
already has a clear schema and good docstring — those add prompt overhead
without changing agent behavior.

Heuristic: if the recipe is "call tool X with these args," skip the skill.
If it's "call X, decide based on result, maybe call Y, summarize for the
user," write the skill.

### v0.1 skill posture

None. The five read-only tools are self-describing; the README's demo
prompt already shows agents chain them correctly. Adding skills here would
be premature.

### v0.2 skill candidates

These pay off once `cow_build_order` / `cow_submit_order` exist, because
the multi-step + safety-gate shape is genuine.

- **`cow-swap`** — natural-language swap intent → resolve symbols →
  `cow_get_quote` → `cow_check_approval` (and surface approval calldata if
  needed) → `cow_build_order` → handoff to signer → `cow_submit_order` →
  poll `cow_get_order` until fulfilled. Owns slippage prompting, fee
  display, and the "are you sure" gate before the signer call.
- **`cow-portfolio`** — given a wallet, fan out `cow_get_trades` across
  the supported chains, group by token pair, summarize volume / realized
  PnL, optionally cross-reference `cow_native_price`. Read-only, but the
  cross-chain + aggregation logic is non-trivial to re-derive each turn.
- **`cow-order-watch`** — re-poll `cow_get_order` for one or more order
  uids and produce status-transition reports (`open → fulfilled`,
  `→ expired`, partial fills). Useful for long-running agent sessions
  babysitting open orders.

### What stays in a tool vs. a skill

| Lives in tool                              | Lives in skill                           |
| ------------------------------------------ | ---------------------------------------- |
| Single API call, deterministic output      | Multi-call workflow with branching       |
| Schema-validated input/output              | Natural-language input → structured args |
| Reusable across any agent prompt           | Tied to a specific user-facing intent    |
| Stable contract, versioned with the server | Iterates faster, can ship out-of-band    |

### Non-goals

- Skills that wrap a single tool 1:1 (e.g. "find a token" → just call
  `cow_list_tokens`).
- Skills that smuggle in signing logic. The wallet boundary from the v0.2
  invariants applies — skills coordinate, they do not sign.
- Bundling skills into the cow-mcp package itself. Skills are a separate
  artifact; the server stays narrow.

---

## Out of scope (revisit post-v0.2)

- Limit orders + TWAP via Composable CoW (`cow_build_twap`, etc.).
- Pre/post hooks.
- Solver competition / surplus analytics tools.
- Streaming order watch (push notifications when status changes).
- Web transport (HTTP/SSE) — stdio is sufficient for desktop hosts initially.

## Open questions

- Should `cow_get_trades` paginate, or cap at 100 and tell the agent to
  filter? Lean: cap, no pagination in v0.1.
- **On-chain ERC-20 metadata fallback** — see "Token metadata resolution"
  above. Real-world testing (vitalik.eth's airdrop dumps) shows the curated
  list misses ~90% of long-tail tokens. cow-vibe solves this with
  viem + Multicall3 against default per-chain RPCs. Bringing it in adds:
  (a) `viem` as a runtime dep, (b) per-chain RPC selection (viem's bundled
  defaults cover all our chains except Plasma 9745, which would need
  `COW_RPC_URL_9745` set to opt in), (c) a session-lifetime cache for
  resolved metadata (immutable on-chain, so no TTL needed). Decision:
  defer past v0.1 ship, then revisit with feedback from a few more
  testers.
- Trade timestamps — block timestamps aren't returned by the orderbook;
  options are (a) one extra `getOrder(uid)` per trade for `creationDate`
  (N+1 fan-out), (b) `eth_getBlockByNumber` per unique block via the
  same multicall RPC introduced above, (c) leave as a known gap. (b) is
  the right answer once the on-chain layer exists; (c) until then.
- Multicall for batched balance/allowance reads in `cow_check_approval` —
  needed only if we add a "portfolio" tool later. Note: if the on-chain
  metadata fallback above lands, the multicall infrastructure is already
  there.
