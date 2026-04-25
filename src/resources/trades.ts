import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTrades } from '../tools/get_trades.js';

export const tradesTemplate = new ResourceTemplate('cow://trades/{chainId}/{owner}', {
  list: undefined,
});

export async function readTrades(
  uri: URL,
  vars: { chainId: string | string[]; owner: string | string[] }
) {
  const chainId = Number(Array.isArray(vars.chainId) ? vars.chainId[0] : vars.chainId);
  const owner = Array.isArray(vars.owner) ? vars.owner[0] : vars.owner;
  if (!owner) throw new Error('owner is required');
  const trades = await getTrades({ chainId, owner, limit: 25 });
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(trades, null, 2),
      },
    ],
  };
}
