import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GetOrderInput, getOrder } from './tools/get_order.js';
import { GetQuoteInput, getQuote } from './tools/get_quote.js';
import { GetTradesInput, getTrades } from './tools/get_trades.js';
import { listChains } from './tools/list_chains.js';
import { ListTokensInput, listTokens } from './tools/list_tokens.js';

export function createServer(): McpServer {
  const server = new McpServer(
    { name: 'cow-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    'cow_get_quote',
    {
      title: 'Get a CoW Protocol quote',
      description:
        'Indicative price + fee for a swap. Returns sellAmount, buyAmount, feeAmount, validTo, quoteId. Throws InvalidRequest on unknown/ambiguous symbol, unsupported chainId, or malformed address; InternalError on upstream 5xx.',
      inputSchema: GetQuoteInput,
    },
    async (args) => {
      const result = await getQuote(args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  server.registerTool(
    'cow_get_order',
    {
      title: 'Look up a CoW order by uid',
      description:
        'Returns full order state — status, executed amounts, validTo, settlement tx if filled. Addresses are EIP-55 checksummed. Throws InvalidRequest if the uid is malformed or not found, or chainId is unsupported.',
      inputSchema: GetOrderInput,
    },
    async (args) => {
      const result = await getOrder(args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  server.registerTool(
    'cow_get_trades',
    {
      title: 'Recent CoW trades for a wallet',
      description:
        'Trades for an owner address. Cap at 100 trades, default 25. Each trade includes blockNumber, blockTimestamp (ISO, best-effort), and EIP-55 checksummed token addresses. Returns an empty array (not an error) when the owner has no trades. Throws InvalidRequest on malformed address or unsupported chainId.',
      inputSchema: GetTradesInput,
    },
    async (args) => {
      const result = await getTrades(args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: { trades: result },
      };
    }
  );

  server.registerTool(
    'cow_list_chains',
    {
      title: 'List CoW-supported chains',
      description: 'Every chain CoW Protocol supports. Use the chainId field on other tools.',
    },
    async () => {
      const result = listChains();
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: { chains: result },
      };
    }
  );

  server.registerTool(
    'cow_list_tokens',
    {
      title: 'List supported tokens for a chain',
      description:
        'Curated CoW token list (symbol, name, decimals, logo) filtered by chainId and optional search. Returns empty array when no tokens match (not an error). Coverage is best on mainnet; for unknown long-tail tokens, cow_get_order/cow_get_trades will fall back to on-chain symbol() reads. Throws InvalidRequest on unsupported chainId.',
      inputSchema: ListTokensInput,
    },
    async (args) => {
      const result = await listTokens(args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: { tokens: result },
      };
    }
  );

  return server;
}
