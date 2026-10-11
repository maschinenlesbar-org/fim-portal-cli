// HTTP transport built on Node's built-in `http`/`https` modules — no axios,
// no fetch polyfill, no third-party HTTP client.
//
// The transport is a plain function so it can be trivially swapped out in tests
// (inject a `mock.fn()` returning a canned HttpResponse) without touching the
// network. The default implementation below is exercised against a real local
// `http.createServer` in the test-suite.

import http from "node:http";
import https from "node:https";
import { FimNetworkError, redactUrl } from "./errors.js";

export interface HttpRequest {
  method: string;
  /** Fully-qualified absolute URL. */
  url: string;
  headers?: Record<string, string>;
  /** Optional request body (already serialised). */
  body?: string | Buffer;
  /**
   * Per-request timeout in milliseconds. The engine enforces it as an overall deadline
   * whatever the transport does (see `signal`); the default transport also applies it
   * as an idle-socket timeout.
   */
  timeoutMs?: number;
  /**
   * Hard cap on the response body size in bytes. The default transport aborts as soon
   * as it is exceeded; the engine checks the body it gets back from any transport.
   */
  maxResponseBytes?: number;
  /**
   * Aborted when the engine's overall deadline (`timeoutMs`) passes. A transport should stop
   * the request then (`fetch(url, { signal })`); the engine rejects at the deadline either way,
   * and enforces `maxResponseBytes` on the body it gets back, so neither limit depends on it.
   */
  signal?: AbortSignal;
}

export interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

/**
 * A transport: one HTTP exchange, resolving with the response whatever its status.
 * The engine accepts more than the declared shape from a JavaScript transport (a fetch
 * `Headers` object or a `Map` for `headers`, header names in any case, any ArrayBuffer
 * view or ArrayBuffer as `body`) and turns anything else it returns or throws into a
 * `FimNetworkError`.
 */
export type Transport = (request: HttpRequest) => Promise<HttpResponse>;

/** The message for a body over the size cap, naming the option on both sides. */
export function sizeLimitMessage(maxBytes: number): string {
  return `Response exceeded the size limit of ${maxBytes} bytes (maxResponseBytes; --max-response-bytes on the CLI)`;
}

/**
 * The longest delay Node's timers support (2^31 - 1 ms, about 24.8 days). A longer one
 * prints a TimeoutOverflowWarning and fires after 1 ms, so timeouts are capped here.
 */
export const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Default transport. Resolves with the raw response (including non-2xx) — status
 * interpretation is the client's job. Rejects only on transport-level failures
 * (connection errors, timeouts, malformed URLs).
 */
export const nodeHttpTransport: Transport = (request) =>
  new Promise<HttpResponse>((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      reject(new FimNetworkError(`Invalid URL: ${redactUrl(request.url)}`));
      return;
    }

    // Only http/https are supported. Reject anything else up front with a clear,
    // typed error instead of letting Node throw an opaque ERR_INVALID_PROTOCOL
    // (and so this never reaches the file:/ftp:/etc. drivers).
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      reject(new FimNetworkError(`Unsupported protocol "${url.protocol}" in URL: ${redactUrl(request.url)}`));
      return;
    }

    const isHttps = url.protocol === "https:";
    const driver = isHttps ? https : http;
    const maxBytes = request.maxResponseBytes;

    // Wall-clock deadline. `req.setTimeout` below is only an *idle-socket* timer,
    // so a server that trickles one byte per interval never idles out and could
    // keep the process alive forever (slow-loris). This overall timer is an
    // upper bound on the whole request regardless of drip-feeding; it is cleared
    // on every terminal path so it can never fire against a finished request.
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const clearDeadline = (): void => {
      if (deadline !== undefined) {
        clearTimeout(deadline);
        deadline = undefined;
      }
    };

    // Node validates header names and values synchronously and throws a raw
    // TypeError (ERR_INVALID_CHAR) for an unsendable one; turn it into a typed
    // rejection. (The engine already refuses a bad userAgent when it is built.)
    let req: http.ClientRequest;
    try {
      req = driver.request(
        url,
        {
          method: request.method,
          headers: request.headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let received = 0;
          let aborted = false;

          res.on("data", (chunk: Buffer) => {
            if (aborted) return;
            received += chunk.length;
            if (maxBytes !== undefined && received > maxBytes) {
              aborted = true;
              clearDeadline();
              res.destroy();
              reject(new FimNetworkError(sizeLimitMessage(maxBytes)));
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () => {
            if (aborted) return;
            clearDeadline();
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks),
            });
          });
          res.on("error", (err) => {
            if (aborted) return; // we already rejected with the size-cap error
            clearDeadline();
            reject(new FimNetworkError(`Response stream error: ${err.message}`, { cause: err }));
          });
        },
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      reject(new FimNetworkError(`Invalid request: ${reason}`, { cause: err }));
      return;
    }

    if (request.timeoutMs && request.timeoutMs > 0) {
      const delay = Math.min(request.timeoutMs, MAX_TIMEOUT_MS);
      // Idle-socket timeout (fires when no bytes move for timeoutMs).
      req.setTimeout(delay, () => {
        req.destroy(new FimNetworkError(`Request timed out after ${request.timeoutMs}ms`));
      });
      // Overall wall-clock deadline (fires even if bytes keep trickling).
      deadline = setTimeout(() => {
        req.destroy(new FimNetworkError(`Request exceeded deadline of ${request.timeoutMs}ms`));
      }, delay);
      // Don't let a pending deadline timer keep the event loop alive on its own.
      deadline.unref?.();
    }

    if (request.signal !== undefined) {
      const abort = (): void => {
        req.destroy(new FimNetworkError(`Request exceeded deadline of ${request.timeoutMs ?? 0}ms`));
      };
      if (request.signal.aborted) abort();
      else request.signal.addEventListener("abort", abort, { once: true });
    }

    req.on("error", (err) => {
      clearDeadline();
      // A timeout destroy already passes a FimNetworkError; don't double-wrap.
      reject(err instanceof FimNetworkError ? err : new FimNetworkError(err.message, { cause: err }));
    });

    if (request.body !== undefined) req.write(request.body);
    req.end();
  });
