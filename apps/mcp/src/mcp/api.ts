// How the MCP server reaches this repository's client. The server's generic files (server.ts,
// limiter.ts, config.ts, run.ts, result.ts: the kit, the same in every repository) import the
// client only through this file, under the names below; the names on the right are this
// client's. Per repository, like tools.ts: a client whose names or functions differ adapts here.

import { DEFAULT_BASE_URL } from "@maschinenlesbar.org/fim-portal-client";

export {
  FimPortalClient as Client,
  FimError as ClientError,
  FimNetworkError as NetworkError,
  baseUrlProblem,
  DEFAULT_BASE_URL,
  MAX_TIMEOUT_MS,
  nodeHttpTransport,
  type HttpRequest,
  type HttpResponse,
  type Transport,
} from "@maschinenlesbar.org/fim-portal-client";
export { sizeLimitMessage } from "@maschinenlesbar.org/fim-portal-client/internal/http";
export { cutText, toWellFormed } from "@maschinenlesbar.org/fim-portal-client/internal/errors";

/**
 * The API's base URL as a result's `source` starts with it (`--base-url`, else the default): the
 * portal's host, since the client's paths start with /api/v1 or /api/v0 (both appear in sources).
 */
export function apiBase(baseUrl: string | undefined): string {
  return (baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
}
