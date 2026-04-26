# cow-mcp

MCP (Model Context Protocol) server exposing [CoW Protocol](https://cow.fi) to AI agents. Lets an agent fetch quotes, build and submit orders, cancel them, and browse a wallet's trade history.

**The server never holds private keys.** It returns EIP-712 typed-data payloads for the host wallet to sign; the agent submits the signed result back through `cow_submit_order` / `cow_submit_cancellation`.

## Install

### Hosted (HTTP)

Public deployment: `https://cow-mcp.netlify.app/mcp`. Works with any MCP client that speaks Streamable HTTP — claude.ai web, Claude Desktop, Claude Code, Cursor, ChatGPT, and others.

```bash
claude mcp add cow-mcp -s project --transport http https://cow-mcp.netlify.app/mcp
```

`.mcp.json`:

```json
{
  "mcpServers": {
    "cow-mcp": {
      "type": "http",
      "url": "https://cow-mcp.netlify.app/mcp"
    }
  }
}
```

### Local (stdio via `npx`)

Requires Node 20+.

```bash
claude mcp add cow-mcp -s project -- npx -y cow-mcp
```

`.mcp.json`:

```json
{
  "mcpServers": {
    "cow-mcp": {
      "command": "npx",
      "args": ["-y", "cow-mcp"]
    }
  }
}
```

Other clients: refer to their docs for the exact config field name.

### Environment variables (local mode only)

| Variable | Purpose |
| --- | --- |
| `COW_RPC_URL_<CHAIN_ID>` | Pin a per-chain RPC for `cow_check_approval`. Defaults to the chain's `*.publicnode.com` then viem's bundled RPC. Example: `COW_RPC_URL_8453=https://mainnet.base.org` |

## Try it

| Use case             | Prompt                                                            |
| -------------------- | ----------------------------------------------------------------- |
| Quote a swap         | "Quote 1 WETH for USDC on Arbitrum."                              |
| Inspect an order     | "What's the status of order `0xabc…`?"                            |
| Wallet trade history | "Show me vitalik.eth's last 10 CoW trades on mainnet."            |
| Find a token         | "Is there a COW token on Gnosis? Give me the address."            |
| Place a swap         | "Sell 0.1 WETH for USDC on Sepolia from `0x…`. Default slippage." |
| Cancel an open order | "Cancel order `0xabc…`."                                          |
| Check approval       | "Have I approved USDC for CoW on Base, owner `0x…`?"              |

For the full natural-language → swap recipe (intent parsing, confirmation, approval, build, sign, submit, poll), load `skills/cow-swap/SKILL.md` into your host.

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

`sellToken` / `buyToken` accept either a `0x` address or a token symbol (e.g. `"WETH"`). Symbols resolve against per-chain CoW token lists; unknown or ambiguous symbols return a hint to call `cow_list_tokens`.

Every tool takes a `chainId` (defaults to `1`). Use `cow_list_chains` to enumerate at runtime.

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

## Wallet boundary

cow-mcp does not sign and does not broadcast. Signing `typedData` and submitting approval calldata is the host wallet's job — keeping cow-mcp compatible with any wallet integration (local keystore, EIP-1193, Safe / 4337 with `signingScheme: "eip1271"`, embedded MPC).

`cow_submit_order` and `cow_submit_cancellation` require user confirmation via [MCP elicitation](https://modelcontextprotocol.io/specification/draft/client/elicitation); hosts without elicitation support fall through to the skill-level gate.

## Known limitations

- **Single-chain orderbook only.** Both legs of an order must be on the same chain. Cross-chain (CoW's `@cowprotocol/sdk-bridging`) isn't exposed yet.
- **No trade timestamps.** The orderbook `/trades` endpoint returns only `blockNumber` / `logIndex`. Call `cow_get_order(uid)` per trade if you need `creationDate`.

## Development

```bash
pnpm install
pnpm dev          # run via tsx (stdio)
pnpm test         # vitest
pnpm check        # typecheck + prettier + eslint + tests
pnpm fix          # prettier --write + eslint --fix
pnpm build        # compile to dist/
```

To point an MCP client at a local checkout, swap `npx -y cow-mcp` for `node /absolute/path/to/cow-mcp/dist/index.js`.

A Dev Container config (`.devcontainer/`) is available for isolated development inside Docker — useful as a guard against npm supply-chain attacks. See [`.devcontainer/README.md`](.devcontainer/README.md).

## License

MIT
