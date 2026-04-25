# cow-mcp

MCP (Model Context Protocol) server exposing [CoW Protocol](https://cow.fi) to AI agents. Lets an agent fetch quotes, build and submit orders, cancel them, and browse a wallet's trade history.

**The server never holds private keys.** It returns EIP-712 typed-data payloads for the host wallet to sign; the agent submits the signed result back through `cow_submit_order` / `cow_submit_cancellation`.

## Tools

### Read

| Tool | Purpose |
| --- | --- |
| `cow_get_quote` | Indicative price + fee for a swap |
| `cow_get_order` | Look up an order by uid (status, executed amounts, tx) |
| `cow_get_trades` | Recent trades for a wallet (paginated: `limit` ≤ 100, `offset` for older pages) |
| `cow_list_chains` | All chains CoW supports (id, name, native symbol) |
| `cow_list_tokens` | Supported tokens for a chain, optional symbol/name search |

### Write (signed externally)

| Tool | Purpose |
| --- | --- |
| `cow_build_order` | Turn quote + slippage into an EIP-712 payload to sign |
| `cow_submit_order` | POST a signed order to the orderbook → returns `uid` |
| `cow_build_cancellation` | EIP-712 payload to cancel an open order off-chain |
| `cow_submit_cancellation` | POST the signed cancellation |
| `cow_check_approval` | Read on-chain `allowance(owner, vaultRelayer)` for a sell token |
| `cow_build_approval` | Encode `approve()` calldata for the GPv2 vault relayer (host sends it) |

## Swap flow

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
```

Cancel works the same way: `cow_build_cancellation(uid)` → host signs → `cow_submit_cancellation`.

> **`appData` round-trip:** `cow_build_order` returns `appData` as an inline JSON string. Pass that **exact** string back to `cow_submit_order` — re-serializing it (even with the same keys) changes the keccak-256 hash and the orderbook will reject the signature.

## Cross-chain

This MCP wraps CoW's **single-chain** orderbook only — both legs of an order must be on the same chain. CoW Protocol itself supports cross-chain swaps via `@cowprotocol/sdk-bridging` (Across, Bungee, Near Intents), but that surface isn't exposed here yet.

Every tool takes a `chainId` parameter, so an agent can quote on Ethereum, pull trades from Arbitrum, and list tokens on Base in the same session. `chainId` defaults to `1` (Ethereum) when omitted.

Supported chains (all CoW Protocol chains, sourced from `@cowprotocol/cow-sdk` so they stay in sync): Ethereum, BNB Chain, Gnosis, Polygon, Base, Plasma, Arbitrum One, Avalanche, Ink, Linea, Sepolia. Use `cow_list_chains` to enumerate at runtime.

### Symbol resolution

`cow_get_quote` and `cow_build_order` accept either a `0x` address or a token symbol (e.g. `"WETH"`, `"USDC"`) for `sellToken` / `buyToken`. Symbols are resolved against per-chain CoW-hosted token lists (CoinGecko + Uniswap mirrors at `files.cow.fi/token-lists/<src>.<chainId>.json`, cached 10 min per chain). Unknown symbols return a hint to call `cow_list_tokens`; ambiguous symbols return all candidate addresses so the agent can disambiguate.

## Known limitations

- **No trade timestamps.** The orderbook `/trades` endpoint doesn't return a date field, only `blockNumber` / `logIndex`. If you need a timestamp, call `cow_get_order(uid)` per trade — `creationDate` lives on the order, not the trade.
- **`cow_check_approval` is the one on-chain read.** Allowance has no off-chain mirror in the orderbook API, so this single tool talks to an RPC. Everything else is a thin wrapper around CoW's HTTP API.

## Wallet boundary

cow-mcp does not sign and does not broadcast transactions. The agent is responsible for getting `typedData` (from `cow_build_order` / `cow_build_cancellation`) signed by the host wallet, and for getting approval calldata (from `cow_build_approval`) submitted on-chain.

This keeps cow-mcp compatible with any wallet integration: a local keystore via [viem accounts](https://viem.sh/docs/accounts/local), an EIP-1193 provider over WalletConnect, a Safe / 4337 smart account (with `signingScheme: "eip1271"`), or an embedded MPC provider (Privy, Turnkey, …). The signing process is out of scope for this repo.

A static unit test (`test/no_keys.test.ts`) enforces that `src/` contains no `signTypedData`, `sendTransaction`, or `privateKey*` references.

## Configure

cow-mcp is a stdio MCP server, so any MCP-compatible client works (Claude Code, Claude Desktop, Cursor, Cline, Continue, …). Requires Node 20+ on the host machine.

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `COW_RPC_URL_<CHAIN_ID>` | tries the chain's `*.publicnode.com` endpoint first, falls back to viem's bundled chain RPC | Pin a single per-chain RPC for `cow_check_approval`'s `allowance()` read. Set this if you see `cow_check_approval` time out or want to use a private/paid endpoint. Example: `COW_RPC_URL_8453=https://mainnet.base.org` |

### Claude Code

```bash
claude mcp add cow npx -y cow-mcp
```

Or commit a project-level `.mcp.json`:

```json
{
  "mcpServers": {
    "cow": {
      "command": "npx",
      "args": ["-y", "cow-mcp"]
    }
  }
}
```

### Other clients

Any client that speaks stdio MCP can launch `npx -y cow-mcp` directly — refer to its docs for the exact config file shape.

## Demo prompts

One prompt per use case — keep them tight, the agent chains tools on its own.

| Use case                   | Prompt                                                            |
| -------------------------- | ----------------------------------------------------------------- |
| Quote a swap               | "Quote 1 WETH for USDC on Arbitrum."                              |
| Inspect an order           | "What's the status of order `0xabc…`?"                            |
| Wallet trade history       | "Show me vitalik.eth's last 10 CoW trades on mainnet."            |
| Find a token               | "Is there a COW token on Gnosis? Give me the address."            |
| Place a swap (with signer) | "Sell 0.1 WETH for USDC on Sepolia from `0x…`. Default slippage." |
| Cancel an open order       | "Cancel order `0xabc…`."                                          |
| Check approval             | "Have I approved USDC for CoW on Base, owner `0x…`?"              |

## Skills

`skills/cow-swap/SKILL.md` ships a recipe for the full natural-language → swap flow: parse intent, quote, confirmation gate, approval gate, build, route signing (to a signer MCP tool if available, otherwise manual paste-back), submit, poll. Load it into your host (Claude Code, Claude Desktop, …) per its docs.

## Development

Local clone for hacking on cow-mcp itself:

```bash
pnpm install
pnpm dev          # run via tsx (stdio)
pnpm test         # vitest
pnpm check        # typecheck + prettier + eslint + tests
pnpm fix          # prettier --write + eslint --fix
pnpm build        # compile to dist/
```

To point an MCP client at a local checkout instead of the published package, swap `npx -y cow-mcp` for `node /absolute/path/to/cow-mcp/dist/index.js` in the config above.

## License

MIT
