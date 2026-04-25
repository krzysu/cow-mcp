---
name: cow-swap
description: Walks a user through a CoW Protocol swap end-to-end — quote, approval, build, sign, submit, poll. Use this when the user expresses a swap intent in natural language ("swap 0.1 ETH for USDC", "sell my COW for DAI"). Coordinates the cow-mcp tools and routes the EIP-712 signing step to whatever signer the host has available.
---

# cow-swap

You are placing a CoW Protocol swap on behalf of the user. cow-mcp gives you the read/build/submit tools, but **never signs**. Your job is to drive the multi-step flow, decide when each tool fires, and route the signing step to the right place.

## High-level flow

```
1. Parse intent     → chainId, sellToken, buyToken, kind, amount, from
2. Quote            → cow_get_quote
3. Confirm          → show price, fee, slippage; get user OK
4. Approval gate    → cow_check_approval; if needed, cow_build_approval and wait for on-chain confirm
5. Build order      → cow_build_order  (returns typedData)
6. Sign             → route to signer (see below)
7. Submit           → cow_submit_order  (returns uid)
8. Check status     → cow_get_order until fulfilled / expired / cancelled
```

Each numbered step has a decision gate — don't skip ahead. The user can change their mind at any step; if they do, restart from the relevant step rather than resuming a stale state.

## Step 1 — parse intent

Resolve every required field before calling any tool. **All six must be set before step 2** — if any is missing, ask the user; do not guess.

- `chainId` — default to 1 (Ethereum). If the user says a chain by name ("on Arbitrum"), map it; if unsure, call `cow_list_chains` and ask.
- `sellToken` / `buyToken` — accept symbols (`WETH`, `USDC`) or `0x` addresses. cow-mcp resolves symbols per chain. If the user wants to **sell native ETH** (no WETH on hand), this skill does not support it — CoW Eth Flow handles that path by atomically wrapping + ordering, but cow-mcp doesn't expose Eth Flow yet. Either ask the user to wrap to WETH first, or decline. Buying native ETH is fine — just pass the sentinel `0xeeee…eeee` (or omit a `buyToken` symbol; the orderbook auto-resolves).
- `kind` — `"sell"` (lock in sellAmount, accept variable buyAmount) or `"buy"` (lock in buyAmount, accept variable sellAmount). Phrase like "swap X for Y" → sell; "buy X paying Y" → buy.
- `amount` — base units, decimal string. Convert from human input using token decimals (`cow_list_tokens` if you don't already know).
- `from` — the signer / order owner address. **Required** for build and submit. If missing, ask the user.

## Step 2 — quote

Call `cow_get_quote` with the parsed inputs. Pass `from` if known — it improves quote precision and avoids surprises at submit. Capture `quoteId`, `sellAmount`, `buyAmount`, and `feeAmount`.

Note that `cow_get_quote` returns `sellAmount` **net of fee** and `feeAmount` separately. For `kind: sell`, pass `sellAmount + feeAmount` (the gross) into `cow_build_order` so the user actually sells the amount they intended; for `kind: buy`, pass `sellAmount` as-is (fee is already baked into the limit price).

## Step 3 — confirm with user

Before any state change, show the user:

- The pair and amounts, in human units (apply decimals).
- The implied price.
- The fee (in sell-token units).
- The slippage you intend to use (50 bps / 0.5% by default; bump for volatile pairs or thin liquidity, ask the user if uncertain).
- The validity (`validFor`, default 10 min, max 24h). Pick the shortest window the user's flow tolerates — long-dated orders leak intent to MEV searchers.

Ask "proceed?" before continuing. If the user wants tighter / looser slippage, adjust and rebuild (jump to step 5) without re-quoting — slippage is applied in `cow_build_order`, not in the quote. If they take a long time deliberating and the quote's `validTo` is close to expiring, re-quote from step 2.

## Step 4 — approval gate

Call `cow_check_approval(chainId, owner=from, sellToken)`.

- If `approved: true` → skip to step 5.
- If `approved: false` → call `cow_build_approval(chainId, sellToken)` and present the resulting `{to, data, value}` to the user. They (or their wallet) must broadcast it on-chain. Submitting an order without allowance fails with `InsufficientAllowance`, so don't proceed until allowance is in place.

`cow_check_approval` is the only on-chain RPC read in this flow and it can be slow on busy public endpoints. Prefer waiting for the user to confirm the approve tx landed over tight repolling — a single re-check after they say "done" is enough. If `cow_check_approval` times out, retry once; if it times out again, ask the user to confirm rather than blocking the flow.

If the host has a tool for sending transactions (e.g. an `eth_sendTransaction`-style MCP), offer to use it. Otherwise hand them the calldata and pause.

## Step 5 — build the order

Call `cow_build_order` with `from`, the quoted amounts, kind, and slippage. `receiver` defaults to `from`; pass it explicitly only when proceeds should land in a different address. Capture:

- `typedData` — the EIP-712 payload to sign.
- `appData` — the inline JSON string. **You must pass this exact string to `cow_submit_order`** along with the signature.
- `orderDigest` — show this to the user for verification if they care.
- `expectedSellAmount` / `expectedBuyAmount` — the slippage-adjusted limits.

## Step 6 — sign

cow-mcp does not sign. Call whatever signer the host exposes — a `wallet_sign_typed_data`-style tool, or any host wallet integration that accepts EIP-712 typed data. Pass the `typedData` from step 5; you get back a `signature`. If the signer reports a `signingScheme`, forward it; otherwise default to `"eip712"`.

If no signer tool is available, fall back to manual paste-back: show the user the `typedData` JSON, ask them to sign with their wallet (`eth_signTypedData_v4` in MetaMask, Frame, etc.) and paste back a `0x...` hex string.

**Never** ask for the user's private key, mnemonic, or seed phrase.

## Step 7 — submit

Call `cow_submit_order` with:

- `order` — the **exact fields** from `typedData.message`, plus `from` and (optionally) `quoteId`. Note: `typedData.message.appData` is a `bytes32` hash and stays exactly as it is inside the `order` object.
- `signature` — from step 6.
- `signingScheme` — match what the signer used.
- `appData` — the **JSON string** from step 5's response (a top-level parameter, not nested in `order`). This is a different value with the same name as the `bytes32` field above; the orderbook hashes this string and verifies it matches `order.appData`. Don't confuse the two and don't re-stringify — pass the JSON string verbatim.

You get back `{ uid }`. Show the uid to the user with a CoW Explorer link, picking the URL by chain:

- Mainnet: `https://explorer.cow.fi/orders/<uid>`
- Other chains: `https://explorer.cow.fi/<network>/orders/<uid>` — `<network>` is the explorer's `urlAlias`, not the chain's `name`. Use `gc` (Gnosis), `arb1` (Arbitrum One), `base`, `sepolia`, `bnb`, `pol` (Polygon), `avax` (Avalanche), `linea`. (When in doubt, link the mainnet form and mention the order is on chain X.)

## Step 8 — check status

Call `cow_get_order(uid)` to report status. Agents don't sleep — call it once after submit, and again only when the user asks or on the next turn. Don't loop tightly.

- `open` → still waiting for a solver.
- `fulfilled` → done; report `executedSellAmount` / `executedBuyAmount` and `txHash`.
- `cancelled` / `expired` → terminal; explain.

## Cancel flow

Same shape as the swap flow, just three tools:

1. `cow_build_cancellation(uid)` → `typedData`.
2. Sign it (same routing as step 6).
3. `cow_submit_cancellation(uid, signature)` → `{ ok: true }`.

Cancellations are off-chain and free. They only work on `open` orders — confirm status with `cow_get_order` first.

## Common errors and their fix

When `cow_submit_order` (or any other write) fails, surface the error verbatim and apply the typical fix:

- **`InvalidSignature`** — chainId or domain mismatch in the signer. Confirm the signer used the same `chainId` as `cow_build_order`, and that it signed `typedData` (not just `orderDigest`). Re-sign and resubmit.
- **`InsufficientFee`** — quote expired between build and submit. Re-quote (step 2) and rebuild (step 5).
- **`InsufficientAllowance`** — approve tx didn't land before submission. Re-run step 4; if `cow_check_approval` still says `false`, ask the user to confirm the approve tx hash on a block explorer.
- **`QuoteNotFound`** — `quoteId` is stale or for a different chain. Re-quote and resubmit. (`quoteId` is optional; dropping it avoids this class of error at the cost of orderbook analytics.)

## What this skill does not do

- It does not sign. It always routes signing externally.
- It does not broadcast on-chain transactions. Approval calldata gets handed to the user / their wallet.
- It does not pick the chain or token amounts for the user without confirmation.
- It does not retry failed submissions silently — see the error table above.
- It does not handle **partial fills**. `cow_build_order` defaults `partiallyFillable: false`; if a user wants TWAP / DCA / "sell N over a day" semantics, that's CoW's `ComposableCoW` / programmatic-orders surface, which cow-mcp does not expose. Decline these and explain.
- It does not handle **limit orders** (open-ended price targets without a fresh quote) or **native-ETH sells** (Eth Flow). These are CoW features, just not wired into cow-mcp yet.
