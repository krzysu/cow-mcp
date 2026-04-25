import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getOrder } from '../tools/get_order.js';

export const orderTemplate = new ResourceTemplate('cow://order/{chainId}/{uid}', {
  list: undefined,
});

export async function readOrder(
  uri: URL,
  vars: { chainId: string | string[]; uid: string | string[] }
) {
  const chainId = Number(Array.isArray(vars.chainId) ? vars.chainId[0] : vars.chainId);
  const uid = Array.isArray(vars.uid) ? vars.uid[0] : vars.uid;
  if (!uid) throw new Error('uid is required');
  const order = await getOrder({ chainId, uid });
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(order, null, 2),
      },
    ],
  };
}
