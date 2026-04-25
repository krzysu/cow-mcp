import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

type HttpLike = {
  status?: number;
  statusCode?: number;
  response?: { status?: number; data?: unknown };
  body?: unknown;
  message?: string;
};

function statusOf(err: HttpLike): number | undefined {
  return err.status ?? err.statusCode ?? err.response?.status;
}

function bodyMessage(err: HttpLike): string | undefined {
  const body = (err.response?.data ?? err.body) as
    | { description?: string; errorType?: string; message?: string }
    | undefined;
  if (!body) return undefined;
  if (body.description && body.errorType) return `${body.errorType}: ${body.description}`;
  return body.description ?? body.message;
}

/**
 * Map an upstream orderbook / network error to an McpError.
 * 404 -> InvalidRequest "not found"; 400 -> InvalidRequest with body reason; 5xx -> InternalError.
 */
export function toMcpError(err: unknown, label: string): McpError {
  if (err instanceof McpError) return err;
  const e = err as HttpLike;
  const status = statusOf(e);
  const detail = bodyMessage(e) ?? e.message ?? String(err);

  if (status === 404) {
    return new McpError(ErrorCode.InvalidRequest, `${label}: not found`);
  }
  if (status === 400) {
    return new McpError(ErrorCode.InvalidRequest, `${label}: ${detail}`);
  }
  if (status && status >= 500) {
    return new McpError(ErrorCode.InternalError, `${label}: upstream ${status} — ${detail}`);
  }
  return new McpError(ErrorCode.InternalError, `${label}: ${detail}`);
}

/** Run an async fn, retry once after 250ms on network/5xx-style errors. */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const status = statusOf(err as HttpLike);
    const transient = status === undefined || status >= 500;
    if (!transient) throw err;
    await new Promise((r) => setTimeout(r, 250));
    return await fn();
  }
}
