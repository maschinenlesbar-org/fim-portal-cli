// The request engine: turns logical (method, path, query) calls into HTTP
// requests via a Transport, applies retry/backoff for the statuses the API
// documents as transient (429, 503), and decodes responses.

import {
  MAX_TIMEOUT_MS,
  nodeHttpTransport,
  sizeLimitMessage,
  type HttpRequest,
  type HttpResponse,
  type Transport,
} from "./http.js";
import { buildQueryString, type QueryParams } from "./query.js";
import {
  FimApiError,
  FimError,
  FimNetworkError,
  FimParseError,
  FimValidationError,
  credentialsIn,
  redactCredentials,
  redactUrl,
} from "./errors.js";
import {
  assertNonBlankParams,
  assertValid,
  baseUrlProblem,
  headerValueProblem,
  intInRangeProblem,
} from "./validate.js";

export const DEFAULT_BASE_URL = "https://fimportal.de";

/** Most retries `maxRetries` may ask for (each may wait up to MAX_RETRY_AFTER_MS). */
export const MAX_RETRIES = 10;
const DEFAULT_USER_AGENT = "fim-portal-cli";

export interface RawResponse {
  data: Buffer;
  contentType: string;
  status: number;
}

export interface EngineOptions {
  /** Base URL of the API. Defaults to https://fimportal.de */
  baseUrl?: string;
  /** Swappable transport. Defaults to the built-in node http/https transport. */
  transport?: Transport;
  /**
   * Value of the User-Agent header: non-blank Latin-1 without control characters
   * (tab allowed). Defaults to "fim-portal-cli".
   */
  userAgent?: string;
  /**
   * Per-request timeout in milliseconds: an integer 0..`MAX_TIMEOUT_MS` (2^31 - 1
   * ms, the largest timer Node supports); 0 disables. Defaults to 30000.
   */
  timeoutMs?: number;
  /**
   * Number of automatic retries for transient (429/503) responses and connection
   * resets (isTransientNetworkError), an integer
   * 0..`MAX_RETRIES` (10); defaults to 2. Each waits `retryDelayMs * attempt`, or the
   * response's `Retry-After` when that is longer (up to `MAX_RETRY_AFTER_MS`; a longer
   * one is not retried, and the FimApiError says so).
   */
  maxRetries?: number;
  /**
   * Base backoff between retries in milliseconds (grows linearly), an integer
   * 0..`MAX_RETRY_AFTER_MS` (30 000). Defaults to 200. It is also the floor under a
   * `Retry-After`: the header can lengthen a wait, never shorten it.
   */
  retryDelayMs?: number;
  /**
   * Hard cap on response body size in bytes (defends against memory exhaustion
   * from a hostile/buggy endpoint), a non-negative integer. Defaults to 100 MiB;
   * set to 0 for no limit.
   */
  maxResponseBytes?: number;
  /** Injectable sleep, primarily for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_RESPONSE_BYTES = 100 * 1024 * 1024;

/**
 * Longest `Retry-After` the engine waits out before retrying a 429/503. When the
 * server asks for longer, the engine does not retry at all and surfaces the error at
 * once: retrying early would only land inside the window the server asked us to wait
 * out, and a hostile value must not stall the CLI.
 */
export const MAX_RETRY_AFTER_MS = 30_000;

/** An IMF-fixdate (RFC 9110 §5.6.7), the one HTTP-date form senders must generate. */
const IMF_FIXDATE =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/**
 * Parse a `Retry-After` header into a delay in milliseconds (RFC 9110 §10.2.3):
 * either delay-seconds (`"120"`) or an HTTP-date (`"Wed, 21 Oct 2026 07:28:00 GMT"`,
 * turned into the time left from `now`; a date in the past gives 0).
 *
 * Returns `undefined` when the header is absent or malformed — negative (`"-1"`),
 * fractional (`"1.5"`), padded inside, any other date format — so the caller falls
 * back to its own backoff. The strict patterns matter: `Date.parse` alone would
 * read `"1.5"` as a date in 2001 and retry at once.
 */
export function parseRetryAfter(
  header: string | string[] | undefined,
  now: number = Date.now(),
): number | undefined {
  const value = (Array.isArray(header) ? header[0] : header)?.trim();
  if (value === undefined || value === "") return undefined;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  if (!IMF_FIXDATE.test(value)) return undefined;
  const when = Date.parse(value);
  return Number.isNaN(when) ? undefined : Math.max(0, when - now);
}

/**
 * True for the Unicode bidirectional formatting characters: ALM (U+061C), LRM/RLM
 * (U+200E/U+200F), the embeddings and overrides U+202A–U+202E and the isolates
 * U+2066–U+2069. A terminal applies them to the text that follows, so an override
 * in server text can reorder what the user sees ("Trojan Source" spoofing).
 */
export function isBidiControl(code: number): boolean {
  return (
    code === 0x061c ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

/**
 * Make a string that originates in an attacker-controlled response — the error
 * `detail`, a redirect `Location`, the echoed Content-Type — safe to print into an
 * error message on stderr:
 *
 * - C0 and C1 controls and DEL are dropped. A JSON error body can encode an escape
 *   (U+001B) that JSON.parse turns into a real control byte; printed raw, a hostile
 *   or MITM'd endpoint could drive ANSI/OSC sequences into the terminal (display
 *   spoofing, title changes).
 * - Bidi formatting characters (isBidiControl) are dropped, so server text cannot
 *   reorder the visible message.
 * - Every run of whitespace — newlines, tabs, U+2028/U+2029 included — becomes one
 *   space and the ends are trimmed, so the text stays on one line and a server
 *   cannot forge an `Error:` line of its own.
 *
 * The CLI's JSON output is escaped separately (`escapeControlChars` in
 * cli/shared.ts): `JSON.stringify` alone leaves DEL, C1 and bidi characters raw.
 * Written as a char-code filter so no raw control byte appears in this source.
 */
export function sanitizeServerText(text: string): string {
  let out = "";
  for (const ch of text) {
    const n = ch.codePointAt(0) ?? 0;
    const whitespaceControl = n >= 0x09 && n <= 0x0d;
    if (!whitespaceControl && (n <= 0x1f || (n >= 0x7f && n <= 0x9f) || isBidiControl(n))) continue;
    out += ch;
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Check a base URL against every rule (baseUrlProblem: parseable, http(s) only, no
 * query or fragment, no whitespace or control characters) and return it with
 * trailing slashes stripped. Throws a FimValidationError
 * (`Invalid baseUrl: <reason>`): a bad base URL is a configuration error, not a
 * transport failure. The RequestEngine constructor runs it on the raw value; the
 * CLI's `--base-url` parser applies the same rule.
 */
export function validateBaseUrl(raw: string): string {
  return assertValid("baseUrl", raw, baseUrlProblem).replace(/\/+$/, "");
}

/**
 * Check a value bound for an HTTP header (headerValueProblem) and return it, or
 * throw a FimValidationError (`Invalid <name>: Value contains control characters.`).
 */
export function assertHeaderValue(name: string, value: string): string {
  return assertValid(name, value, headerValueProblem);
}

/**
 * A numeric engine option: `fallback` when undefined, else an integer in 0..max, or
 * a FimValidationError (`Invalid <name>: ...`). A negative or NaN value would
 * otherwise silently disable the timeout or the size cap.
 */
export function intOption(name: string, value: number | undefined, max: number, fallback: number): number {
  return value === undefined ? fallback : assertValid(name, value, intInRangeProblem(0, max));
}

/** Why `value` is not a usable HttpResponse, or undefined when it is. */
function responseProblem(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return "not an object";
  const r = value as Partial<Record<"status" | "headers" | "body", unknown>>;
  if (typeof r.status !== "number" || !Number.isInteger(r.status) || r.status < 100 || r.status > 599) {
    return "status is not an HTTP status code";
  }
  if (typeof r.headers !== "object" || r.headers === null || Array.isArray(r.headers)) return "headers is not an object";
  if (bodyBytes(r.body) === undefined) return "body is not a Buffer, Uint8Array, other ArrayBuffer view or ArrayBuffer";
  return undefined;
}

/**
 * The response body as a Buffer (a view, no copy): a Buffer, any ArrayBuffer view (a
 * Uint8Array from fetch, a DataView) or an ArrayBuffer/SharedArrayBuffer — checked by internal
 * slot, not `instanceof`, so a value from another realm (a vm context, a Jest test) counts.
 * Undefined for anything else.
 */
function bodyBytes(value: unknown): Buffer | undefined {
  if (Buffer.isBuffer(value)) return value;
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  const tag = Object.prototype.toString.call(value);
  if (tag === "[object ArrayBuffer]" || tag === "[object SharedArrayBuffer]") return Buffer.from(value as ArrayBuffer);
  return undefined;
}

/**
 * The response headers as a plain record with lower-case names. A transport built on
 * `fetch` naturally returns its `Headers` object, which passes as an object but has no
 * plain properties: the engine then saw no Retry-After, no Content-Type and no Location.
 * Such an object (anything with `get` and `forEach`, a `Map` too) is copied into a record;
 * a plain record gets its names lower-cased, as the engine reads them.
 */
function plainHeaders(headers: object): Record<string, string | string[] | undefined> {
  const h = headers as { get?: unknown; forEach?: unknown };
  if (typeof h.get === "function" && typeof h.forEach === "function") {
    const record: Record<string, string> = {};
    (h.forEach as (cb: (value: unknown, name: unknown) => void) => void).call(headers, (value, name) => {
      record[String(name).toLowerCase()] = String(value);
    });
    return record;
  }
  // Node's transport lower-cases header names; a custom one may not ("Content-Type").
  const record: Record<string, string | string[] | undefined> = {};
  for (const [name, value] of Object.entries(headers as Record<string, string | string[] | undefined>)) {
    record[name.toLowerCase()] = value;
  }
  return record;
}

/**
 * Error codes of a connection that broke off mid-request: Node's (`socket hang up` is
 * ECONNRESET) and undici's (`fetch failed` with cause UND_ERR_SOCKET, "other side closed").
 */
const TRANSIENT_NETWORK_CODES = new Set(["ECONNRESET", "EPIPE", "ECONNABORTED", "UND_ERR_SOCKET"]);

/** True when `err` or an error in its `cause` chain has a transient connection code. */
function hasTransientCode(err: unknown, depth = 0): boolean {
  if (typeof err !== "object" || err === null || depth > 4) return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && TRANSIENT_NETWORK_CODES.has(code)) return true;
  return hasTransientCode((err as { cause?: unknown }).cause, depth + 1);
}

/**
 * True for a failure caused by a reset or aborted connection, which the engine retries —
 * whichever transport raised it (the default transport's FimNetworkError, Node's own
 * error, fetch's TypeError with an undici cause). A refused connection, a DNS failure or
 * a timeout is not transient in that sense and is not retried.
 */
export function isTransientNetworkError(err: unknown): boolean {
  return hasTransientCode(err);
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class RequestEngine {
  // A real private field (not TypeScript's `private`): util.inspect, console.log and
  // JSON.stringify of a client never show it, so a password in the base URL can't be
  // logged by accident. Messages use redactUrl.
  readonly #baseUrl: string;
  /** The base URL's userinfo, raw and percent-decoded, for scrubbing server and transport text. */
  readonly #credentials: string[];
  private readonly transport: Transport;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly maxResponseBytes: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: EngineOptions = {}) {
    // Checked on the raw value, before the slash strip: buildUrl concatenates it.
    // Only undefined selects the default.
    this.#baseUrl = options.baseUrl === undefined ? DEFAULT_BASE_URL : validateBaseUrl(options.baseUrl);
    this.#credentials = credentialsIn(this.#baseUrl).flatMap((raw) => {
      try {
        return [raw, decodeURIComponent(raw)];
      } catch {
        return [raw];
      }
    });
    this.transport = options.transport ?? nodeHttpTransport;
    // Only undefined selects the default; a blank or unsendable value is refused
    // here rather than sent blank or failing late with Node's raw TypeError.
    this.userAgent =
      options.userAgent === undefined ? DEFAULT_USER_AGENT : assertHeaderValue("userAgent", options.userAgent);
    // Range-check the numeric options: a negative, NaN or fractional value would
    // otherwise silently disable the timeout or the size cap, and an unbounded
    // maxRetries would keep retrying against a production API.
    this.timeoutMs = intOption("timeoutMs", options.timeoutMs, MAX_TIMEOUT_MS, 30_000);
    this.maxRetries = intOption("maxRetries", options.maxRetries, MAX_RETRIES, 2);
    // Bounded like a Retry-After wait: a larger value overflowed Node's timer and fired
    // after 1 ms, a burst rather than a backoff.
    this.retryDelayMs = intOption("retryDelayMs", options.retryDelayMs, MAX_RETRY_AFTER_MS, 200);
    this.maxResponseBytes = intOption(
      "maxResponseBytes",
      options.maxResponseBytes,
      Number.MAX_SAFE_INTEGER,
      DEFAULT_MAX_RESPONSE_BYTES,
    );
    this.sleep = options.sleep ?? realSleep;
  }

  /**
   * `text` without the base URL's credentials: server text (an error body that echoes the
   * request URL) and transport text (fetch's "Request cannot be constructed from a URL that
   * includes credentials: <url>") can carry them.
   */
  private scrub(text: string): string {
    return this.#credentials.length === 0 ? text : redactCredentials(text, this.#credentials);
  }

  /**
   * A transport failure as the `cause` of the error the engine raises: the original when its
   * text carries no credentials, otherwise a copy with them scrubbed (message, `code` and the
   * cause chain kept), so logging the error with its causes can't reveal the base URL's
   * password.
   */
  private scrubCause(cause: unknown, depth = 0): unknown {
    if (this.#credentials.length === 0 || depth > 5) return cause;
    if (typeof cause === "string") return this.scrub(cause);
    if (!(cause instanceof Error)) return cause;
    const inner = this.scrubCause(cause.cause, depth + 1);
    const message = this.scrub(cause.message);
    if (message === cause.message && inner === cause.cause && !this.scrub(cause.stack ?? "").includes("***@")) return cause;
    const copy = new Error(message, inner === undefined ? undefined : { cause: inner });
    copy.name = cause.name;
    const code = (cause as { code?: unknown }).code;
    if (code !== undefined) Object.assign(copy, { code });
    return copy;
  }

  /**
   * Build a fully-qualified URL from a path and optional query parameters.
   *
   * Throws a FimValidationError for a path with a "." or ".." segment. The
   * resource methods put ids into the path with `pathSegment` (encodeURIComponent),
   * which leaves those two unchanged, and URL parsing then resolves them:
   * `schemas get S1 ..` would request `/api/v1/schemas/` (the search) and print its
   * result with exit 0. Neither can name a resource. (Percent-encoded forms such as
   * "%2e%2e" are safe: encodeURIComponent turns their "%" into "%25".) An empty
   * segment (`//` or a trailing `/`) is rejected the same way; `pathSegment`
   * already refuses a blank id, so this is a backstop for future path builders.
   *
   * Throws a FimValidationError for a blank query value, a blank array element, an
   * empty array or a blank parameter name (assertNonBlankParams): the API treats an
   * empty parameter as no filter, so `name=` would return the unfiltered result.
   * Every search, list and CSV method goes through here, so all are covered.
   */
  buildUrl(path: string, query?: QueryParams): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const segments = normalizedPath.split("/").slice(1);
    const dotSegment = segments.find((s) => s === "." || s === "..");
    if (dotSegment !== undefined) {
      throw new FimValidationError(
        `Invalid path segment "${dotSegment}" in ${normalizedPath}: "." and ".." cannot be used as an id.`,
      );
    }
    if (segments.includes("")) {
      throw new FimValidationError(
        `Invalid path ${normalizedPath}: an empty segment cannot be used as an id.`,
      );
    }
    if (query) assertNonBlankParams(query);
    const qs = query ? buildQueryString(query) : "";
    return `${this.#baseUrl}${normalizedPath}${qs ? `?${qs}` : ""}`;
  }

  /**
   * Call the transport under the overall deadline (`timeoutMs`): the request gets an
   * AbortSignal that fires at the deadline, and the call rejects then whether the transport
   * stops or not — a custom transport (fetch, a node:http wrapper) that ignores `timeoutMs`
   * can't hang the caller. A synchronous throw becomes a rejection.
   */
  private async callTransport(request: HttpRequest): Promise<HttpResponse> {
    const call = (signal?: AbortSignal): Promise<HttpResponse> =>
      Promise.resolve().then(() => this.transport(signal === undefined ? request : { ...request, signal }));
    if (this.timeoutMs === 0) return call();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err = new FimNetworkError(`Request exceeded deadline of ${this.timeoutMs}ms`);
        controller.abort(err);
        reject(err);
      }, Math.min(this.timeoutMs, MAX_TIMEOUT_MS));
    });
    try {
      return await Promise.race([call(controller.signal), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Perform a request with Accept negotiation and transient-error retries. */
  async request(
    method: string,
    path: string,
    options: { query?: QueryParams; accept: string } = { accept: "application/json" },
  ): Promise<RawResponse> {
    const url = this.buildUrl(path, options.query);
    const headers: Record<string, string> = {
      Accept: options.accept,
      "User-Agent": this.userAgent,
    };

    // Only an idempotent request is sent again: request() is public, and a POST re-sent
    // after a reset or a 503 may be applied twice. The client itself sends GETs only.
    const idempotent = /^(GET|HEAD)$/i.test(method);
    let attempt = 0;
    // attempts = initial try + maxRetries
    for (;;) {
      let response: HttpResponse;
      try {
        response = await this.callTransport({
          method,
          url,
          headers,
          timeoutMs: this.timeoutMs,
          ...(this.maxResponseBytes > 0 ? { maxResponseBytes: this.maxResponseBytes } : {}),
        });
      } catch (cause) {
        // A connection the server (or a gateway) reset is the network-level twin of a
        // 503: retry the GET, whichever transport reported it. Timeouts are not retried —
        // a slow upstream should not be asked again at once, and timeoutMs bounds each
        // attempt.
        if (idempotent && hasTransientCode(cause) && attempt < this.maxRetries) {
          attempt += 1;
          await this.sleep(this.retryDelayMs * attempt);
          continue;
        }
        throw this.toNetworkError(method, url, cause);
      }

      // An injected transport may resolve with anything; a malformed HttpResponse would
      // otherwise surface below as a raw TypeError, outside the FimError contract.
      const invalid = responseProblem(response);
      if (invalid !== undefined) {
        throw new FimNetworkError(
          `${method} ${redactUrl(url)} failed: the transport returned an invalid response (${invalid}).`,
        );
      }
      const status = response.status;
      const responseHeaders = plainHeaders(response.headers);
      // fetch gives a Uint8Array; view it as a Buffer (no copy), which the decoders expect.
      const body = bodyBytes(response.body) as Buffer;
      // The size cap holds whatever the transport did: the default one aborts early, a
      // custom one may have read everything.
      if (this.maxResponseBytes > 0 && body.byteLength > this.maxResponseBytes) {
        throw new FimNetworkError(sizeLimitMessage(this.maxResponseBytes));
      }

      const retryable = status === 429 || status === 503;
      // A Retry-After beyond MAX_RETRY_AFTER_MS is not retried: the error below surfaces at
      // once and names the wait the server asked for.
      const retryAfter = retryable ? parseRetryAfter(responseHeaders["retry-after"]) : undefined;
      const tooLong = retryAfter !== undefined && retryAfter > MAX_RETRY_AFTER_MS;
      if (idempotent && retryable && !tooLong && attempt < this.maxRetries) {
        attempt += 1;
        // Back off linearly from retryDelayMs. A Retry-After can ask for longer, never for
        // less: `Retry-After: 0` or a date in the past turned the retries into a zero-delay
        // burst against a server that had just asked for less load.
        const backoff = this.retryDelayMs * attempt;
        await this.sleep(retryAfter === undefined ? backoff : Math.max(retryAfter, backoff));
        continue;
      }

      const contentType = String(responseHeaders["content-type"] ?? "");
      if (status < 200 || status >= 300) {
        const location = responseHeaders["location"];
        throw this.toApiError(method, url, status, body, typeof location === "string" ? location : undefined, {
          retries: attempt,
          ...(tooLong ? { retryAfterMs: retryAfter } : {}),
        });
      }

      return { data: body, contentType, status };
    }
  }

  /**
   * A transport failure as the library's error. The default transport rejects with
   * FimNetworkError only, which passes through; an injected one may throw anything — a
   * plain Error, fetch's TypeError, a string, null. That becomes a FimNetworkError naming
   * the request (URL redacted), with the original as `cause`, so a caller (and the CLI)
   * can rely on every failure being a FimError. Any other FimError passes through.
   */
  private toNetworkError(method: string, url: string, cause: unknown): FimError {
    if (cause instanceof FimError && !(cause instanceof FimNetworkError)) return cause;
    if (cause instanceof FimNetworkError) {
      // The default transport's own errors carry no URL; scrub one that does anyway.
      const scrubbed = this.scrubCause(cause);
      if (scrubbed === cause) return cause;
      return new FimNetworkError(this.scrub(cause.message), { cause: this.scrubCause(cause.cause) });
    }
    const reason = cause instanceof Error ? cause.message : String(cause);
    return new FimNetworkError(`${method} ${redactUrl(url)} failed: ${sanitizeServerText(this.scrub(reason))}`, {
      cause: this.scrubCause(cause),
    });
  }

  /** Perform a GET expecting JSON and parse it into `T`. */
  async getJson<T>(path: string, query?: QueryParams): Promise<T> {
    const res = await this.request("GET", path, { query, accept: "application/json" });
    const text = res.data.toString("utf8");
    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      throw new FimParseError(`Failed to parse JSON response from ${path}`, { cause });
    }
  }

  /** Perform a GET returning the raw bytes (XML / PDF / CSV downloads). */
  async getRaw(path: string, accept: string, query?: QueryParams): Promise<RawResponse> {
    return this.request("GET", path, { query, accept });
  }

  private toApiError(
    method: string,
    url: string,
    status: number,
    body: Buffer,
    locationHeader: string | undefined,
    retry: { retries: number; retryAfterMs?: number },
  ): FimApiError {
    const text = this.scrub(body.toString("utf8"));
    let detail: string | undefined;
    try {
      const parsed = JSON.parse(text) as { detail?: unknown };
      detail = formatDetail(parsed?.detail);
    } catch {
      // Non-JSON error body; leave detail undefined.
    }
    // `detail` came from the response body; strip control characters so a hostile
    // endpoint cannot inject terminal escape sequences via the stderr error message.
    if (detail !== undefined) detail = sanitizeServerText(detail);
    // Redirects are not followed; name the target so the user can fix --base-url.
    const location =
      status >= 300 && status < 400 && locationHeader ? redirectTarget(url, locationHeader) : undefined;
    return new FimApiError({
      status,
      url,
      method,
      body: text,
      detail,
      location,
      retries: retry.retries,
      ...(retry.retryAfterMs === undefined ? {} : { retryAfterMs: retry.retryAfterMs, maxRetryAfterMs: MAX_RETRY_AFTER_MS }),
    });
  }
}

/**
 * The absolute, printable form of a `Location` header: resolved against the request
 * URL, userinfo redacted, control/bidi characters stripped (it is server text bound
 * for stderr). An unparseable value is shown sanitised as it came.
 */
function redirectTarget(requestUrl: string, location: string): string | undefined {
  let target: string;
  try {
    target = redactUrl(new URL(location, requestUrl).href);
  } catch {
    target = location;
  }
  const clean = sanitizeServerText(target);
  return clean === "" ? undefined : clean;
}

/**
 * Turn the API's `detail` field into a human-readable string.
 *
 * The API uses two shapes:
 *   - a plain string (its own `ErrorMessage` bodies), and
 *   - an array of validation-error objects (FastAPI 422 responses), shaped like
 *     `{ loc: ["query", "gueltig_am"], msg: "Input should be a valid date" }`.
 * Returns `undefined` when there is nothing useful to surface.
 */
function formatDetail(detail: unknown): string | undefined {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (item && typeof item === "object") {
          const obj = item as { loc?: unknown; msg?: unknown };
          const loc = Array.isArray(obj.loc) ? obj.loc.join(".") : undefined;
          const msg = typeof obj.msg === "string" ? obj.msg : undefined;
          if (loc && msg) return `${loc}: ${msg}`;
          return msg ?? loc;
        }
        return typeof item === "string" ? item : undefined;
      })
      .filter((p): p is string => typeof p === "string" && p.length > 0);
    if (parts.length > 0) return parts.join("; ");
  }
  return undefined;
}
