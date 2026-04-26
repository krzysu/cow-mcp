import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { confirmDestructive } from './elicit.js';
import { BuildApprovalInput, buildApproval } from './tools/build_approval.js';
import { BuildCancellationInput, buildCancellation } from './tools/build_cancellation.js';
import { BuildOrderInput, buildOrder } from './tools/build_order.js';
import { CheckApprovalInput, checkApproval } from './tools/check_approval.js';
import { GetOrderInput, getOrder } from './tools/get_order.js';
import { GetQuoteInput, getQuote } from './tools/get_quote.js';
import { GetTradesInput, getTrades } from './tools/get_trades.js';
import { listChains } from './tools/list_chains.js';
import { ListTokensInput, listTokens } from './tools/list_tokens.js';
import { SubmitCancellationInput, submitCancellation } from './tools/submit_cancellation.js';
import { SubmitOrderInput, submitOrder } from './tools/submit_order.js';

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
        'Trades for an owner address. Server-side paginated via `limit` (default 25, max 100) and `offset` (default 0); walk older trades by incrementing offset. Each trade includes blockNumber and EIP-55 checksummed token addresses. Symbol/decimals are enriched best-effort from the per-chain token list (no on-chain RPC). No timestamp is returned — the orderbook /trades endpoint does not expose one; call cow_get_order(uid) per trade if you need creationDate. Returns an empty array (not an error) when the owner has no more trades. Throws InvalidRequest on malformed address or unsupported chainId.',
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
        "Per-chain token list (symbol, name, decimals, logo) sourced from CoW's CoinGecko + Uniswap mirrors, filtered by optional symbol/name/address search. Returns empty array when no tokens match (not an error). Coverage is broad on majors (Mainnet, Arbitrum, Base, Polygon, BNB, Avalanche, Gnosis, Linea); long-tail tokens missing from the list come back from cow_get_order/cow_get_trades without symbol/decimals — agents get the raw 0x address. Throws InvalidRequest on unsupported chainId.",
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

  server.registerTool(
    'cow_build_order',
    {
      title: 'Build an EIP-712 typed-data payload for a CoW order',
      description:
        'Convert a quote (or raw amounts) into the EIP-712 payload the host wallet must sign. Bakes in appData, applies slippage to the quote (sell orders shrink buyAmount; buy orders grow sellAmount), and sets validTo. Returns { typedData, orderDigest, appData (JSON string), expectedBuyAmount }. The server never signs — pass typedData to your wallet/signer, then call cow_submit_order with the resulting signature.',
      inputSchema: BuildOrderInput,
    },
    async (args) => {
      const result = await buildOrder(args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  server.registerTool(
    'cow_submit_order',
    {
      title: 'Submit a signed CoW order',
      description:
        'Post a signed order to the CoW orderbook. Pass the order fields exactly as built by cow_build_order, plus the signature your wallet produced over the typedData. Returns { uid }. Hosts that advertise `elicitation` capability are prompted to confirm before submission. Throws InvalidRequest on signature mismatch, insufficient allowance/balance, or unsupported chain.',
      inputSchema: SubmitOrderInput,
    },
    async (args, extra) => {
      const confirm = await confirmDestructive(
        server,
        `Submit ${args.order.kind} order on chain ${args.chainId}: sell ${args.order.sellAmount} of ${args.order.sellToken} for ${args.order.buyAmount} of ${args.order.buyToken} from ${args.order.from}.`,
        extra.signal
      );
      if (!confirm.proceed) {
        return {
          isError: true,
          content: [{ type: 'text', text: `cow_submit_order: ${confirm.reason}` }],
        };
      }
      const result = await submitOrder(args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  server.registerTool(
    'cow_build_cancellation',
    {
      title: 'Build an EIP-712 typed-data payload to cancel a CoW order',
      description:
        'Returns the EIP-712 payload for an off-chain order cancellation. Sign it with the same wallet that placed the order, then call cow_submit_cancellation. Server does not sign or store keys.',
      inputSchema: BuildCancellationInput,
    },
    async (args) => {
      const result = buildCancellation(args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  server.registerTool(
    'cow_submit_cancellation',
    {
      title: 'Submit a signed CoW order cancellation',
      description:
        'Post a signed off-chain cancellation. Returns { ok: true } on success. Hosts that advertise `elicitation` capability are prompted to confirm before submission. Throws InvalidRequest on signature mismatch or wrong owner.',
      inputSchema: SubmitCancellationInput,
    },
    async (args, extra) => {
      const confirm = await confirmDestructive(
        server,
        `Cancel CoW order ${args.uid} on chain ${args.chainId}.`,
        extra.signal
      );
      if (!confirm.proceed) {
        return {
          isError: true,
          content: [{ type: 'text', text: `cow_submit_cancellation: ${confirm.reason}` }],
        };
      }
      const result = await submitCancellation(args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  server.registerTool(
    'cow_check_approval',
    {
      title: 'Check ERC-20 allowance for the GPv2 vault relayer',
      description:
        'Reads on-chain allowance(owner, vaultRelayer) for a sell token. Returns { approved, allowance, spender }. Use this before cow_build_order; if not approved, call cow_build_approval to get calldata for the host wallet to broadcast.',
      inputSchema: CheckApprovalInput,
    },
    async (args) => {
      const result = await checkApproval(args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  server.registerTool(
    'cow_build_approval',
    {
      title: 'Build ERC-20 approve() calldata for the GPv2 vault relayer',
      description:
        'Returns { to, data, value } for a host wallet to submit on-chain. Default amount is unlimited (uint256 max). Server does not broadcast.',
      inputSchema: BuildApprovalInput,
    },
    async (args) => {
      const result = buildApproval(args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  return server;
}
