import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { orderTemplate, readOrder } from './resources/order.js';
import { readTrades, tradesTemplate } from './resources/trades.js';
import { GetOrderInput, getOrder } from './tools/get_order.js';
import { GetQuoteInput, getQuote } from './tools/get_quote.js';
import { GetTradesInput, getTrades } from './tools/get_trades.js';
import { listChains } from './tools/list_chains.js';
import { ListTokensInput, listTokens } from './tools/list_tokens.js';

export function createServer(): McpServer {
  const server = new McpServer(
    { name: 'cow-mcp', version: '0.1.0' },
    { capabilities: { tools: {}, resources: {} } }
  );

  server.registerTool(
    'cow_get_quote',
    {
      title: 'Get a CoW Protocol quote',
      description:
        'Indicative price + fee for a swap. Returns sellAmount, buyAmount, feeAmount, validTo, quoteId.',
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
        'Returns full order state — status, executed amounts, validTo, settlement tx if filled.',
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
      description: 'Trades for an owner address. Cap at 100 trades, default 25.',
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
        'Token metadata (symbol, name, decimals, logo) filtered by chainId and optional search.',
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

  server.registerResource(
    'cow_order',
    orderTemplate,
    {
      title: 'CoW order',
      description: 'Pinable order resource. Re-read to refresh status.',
      mimeType: 'application/json',
    },
    async (uri, vars) =>
      readOrder(uri, vars as { chainId: string | string[]; uid: string | string[] })
  );

  server.registerResource(
    'cow_trades',
    tradesTemplate,
    {
      title: 'CoW trades for a wallet',
      description: 'Last 25 trades for an owner address.',
      mimeType: 'application/json',
    },
    async (uri, vars) =>
      readTrades(uri, vars as { chainId: string | string[]; owner: string | string[] })
  );

  return server;
}
