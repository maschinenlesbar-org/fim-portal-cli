import { test } from "node:test";
import assert from "node:assert/strict";
import { TextDecoder } from "node:util";
import { MAX_RETRIES, MAX_RETRY_AFTER_MS, RequestEngine, cleartextProblem, parseRetryAfter, sanitizeServerText } from "../src/engine.js";
import { MAX_TIMEOUT_MS } from "../src/http.js";
import { FimApiError, FimNetworkError, FimParseError, FimValidationError, cutForMessage, cutText, redactUrl, toWellFormed } from "../src/errors.js";
import { makeMockTransport, jsonResponse, rawResponse } from "./helpers.js";

const noSleep = async (): Promise<void> => {};

// Built via char codes so no raw control bytes ever appear in this source file.
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const CSI = String.fromCharCode(0x9b); // a C1 control

/** True if the string contains any C0/C1 control char except tab/newline. */
function hasControlChars(s: string): boolean {
  return [...s].some((c) => {
    const n = c.charCodeAt(0);
    return n <= 8 || (n >= 0x0b && n <= 0x1f) || (n >= 0x7f && n <= 0x9f);
  });
}

test("getJson builds the URL with base + path + query and parses the body", async () => {
  const mt = makeMockTransport(() => jsonResponse({ items: [1, 2, 3] }));
  const engine = new RequestEngine({ transport: mt.transport, baseUrl: "https://example.test" });

  const result = await engine.getJson<{ items: number[] }>("/api/v1/schemas", {
    name: "Geburt",
    limit: 10,
  });

  assert.deepEqual(result, { items: [1, 2, 3] });
  assert.equal(mt.last().method, "GET");
  assert.equal(mt.last().url, "https://example.test/api/v1/schemas?name=Geburt&limit=10");
  assert.equal(mt.last().headers?.["Accept"], "application/json");
});

test("baseUrl trailing slashes are normalised", async () => {
  const mt = makeMockTransport(() => jsonResponse({}));
  const engine = new RequestEngine({ transport: mt.transport, baseUrl: "https://example.test/" });
  await engine.getJson("/api/v1/groups");
  assert.equal(mt.last().url, "https://example.test/api/v1/groups");
});

test("getRaw returns raw bytes and content-type and sends the requested Accept", async () => {
  const mt = makeMockTransport(() => rawResponse("<xml/>", "application/xml"));
  const engine = new RequestEngine({ transport: mt.transport });
  const res = await engine.getRaw("/x.xml", "application/xml");
  assert.equal(res.contentType, "application/xml");
  assert.equal(res.data.toString("utf8"), "<xml/>");
  assert.equal(mt.last().headers?.["Accept"], "application/xml");
});

test("non-2xx throws FimApiError carrying the parsed detail", async () => {
  const mt = makeMockTransport(() => jsonResponse({ detail: "Schema not found" }, 404));
  const engine = new RequestEngine({ transport: mt.transport, sleep: noSleep });

  await assert.rejects(
    () => engine.getJson("/api/v1/schemas/NOPE/1.0"),
    (err: unknown) => {
      assert.ok(err instanceof FimApiError);
      assert.equal(err.status, 404);
      assert.equal(err.detail, "Schema not found");
      return true;
    },
  );
});

test("error detail is stripped of terminal control characters", async () => {
  // ESC + CSI + BEL interleaved with printable text in the API `detail` field.
  const evil = `boom${ESC}[31mred${BEL}${CSI}2J`;
  const mt = makeMockTransport(() => jsonResponse({ detail: evil }, 500));
  const engine = new RequestEngine({ transport: mt.transport, sleep: noSleep, maxRetries: 0 });

  await assert.rejects(
    () => engine.getJson("/x"),
    (err: unknown) => {
      assert.ok(err instanceof FimApiError);
      // The control bytes are gone from both the structured detail and the
      // human-readable message that run.ts prints to stderr...
      assert.ok(!hasControlChars(err.detail ?? ""));
      assert.ok(!hasControlChars(err.message));
      // ...while the printable characters are preserved.
      assert.equal(err.detail, "boom[31mred2J");
      return true;
    },
  );
});

test("error detail loses bidi controls and line breaks, so it cannot reorder or forge lines", async () => {
  const RLO = String.fromCharCode(0x202e);
  const LRI = String.fromCharCode(0x2066);
  const detail = `bad ${ESC}]0;PWNED${BEL} line1\r\nError: forged\u2028x\t ${RLO}gnirts${LRI}`;
  const mt = makeMockTransport(() => jsonResponse({ detail }, 404));
  const engine = new RequestEngine({ transport: mt.transport, maxRetries: 0 });
  await assert.rejects(
    () => engine.getJson("/x"),
    (err: unknown) => {
      assert.ok(err instanceof FimApiError);
      assert.equal(err.detail, "bad ]0;PWNED line1 Error: forged x gnirts");
      assert.ok(!/[\n\r\u2028\u202e\u2066]/.test(err.message));
      return true;
    },
  );
});

test("sanitizeServerText keeps ordinary text, umlauts and single spaces", () => {
  assert.equal(sanitizeServerText("  Could not find  language 'de-DE'. Größe  "), "Could not find language 'de-DE'. Größe");
});

test("retries transient 429 then succeeds", async () => {
  let calls = 0;
  const mt = makeMockTransport(() => {
    calls += 1;
    return calls < 3 ? jsonResponse({ detail: "slow down" }, 429) : jsonResponse({ ok: true });
  });
  const engine = new RequestEngine({ transport: mt.transport, sleep: noSleep, maxRetries: 2 });

  const result = await engine.getJson<{ ok: boolean }>("/api/v1/schemas");
  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 3);
});

test("gives up after maxRetries and throws the last error", async () => {
  let calls = 0;
  const mt = makeMockTransport(() => {
    calls += 1;
    return jsonResponse({ detail: "still 503" }, 503);
  });
  const engine = new RequestEngine({ transport: mt.transport, sleep: noSleep, maxRetries: 2 });

  await assert.rejects(
    () => engine.getJson("/api/v1/schemas"),
    (err: unknown) => err instanceof FimApiError && err.status === 503,
  );
  assert.equal(calls, 3); // initial + 2 retries
});

// ---- Retry-After ----

function retryingEngine(retryAfter: string | undefined, maxRetries = 2) {
  const delays: number[] = [];
  const mt = makeMockTransport(() => ({
    status: 429,
    headers: {
      "content-type": "application/json",
      ...(retryAfter === undefined ? {} : { "retry-after": retryAfter }),
    },
    body: Buffer.from(JSON.stringify({ detail: "slow down" })),
  }));
  const engine = new RequestEngine({
    transport: mt.transport,
    maxRetries,
    sleep: async (ms) => {
      delays.push(ms);
    },
  });
  return { engine, mt, delays };
}

test("a 429 with Retry-After in seconds waits that long before each retry", async () => {
  const { engine, mt, delays } = retryingEngine("1");
  await assert.rejects(() => engine.getJson("/x"), (e: unknown) => e instanceof FimApiError && e.status === 429);
  assert.equal(mt.calls.length, 3);
  assert.deepEqual(delays, [1000, 1000]);
});

test("without a usable Retry-After the retries back off linearly", async () => {
  for (const header of [undefined, "", "-1", "1.5", "soon", "1e3", "2026-09-26T10:00:00Z"]) {
    const { engine, delays } = retryingEngine(header);
    await assert.rejects(() => engine.getJson("/x"));
    assert.deepEqual(delays, [200, 400], String(header));
  }
});

test("a Retry-After above MAX_RETRY_AFTER_MS is not retried: the error surfaces at once", async () => {
  for (const header of ["31", "99999999999999999999", "Fri, 31 Dec 9999 23:59:59 GMT"]) {
    const { engine, mt, delays } = retryingEngine(header);
    await assert.rejects(
      () => engine.getJson("/x"),
      (e: unknown) =>
        e instanceof FimApiError &&
        e.status === 429 &&
        e.retries === 0 &&
        e.retryAfterMs !== undefined &&
        /: slow down; the server asked to retry after \d+ s, longer than the 30 s the client waits; not retried/.test(e.message),
    );
    assert.equal(mt.calls.length, 1, header);
    assert.deepEqual(delays, [], header);
  }
});

test("an error after retries says how many ran", async () => {
  const { engine } = retryingEngine("1");
  await assert.rejects(
    () => engine.getJson("/x"),
    (e: unknown) => e instanceof FimApiError && e.retries === 2 && / \(after 2 retries\)$/.test(e.message),
  );
});

test("parseRetryAfter reads delay-seconds and IMF-fixdate HTTP-dates", () => {
  const now = Date.parse("Sat, 26 Sep 2026 10:00:00 GMT");
  assert.equal(parseRetryAfter("0", now), 0);
  assert.equal(parseRetryAfter(" 30 ", now), 30_000);
  assert.equal(parseRetryAfter(["2", "9"], now), 2000);
  assert.equal(parseRetryAfter("Sat, 26 Sep 2026 10:00:05 GMT", now), 5000);
  assert.equal(parseRetryAfter("Sat, 26 Sep 2026 09:00:00 GMT", now), 0); // past date: retry now
  for (const bad of [undefined, "", "-1", "+5", "1.5", "1e3", "0x10", "Saturday, 26-Sep-26 10:00:05 GMT"]) {
    assert.equal(parseRetryAfter(bad, now), undefined, String(bad));
  }
  assert.equal(MAX_RETRY_AFTER_MS, 30_000);
});

test("invalid JSON in a 2xx response throws FimParseError", async () => {
  const mt = makeMockTransport(() => ({
    status: 200,
    headers: { "content-type": "application/json" },
    body: Buffer.from("not json{"),
  }));
  const engine = new RequestEngine({ transport: mt.transport });
  await assert.rejects(() => engine.getJson("/api/v1/schemas"), FimParseError);
});

test("a default maxResponseBytes is passed to the transport", async () => {
  const mt = makeMockTransport(() => jsonResponse({}));
  const engine = new RequestEngine({ transport: mt.transport });
  await engine.getJson("/x");
  assert.equal(mt.last().maxResponseBytes, 100 * 1024 * 1024);
});

test("a custom maxResponseBytes is forwarded to the transport", async () => {
  const mt = makeMockTransport(() => jsonResponse({}));
  const engine = new RequestEngine({ transport: mt.transport, maxResponseBytes: 4096 });
  await engine.getJson("/x");
  assert.equal(mt.last().maxResponseBytes, 4096);
});

test("maxResponseBytes=0 disables the cap (no value sent to transport)", async () => {
  const mt = makeMockTransport(() => jsonResponse({}));
  const engine = new RequestEngine({ transport: mt.transport, maxResponseBytes: 0 });
  await engine.getJson("/x");
  assert.equal(mt.last().maxResponseBytes, undefined);
});

test("FimApiError.isRetryable reflects 429/503", () => {
  const e1 = new FimApiError({ status: 429, url: "u", method: "GET", body: "" });
  const e2 = new FimApiError({ status: 404, url: "u", method: "GET", body: "" });
  assert.equal(e1.isRetryable, true);
  assert.equal(e2.isRetryable, false);
});

test("a non-http(s) base URL is rejected at construction, before any request", () => {
  for (const baseUrl of ["file:///etc/passwd", "ftp://example.org"]) {
    const mt = makeMockTransport(() => jsonResponse({}));
    assert.throws(
      () => new RequestEngine({ transport: mt.transport, baseUrl }),
      (err: unknown) =>
        err instanceof FimValidationError &&
        !(err instanceof FimNetworkError) &&
        err.message === 'Invalid baseUrl: Only "http:" and "https:" base URLs are supported.',
      baseUrl,
    );
    assert.equal(mt.calls.length, 0);
  }
});

test("an unparseable base URL is rejected at construction", () => {
  const mt = makeMockTransport(() => jsonResponse({}));
  assert.throws(
    () => new RequestEngine({ transport: mt.transport, baseUrl: "not a url" }),
    (err: unknown) =>
      err instanceof FimValidationError &&
      err.message === "Invalid baseUrl: Expected a valid absolute URL (e.g. https://fimportal.de).",
  );
  assert.equal(mt.calls.length, 0);
});

test("a base URL with a query or fragment is rejected at construction", () => {
  for (const baseUrl of ["https://example.test/?x=1", "https://example.test/#frag", "https://example.test?"]) {
    const mt = makeMockTransport(() => jsonResponse({}));
    assert.throws(
      () => new RequestEngine({ transport: mt.transport, baseUrl }),
      (err: unknown) =>
        err instanceof FimValidationError &&
        err.message === "Invalid baseUrl: A base URL cannot have a query (?) or fragment (#).",
      baseUrl,
    );
    assert.equal(mt.calls.length, 0);
  }
});

test("redactUrl hides userinfo and leaves other URLs alone", () => {
  assert.equal(redactUrl("https://u:p@example.test/a?b=1"), "https://***@example.test/a?b=1");
  assert.equal(redactUrl("https://token@example.test/"), "https://***@example.test/");
  assert.equal(redactUrl("https://example.test/a b"), "https://example.test/a b");
  assert.equal(redactUrl("not a url"), "not a url");
  const err = new FimApiError({ status: 500, url: "https://u:p@example.test/x", method: "GET", body: "" });
  assert.equal(err.url, "https://***@example.test/x");
  assert.ok(!err.message.includes("u:p"));
});

test("a 3xx names the redirect target instead of a bare status", async () => {
  const cases: Array<[string | undefined, string]> = [
    ["https://fimportal.de/api/v0/code-lists?limit=1", ": redirect to https://fimportal.de/api/v0/code-lists?limit=1 not followed"],
    ["/elsewhere", ": redirect to http://fimportal.de/elsewhere not followed"],
    ["https://u:p@evil.test/\u202ex", ": redirect to https://***@evil.test/%E2%80%AEx not followed"],
    [undefined, ": redirect not followed (no Location header)"],
  ];
  for (const [location, suffix] of cases) {
    const mt = makeMockTransport(() => ({
      status: 301,
      headers: location === undefined ? {} : { location },
      body: Buffer.alloc(0),
    }));
    const engine = new RequestEngine({ transport: mt.transport, baseUrl: "http://fimportal.de" });
    await assert.rejects(
      () => engine.getJson("/api/v0/code-lists", { limit: 1 }),
      (err: unknown) => {
        assert.ok(err instanceof FimApiError);
        assert.equal(err.message, `HTTP 301 for GET http://fimportal.de/api/v0/code-lists?limit=1${suffix}`);
        return true;
      },
      String(location),
    );
    assert.equal(mt.calls.length, 1); // still not followed
  }
});

test("buildUrl rejects an empty path segment as a backstop, before any request", () => {
  const engine = new RequestEngine({ transport: async () => { throw new Error("no request expected"); } });
  for (const path of ["/api/v1/schemas/", "/api/v1/schemas//1.0", "api/v0/processes/P1//101/17"]) {
    assert.throws(
      () => engine.buildUrl(path),
      (err: unknown) => err instanceof FimValidationError && /an empty segment cannot be used as an id/.test((err as Error).message),
      path,
    );
  }
  assert.equal(engine.buildUrl("/api/v1/schemas"), "https://fimportal.de/api/v1/schemas");
});

test("the constructor range-checks the numeric options before any request", () => {
  for (const [options, message] of [
    [{ timeoutMs: -1 }, "Invalid timeoutMs: Must be >= 0."],
    [{ timeoutMs: MAX_TIMEOUT_MS + 1 }, `Invalid timeoutMs: Must be <= ${MAX_TIMEOUT_MS}.`],
    [{ maxRetries: MAX_RETRIES + 1 }, `Invalid maxRetries: Must be <= ${MAX_RETRIES}.`],
    [{ maxRetries: NaN }, "Invalid maxRetries: Expected an integer."],
    [{ retryDelayMs: -5 }, "Invalid retryDelayMs: Must be >= 0."],
    [{ retryDelayMs: Infinity }, "Invalid retryDelayMs: Expected an integer."],
    [{ retryDelayMs: MAX_RETRY_AFTER_MS + 1 }, `Invalid retryDelayMs: Must be <= ${MAX_RETRY_AFTER_MS}.`],
    [{ maxResponseBytes: 0.5 }, "Invalid maxResponseBytes: Expected an integer."],
  ] as const) {
    assert.throws(
      () => new RequestEngine({ ...options, transport: async () => jsonResponse({}) }),
      (err: unknown) => err instanceof FimValidationError && (err as Error).message === message,
      JSON.stringify(options),
    );
  }
  assert.equal(MAX_RETRIES, 10);
  // 0 keeps its documented meaning (no timeout, no retries, no backoff, no cap).
  new RequestEngine({ timeoutMs: 0, maxRetries: 0, retryDelayMs: 0, maxResponseBytes: 0 });
  new RequestEngine({ timeoutMs: MAX_TIMEOUT_MS, maxRetries: MAX_RETRIES });
});

test("a JSON body is decoded by its declared charset, BOM dropped; an unknown charset is a FimParseError", async () => {
  const text = "Müller µg/l";
  for (const [charset, body] of [
    ["iso-8859-1", Buffer.from(JSON.stringify({ name: text }), "latin1")],
    ["utf-8", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify({ name: text }))])],
  ] as const) {
    const engine = new RequestEngine({
      transport: async () => rawResponse(body, `application/json; charset=${charset}`),
    });
    assert.deepEqual(await engine.getJson("/x"), { name: text }, charset);
  }
  const engine = new RequestEngine({ transport: async () => rawResponse("{}", "application/json; charset=x-klingon") });
  await assert.rejects(engine.getJson("/x"), (e: unknown) => e instanceof FimParseError && /^GET https:\/\/fimportal\.de\/x: unsupported response charset "x-klingon"\.$/.test((e as Error).message));
});

test("server text in an error message is cut at 500 characters; the body keeps it all", async () => {
  const detail = "x".repeat(200_000);
  const engine = new RequestEngine({ transport: async () => jsonResponse({ detail }, 500), maxRetries: 0 });
  await assert.rejects(engine.getJson("/x"), (e: unknown) => {
    assert.ok(e instanceof FimApiError);
    assert.equal(e.detail, `${"x".repeat(500)}…`);
    assert.ok(e.message.length < 700, String(e.message.length));
    assert.equal(e.body.length, JSON.stringify({ detail }).length);
    return true;
  });
});

test("cutText never cuts inside a surrogate pair; toWellFormed replaces half a character", () => {
  assert.equal(cutText("ab\u{1f600}cd", 3), "ab");
  assert.equal(cutText("ab\u{1f600}cd", 4), "ab\u{1f600}");
  assert.equal(cutText("short", 10), "short");
  assert.equal(toWellFormed("a\ud83d b\ude00 \u{1f600}"), "a\ufffd b\ufffd \u{1f600}");
  // cutForMessage (500) uses it too.
  assert.equal(toWellFormed(cutForMessage("a" + "\u{1f600}".repeat(400))), cutForMessage("a" + "\u{1f600}".repeat(400)));
});

test("a server detail cut at 500 characters keeps the message well-formed", async () => {
  for (const detail of ["\u{1f600}".repeat(400), "a" + "\u{1f600}".repeat(400)]) {
    const engine = new RequestEngine({ transport: async () => jsonResponse({ detail }, 500), maxRetries: 0 });
    await assert.rejects(engine.getJson("/x"), (e: unknown) => {
      assert.ok(e instanceof FimApiError);
      assert.equal(toWellFormed(e.message), e.message);
      assert.match(e.detail ?? "", /…$/);
      return true;
    });
  }
});

test("own messages quote a server or user value at most 500 characters long (L3)", async () => {
  const charset = `x${"y".repeat(10_000)}`;
  const engine = new RequestEngine({ transport: async () => rawResponse("{}", `application/json; charset=${charset}`) });
  await assert.rejects(engine.getJson("/x"), (e: unknown) => e instanceof FimParseError && e.message.length < 700 && /charset "xy+…"/.test(e.message));
  const id = "i".repeat(10_000);
  assert.throws(() => engine.buildUrl(`/api/v1/fields/${id}/..`), (e: unknown) => e instanceof FimValidationError && e.message.length < 700);
  assert.throws(() => engine.buildUrl(`/api/v1/fields/${id}//x`), (e: unknown) => e instanceof FimValidationError && e.message.length < 700);
});

test("credentials a server echoes are scrubbed from the error: Basic, user:password, password (L13)", async () => {
  // Node sends the pair UTF-8 encoded (the Authorization header it builds from the URL), so that is the form a server echoes.
  const basic = Buffer.from("alice:pa ss-pw", "utf8").toString("base64");
  const engine = new RequestEngine({
    baseUrl: "https://alice:pa%20ss-pw@mirror.example",
    maxRetries: 0,
    transport: makeMockTransport(() => jsonResponse({ detail: `no: Basic ${basic} / alice:pa ss-pw / pa ss-pw` }, 401)).transport,
  });
  await assert.rejects(engine.getJson("/x"), (err: unknown) => {
    assert.ok(err instanceof FimApiError);
    for (const form of [basic, "alice:pa ss-pw", "pa ss-pw"]) assert.ok(!err.message.includes(form), err.message);
    assert.match(err.message, /no: Basic \*\*\* \/ \*\*\* \/ \*\*\*/);
    for (const form of [basic, "alice:pa ss-pw", "pa ss-pw"]) assert.ok(!err.body.includes(form), err.body);
    return true;
  });
});

test("an invalid Date in a filter is a FimValidationError, not a raw RangeError", async () => {
  const mt = makeMockTransport(() => jsonResponse({ items: [], total_count: 0 }));
  const engine = new RequestEngine({ transport: mt.transport });
  for (const query of [{ updated_since: new Date("garbage") }, { updated_since: [new Date(NaN)] }]) {
    assert.throws(
      () => engine.buildUrl("/x", query),
      (e: unknown) => e instanceof FimValidationError && e.message === "Invalid updated_since: Expected a valid date.",
    );
  }
  assert.equal(mt.calls.length, 0);
});

test("cleartextProblem: exact wording, host with port, loopback range, never the secret", () => {
  assert.equal(cleartextProblem("http://mirror.example:8080/api"), "requests to mirror.example:8080 are sent unencrypted (http:, not https:)");
  assert.equal(
    cleartextProblem("http://alice:pw@mirror.example"),
    "the base URL's credentials are sent unencrypted to mirror.example (http:, not https:)",
  );
  assert.equal(
    cleartextProblem("http://alice:pw@mirror.example", ["the API key"]),
    "the API key and the base URL's credentials are sent unencrypted to mirror.example (http:, not https:)",
  );
  assert.equal(cleartextProblem("http://mirror.example", ["the login"]), "the login is sent unencrypted to mirror.example (http:, not https:)");
  for (const url of ["https://alice:pw@mirror.example", "http://127.8.9.10", "http://localhost:1", "http://[::1]/", "not a url"]) {
    assert.equal(cleartextProblem(url), undefined, url);
  }
  assert.notEqual(cleartextProblem("http://128.0.0.1"), undefined);
});

test("onRetry is called once per retry, with the event fields, right before the sleep", async () => {
  const log: string[] = [];
  const events: unknown[] = [];
  let n = 0;
  const mt = makeMockTransport(() =>
    n++ < 2
      ? { status: 503, headers: n === 1 ? { "retry-after": "2" } : {}, body: Buffer.from("{}") }
      : jsonResponse({ ok: 1 }),
  );
  const e = new RequestEngine({
    transport: mt.transport,
    baseUrl: "https://user:pw@example.test",
    maxRetries: 3,
    sleep: async (ms) => void log.push(`sleep ${ms}`),
    onRetry: (ev) => {
      events.push(ev);
      log.push("retry");
    },
  });
  await e.getJson("/x");
  assert.deepEqual(log, ["retry", "sleep 2000", "retry", "sleep 400"]);
  assert.deepEqual(events, [
    { retry: 1, maxRetries: 3, delayMs: 2000, status: 503, url: "https://***@example.test/x" },
    { retry: 2, maxRetries: 3, delayMs: 400, status: 503, url: "https://***@example.test/x" },
  ]);
});

test("onRetry reports a reset connection without a status", async () => {
  let n = 0;
  const events: unknown[] = [];
  const mt = makeMockTransport(() => {
    if (n++ === 0) throw Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    return jsonResponse({ ok: 1 });
  });
  const e = new RequestEngine({ transport: mt.transport, sleep: async () => {}, onRetry: (ev) => void events.push(ev) });
  await e.getJson("/x");
  assert.equal(events.length, 1);
  assert.equal((events[0] as { status?: number }).status, undefined);
  assert.equal((events[0] as { retry: number }).retry, 1);
});

test("onRetry is never called without a retry, and a throw in it is swallowed", async () => {
  const events: unknown[] = [];
  const onRetry = (ev: unknown) => void events.push(ev);
  const ok = new RequestEngine({ transport: makeMockTransport(() => jsonResponse({ ok: 1 })).transport, sleep: async () => {}, onRetry });
  await ok.getJson("/x");
  const notFound = new RequestEngine({
    transport: makeMockTransport(() => ({ status: 404, headers: { "content-type": "application/json" }, body: Buffer.from('{"detail":"no"}') })).transport,
    sleep: async () => {},
    onRetry,
  });
  await assert.rejects(notFound.getJson("/x"), FimApiError);
  // retries exhausted: the last 503 is an error, not a retry
  const down = new RequestEngine({
    transport: makeMockTransport(() => ({ status: 503, headers: {}, body: Buffer.from("{}") })).transport,
    maxRetries: 1,
    sleep: async () => {},
    onRetry,
  });
  await assert.rejects(down.getJson("/x"), FimApiError);
  assert.equal(events.length, 1);
  // a Retry-After over the cap is not retried
  const long = new RequestEngine({
    transport: makeMockTransport(() => ({ status: 503, headers: { "retry-after": "999999" }, body: Buffer.from("{}") })).transport,
    sleep: async () => {},
    onRetry,
  });
  await assert.rejects(long.getJson("/x"), FimApiError);
  assert.equal(events.length, 1);
  let n = 0;
  const throwing = new RequestEngine({
    transport: makeMockTransport(() => (n++ === 0 ? { status: 503, headers: {}, body: Buffer.from("{}") } : jsonResponse({ ok: 1 }))).transport,
    sleep: async () => {},
    onRetry: () => {
      throw new Error("boom");
    },
  });
  await throwing.getJson("/x");
});

test("onRetry must be a function", () => {
  assert.throws(() => new RequestEngine({ onRetry: 5 as never }), FimValidationError);
});

test("a number JSON.parse can't carry exactly is a FimParseError, never a changed value", async () => {
  const inexact = [
    "12345678901234567890", "-9007199254740993", "1e400", "-1E400", "12345678901234567890.0", "9007199254740993e0",
    "90071992547409930E-1", "9007199254740992.5", "1e-400", "-0.0001e-399", "123456789012345678901234567890",
    // D4: below the smallest normal double a subnormal must print as written.
    "3e-324", "4e-324", "-4.9e-324", "1.2345678901234567e-310", "2.225073858507201e-309",
  ];
  for (const literal of inexact) {
    const engine = new RequestEngine({ transport: makeMockTransport(() => rawResponse(`{"items":[],"total_count":${literal}}`, "application/json")).transport });
    await assert.rejects(
      engine.getJson("/api/v1/schemas"),
      (e: unknown) =>
        e instanceof FimParseError &&
        e.message === `GET https://fimportal.de/api/v1/schemas: the number ${literal} cannot be represented exactly.`,
      literal,
    );
  }
  // A subnormal printed in its shortest form, and the smallest normal double, pass (D4).
  for (const literal of ["5e-324", "-5e-324", "1e-310", "2.2250738585072014e-308"]) {
    const engine = new RequestEngine({ transport: makeMockTransport(() => rawResponse(`{"items":[],"total_count":${literal}}`, "application/json")).transport });
    assert.equal(((await engine.getJson("/api/v1/schemas")) as { total_count: number }).total_count, Number(literal), literal);
  }
});

test("a number a double carries exactly, and a decimal fraction below 2^53, pass unchanged", async () => {
  const exact: Array<[string, number]> = [
    ["0", 0], ["42", 42], ["9007199254740991", 9007199254740991], ["9007199254740992.0", 2 ** 53], ["1e21", 1e21],
    ["0.1", 0.1], ["-2.5e-3", -0.0025], ["5e-324", 5e-324], ["0.0e-500", 0],
    // A double a server printed in its shortest form reads back as that double and prints as the
    // same number: not a changed value, though the decimal is not the double's exact binary value.
    ["1e23", 1e23], ["100000000000000000000000", 1e23], ["1E23", 1e23], ["1.7976931348623157E308", Number.MAX_VALUE],
    ["-1.7976931348623157e308", -Number.MAX_VALUE], ["4.35e30", 4.35e30],
  ];
  for (const [literal, value] of exact) {
    const engine = new RequestEngine({ transport: makeMockTransport(() => rawResponse(`{"n":${literal},"s":"1e400 12345678901234567890"}`, "application/json")).transport });
    assert.deepEqual(await engine.getJson("/x"), { n: value, s: "1e400 12345678901234567890" }, literal);
  }
});

test("a timeout, the size cap, a refused connection and a DNS failure name the request, the original as cause", async () => {
  const base = "https://user:secret@example.test";
  const prefix = "GET https://***@example.test/api/v1/schemas?name=x failed: ";
  const enotfound = Object.assign(new Error("getaddrinfo ENOTFOUND example.test"), { code: "ENOTFOUND" });
  const failures: Array<[string, unknown]> = [
    ["Request timed out after 500ms", new FimNetworkError("Request timed out after 500ms")],
    ["Response exceeded the size limit of 10 bytes", new FimNetworkError("Response exceeded the size limit of 10 bytes")],
    ["connect ECONNREFUSED 127.0.0.1:1", new FimNetworkError("connect ECONNREFUSED 127.0.0.1:1", { cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), { code: "ECONNREFUSED" }) })],
    ["getaddrinfo ENOTFOUND example.test", new FimNetworkError("getaddrinfo ENOTFOUND example.test", { cause: enotfound })],
  ];
  for (const [reason, thrown] of failures) {
    const engine = new RequestEngine({ baseUrl: base, maxRetries: 0, transport: async () => { throw thrown; } });
    await assert.rejects(
      engine.getJson("/api/v1/schemas", { name: "x" }),
      (e: unknown) => e instanceof FimNetworkError && e.message === `${prefix}${reason}` && e.cause === thrown,
      reason,
    );
  }
  // The engine's own deadline and its own size check name the request too.
  const hanging = new RequestEngine({ baseUrl: base, timeoutMs: 5, transport: () => new Promise(() => {}) });
  await assert.rejects(hanging.getJson("/api/v1/schemas", { name: "x" }), (e: unknown) => e instanceof FimNetworkError && e.message === `${prefix}Request exceeded deadline of 5ms`);
  const big = new RequestEngine({ baseUrl: base, maxResponseBytes: 4, transport: async () => jsonResponse({ items: [] }) });
  await assert.rejects(
    big.getJson("/api/v1/schemas", { name: "x" }),
    (e: unknown) => e instanceof FimNetworkError && e.message === `${prefix}Response exceeded the size limit of 4 bytes (maxResponseBytes; --max-response-bytes on the CLI)`,
  );
});

test("a refused connection on loopback names the request (default transport)", async () => {
  const engine = new RequestEngine({ baseUrl: "http://127.0.0.1:1", maxRetries: 0 });
  await assert.rejects(engine.getJson("/x"), (e: unknown) => e instanceof FimNetworkError && /^GET http:\/\/127\.0\.0\.1:1\/x failed: .*ECONNREFUSED/.test(e.message) && e.cause instanceof FimNetworkError);
});

test("a header named __proto__ is an ordinary header, never the prototype of the headers read (T12)", async () => {
  // A JavaScript transport may return any object; JSON.parse makes "__proto__" an own key.
  const headers = JSON.parse('{"__proto__":{"content-type":"text/html"}}') as Record<string, string>;
  const e = new RequestEngine({ transport: async () => ({ status: 200, headers, body: Buffer.from("<html>") }) });
  // With the prototype set, "text/html" was read as the Content-Type and named in the message.
  await assert.rejects(e.getJson("/x"), (err: Error) => err instanceof FimParseError && !err.message.includes("text/html"));
  const fetchLike = new Headers([["__proto__", "x"], ["content-type", "application/json"]]);
  const f = new RequestEngine({ transport: async () => ({ status: 200, headers: fetchLike as unknown as Record<string, string>, body: Buffer.from('{"a":1}') }) });
  assert.deepEqual(await f.getJson("/x"), { a: 1 });
});

test("an answer error names the request: method and URL, userinfo redacted (D9)", async () => {
  const base = "https://alice:s3cr3t-pw@fimportal.example";
  const cases: Array<[() => HttpResponseLike, RegExp, (e: RequestEngine) => Promise<unknown>]> = [
    [() => ({ status: 200, headers: { "content-type": "text/html" }, body: Buffer.from("<html>") }), /^GET https:\/\/\*\*\*@fimportal\.example\/api\/v1\/schemas\?name=A: the answer is not valid JSON \(expected JSON, got Content-Type "text\/html"\)\.$/, (e) => e.getJson("/api/v1/schemas", { name: "A" })],
    [() => ({ status: 200, headers: { "content-type": "application/json" }, body: Buffer.from("  ") }), /^GET https:\/\/\*\*\*@fimportal\.example\/x: empty response body\.$/, (e) => e.getJson("/x")],
    [() => ({ status: 200, headers: { "content-type": "application/json" }, body: Buffer.from("[1e400]") }), /^GET https:\/\/\*\*\*@fimportal\.example\/x: the number 1e400 cannot be represented exactly\.$/, (e) => e.getJson("/x")],
    [() => ({ status: 200, headers: { "content-type": "application/json" }, body: Buffer.from("null") }), /^GET https:\/\/\*\*\*@fimportal\.example\/x: unexpected response shape \(HTTP 200\): expected an object, got null\.$/, (e) => e.getJson("/x", undefined, "record")],
    [() => ({ status: 200, headers: { "content-type": "application/json; charset=x-klingon" }, body: Buffer.from("{}") }), /^GET https:\/\/\*\*\*@fimportal\.example\/x: unsupported response charset "x-klingon"\.$/, (e) => e.getJson("/x")],
    [() => ({ status: 200, headers: { "content-type": "text/html" }, body: Buffer.from("<html>") }), /^GET https:\/\/\*\*\*@fimportal\.example\/x\.xml: expected application\/xml, got an HTML page \(Content-Type "text\/html"\)\.$/, (e) => e.getRaw("/x.xml", "application/xml")],
  ];
  for (const [respond, message, call] of cases) {
    const engine = new RequestEngine({ baseUrl: base, transport: async () => respond() });
    await assert.rejects(call(engine), (e: unknown) => e instanceof FimParseError && message.test(e.message) && !e.message.includes("s3cr3t"), String(message));
  }
});

type HttpResponseLike = { status: number; headers: Record<string, string>; body: Buffer };

test("text that is not valid is replaced with U+FFFD and reported through onWarning, never silently (D2)", async () => {
  const cases: Array<[string, Buffer, string, unknown, number]> = [
    // A lone surrogate written as an escape (high alone, low alone); a real pair and an escaped backslash stay.
    ["lone escapes", Buffer.from('{"a":"x\\ud800y","b":"\\udc00","c":"\\ud83d\\ude00","d":"\\\\ud800"}'), "application/json", { a: "x\ufffdy", b: "\ufffd", c: "\u{1f600}", d: "\\ud800" }, 2],
    // A lone surrogate in a member name.
    ["lone in a key", Buffer.from('{"\\udbff":1}'), "application/json", { "\ufffd": 1 }, 1],
    // Invalid UTF-8 bytes; a U+FFFD the server sent is not counted.
    ["invalid bytes", Buffer.concat([Buffer.from('{"a":"'), Buffer.from([0xff, 0xc3]), Buffer.from('","b":"\ufffd"}')]), "application/json", { a: "\ufffd\ufffd", b: "\ufffd" }, 2],
    // A byte undefined in a single-byte charset.
    ["iso-8859-3", Buffer.concat([Buffer.from('{"a":"'), Buffer.from([0xa5]), Buffer.from('"}')]), "application/json; charset=iso-8859-3", { a: "\ufffd" }, 1],
  ];
  for (const [label, body, type, expected, count] of cases) {
    const warnings: string[] = [];
    const e = new RequestEngine({ onWarning: (m) => warnings.push(m), transport: makeMockTransport(() => rawResponse(body, type)).transport });
    const value = await e.getJson("/items", { q: "x" });
    assert.deepEqual(value, expected, label);
    assert.ok(!/[\ud800-\udfff]/u.test(JSON.stringify(value)), `${label}: well-formed`);
    assert.deepEqual(warnings, [
      `GET https://fimportal.de/items?q=x: ${count} ${count === 1 ? "character" : "characters"} of the answer ${count === 1 ? "was" : "were"} not valid text (invalid bytes or a lone surrogate) and replaced with U+FFFD.`,
    ], label);
  }
  // Valid text: no warning; a throwing hook never fails the request.
  const quiet: string[] = [];
  const ok = new RequestEngine({ onWarning: (m) => quiet.push(m), transport: makeMockTransport(() => rawResponse('{"a":"\\u00fc\ufffd"}', "application/json")).transport });
  assert.deepEqual(await ok.getJson("/x"), { a: "ü\ufffd" });
  assert.deepEqual(quiet, []);
  const throwing = new RequestEngine({ onWarning: () => { throw new Error("hook"); }, transport: makeMockTransport(() => rawResponse('"\\ud800"', "application/json")).transport });
  assert.equal(await throwing.getJson("/x"), "\ufffd");
  assert.throws(() => new RequestEngine({ onWarning: "log" as unknown as () => void }), FimValidationError);
});

test("an answer longer than V8's longest string is a FimParseError naming the request, not a plain Error (T14)", async (t) => {
  // A real one needs a body of 512 MB and more (possible with maxResponseBytes 0): V8's own
  // error is stood in for, for the body marked by its length.
  const huge = Buffer.from('{"items":[],"total_count":0}   ');
  const tooLong = Object.assign(new Error("Cannot create a string longer than 0x1fffffe8 characters"), { code: "ERR_STRING_TOO_LONG" });
  const decode = TextDecoder.prototype.decode;
  t.mock.method(TextDecoder.prototype, "decode", function (this: InstanceType<typeof TextDecoder>, input?: Uint8Array, options?: { stream?: boolean }) {
    if (input !== undefined && input.byteLength === huge.length) throw tooLong;
    return decode.call(this, input, options);
  });
  const toString = Buffer.prototype.toString;
  t.mock.method(Buffer.prototype, "toString", function (this: Buffer, ...args: Parameters<Buffer["toString"]>) {
    if (this.length === huge.length && args[0] === "utf8") throw tooLong;
    return toString.apply(this, args);
  });
  const e = new RequestEngine({ maxResponseBytes: 0, transport: makeMockTransport(() => rawResponse(huge, "application/json")).transport });
  await assert.rejects(e.getJson("/api/v1/schemas", { name: "A" }), (err: unknown) => {
    assert.ok(err instanceof FimParseError, String(err));
    assert.equal(
      err.message,
      `GET https://fimportal.de/api/v1/schemas?name=A: the answer is too large to read as text (${huge.length} bytes; the longest string is 536870888 characters).`,
    );
    return true;
  });
  // An error status with such a body is still the API error, without the unreadable body.
  const failing = new RequestEngine({ maxResponseBytes: 0, maxRetries: 0, transport: makeMockTransport(() => rawResponse(huge, "text/plain", 500)).transport });
  await assert.rejects(failing.getJson("/x"), (err: unknown) => err instanceof FimApiError && err.status === 500 && err.body === "");
});
