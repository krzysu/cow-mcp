import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export type ConfirmResult = { proceed: true } | { proceed: false; reason: string };

/**
 * Ask the host to confirm a destructive action via MCP elicitation.
 * If the client did not advertise `elicitation` capability, falls through (proceed: true)
 * — the skill-level confirmation gate in `skills/cow-swap/SKILL.md` is the fallback.
 */
export async function confirmDestructive(
  server: McpServer,
  message: string,
  signal: AbortSignal
): Promise<ConfirmResult> {
  const caps = server.server.getClientCapabilities();
  if (!caps?.elicitation) return { proceed: true };

  const res = await server.server.elicitInput(
    {
      message,
      requestedSchema: {
        type: 'object',
        properties: {
          confirm: {
            type: 'boolean',
            title: 'Confirm',
            description: 'Submit this to the CoW orderbook',
          },
        },
        required: ['confirm'],
      },
    },
    { signal }
  );

  if (res.action !== 'accept') return { proceed: false, reason: `user ${res.action}ed` };
  if (res.content?.confirm !== true) return { proceed: false, reason: 'not confirmed' };
  return { proceed: true };
}
