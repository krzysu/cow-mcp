# cow-mcp

MCP (Model Context Protocol) server exposing [CoW Protocol](https://cow.fi) to AI agents. Lets an agent fetch quotes, inspect orders, and browse a wallet's trade history.

**v0.1 — read-only.** No signing, no key handling. The sign + submit flow is planned for v0.2; see `docs/COW_MCP_SPEC.md`.

## Tools

| Tool              | Purpose                                                   |
| ----------------- | --------------------------------------------------------- |
| `cow_get_quote`   | Indicative price + fee for a swap                         |
| `cow_get_order`   | Look up an order by uid (status, executed amounts, tx)    |
| `cow_get_trades`  | Recent trades for a wallet (capped at 100, default 25)    |
| `cow_list_chains` | All chains CoW supports (id, name, native symbol)         |
| `cow_list_tokens` | Supported tokens for a chain, optional symbol/name search |

## Cross-chain

Every tool takes a `chainId` parameter, so an agent can quote on Ethereum, pull trades from Arbitrum, and list tokens on Base in the same session. `chainId` defaults to `1` (Ethereum) when omitted.

Supported chains (all CoW Protocol chains, sourced from `@cowprotocol/cow-sdk` so they stay in sync): Ethereum, BNB Chain, Gnosis, Polygon, Base, Plasma, Arbitrum One, Avalanche, Ink, Linea, Sepolia. Use `cow_list_chains` to enumerate at runtime.

### Symbol resolution

`cow_get_quote` accepts either a `0x` address or a token symbol (e.g. `"WETH"`, `"USDC"`) for `sellToken` / `buyToken`. Symbols are resolved against the chain-specific slice of the CoW token list. Unknown symbols return a hint to call `cow_list_tokens`; ambiguous symbols return all candidate addresses so the agent can disambiguate.

> Note: CoW orders are single-chain — both legs must be on the same chain. Cross-chain bridging is out of scope.

## Configure

cow-mcp is a stdio MCP server, so any MCP-compatible client works (Claude Code, Claude Desktop, Cursor, Cline, Continue, …). Requires Node 20+ on the host machine. No environment variables required — defaults are baked in.

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

### Claude Desktop

Add to your `claude_desktop_config.json`:

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

## Demo prompt

> "List the chains CoW supports, then quote 1 WETH → USDC on Arbitrum, and show me my last 5 trades on Ethereum."

The agent will call `cow_list_chains`, then `cow_get_quote` (with `chainId: 42161` and symbol resolution), then `cow_get_trades` (with `chainId: 1, limit: 5`).

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
