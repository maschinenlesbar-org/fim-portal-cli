import { test } from "node:test";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { TextDecoder, inspect } from "node:util";
import { MAX_RETRIES, MAX_RETRY_AFTER_MS, RequestEngine, bigIntegerKeysOption, cleartextProblem, firstInexactNumber, parseRetryAfter, responseShapeProblem, sanitizeServerText, scanNumbers } from "../src/engine.js";
import { MAX_TIMEOUT_MS } from "../src/http.js";
import { FimApiError, FimNetworkError, FimParseError, FimValidationError, TextBuilder, credentialsIn, cutForMessage, cutText, echoedCredentialForms, redactUrl, redactUrlUserinfo, toWellFormed, typedUrlCredentials } from "../src/errors.js";
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
      // ...whole escape sequences with them, while the printable text is preserved.
      assert.equal(err.detail, "boomred");
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
      assert.equal(err.detail, "bad line1 Error: forged x gnirts");
      assert.ok(!/[\n\r\u2028\u202e\u2066]/.test(err.message));
      return true;
    },
  );
});

test("sanitizeServerText keeps ordinary text, umlauts and single spaces", () => {
  assert.equal(sanitizeServerText("  Could not find  language 'de-DE'. Größe  "), "Could not find language 'de-DE'. Größe");
});

test("sanitizeServerText drops whole escape sequences, not just their control bytes", () => {
  const OSC8 = String.fromCharCode(0x9d);
  const ST8 = String.fromCharCode(0x9c);
  for (const [input, expected] of [
    [`line1 ${ESC}]0;title${BEL}rest`, "line1 rest"],
    [`${ESC}]8;;https://evil.example${ESC}\\click${ESC}]8;;${ESC}\\`, "click"],
    [`${ESC}[31mred${ESC}[0m plain`, "red plain"],
    [`${ESC}[1;31;4mbold`, "bold"],
    [`${CSI}2Jcleared`, "cleared"],
    [`${OSC8}0;t${ST8}ok`, "ok"],
    [`a${ESC}7b${ESC}(Bc`, "abc"],
    // Unterminated: only ESC and its introducer go, the text stays.
    [`keep ${ESC}]0;no terminator here`, "keep 0;no terminator here"],
  ] as const) {
    assert.equal(sanitizeServerText(input), expected, JSON.stringify(input));
  }
});

test("sanitizeServerText drops invisible format characters (zero-width, soft hyphen, BOM)", () => {
  const text = "real\u200b error\u2028Error: forged\u2066x\u2069 \ufeffend\u00ad\u200d\u2060!";
  assert.equal(sanitizeServerText(text), "real error Error: forgedx end!");
});

test("sanitizeServerText reads a bounded prefix and drops what the per-character filter dropped (C)", () => {
  // The filter it replaces, one character at a time: C0 but TAB to CR, DEL, C1 and Cf go.
  const perCharacter = (text: string): string =>
    [...text]
      .filter((ch) => {
        const n = ch.codePointAt(0) ?? 0;
        return (n >= 0x09 && n <= 0x0d) || !(n <= 0x1f || (n >= 0x7f && n <= 0x9f) || /\p{Cf}/u.test(ch));
      })
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  const every = Array.from({ length: 0x3000 }, (_, i) => String.fromCharCode(i)).join("") + "\u{1f600}\u{e0001}\ud800x";
  for (let at = 0; at < every.length; at += 512) {
    const piece = every.slice(at, at + 512).replace(/[\u001b\u0090\u0098\u009b-\u009f]/g, "");
    assert.equal(sanitizeServerText(piece), perCharacter(piece), `from U+${at.toString(16)}`);
  }
  // At most 16 384 units of the text are read, never half a surrogate pair.
  assert.equal(sanitizeServerText("x".repeat(100_000)).length, 16_384);
  assert.equal(sanitizeServerText(`${"x".repeat(16_383)}\u{1f600}`), "x".repeat(16_383));
  // A control string ends at another introducer: the first is dropped by the filter, the second
  // string as a whole.
  const OSC8 = String.fromCharCode(0x9d);
  const ST8 = String.fromCharCode(0x9c);
  assert.equal(sanitizeServerText(`a${OSC8}0;x${OSC8}0;t${ST8}b`), "a0;xb");
  assert.equal(sanitizeServerText(`a${ESC}]0;x${ESC}]0;t${BEL}b`), "a0;xb");
});

test("an error answer of unterminated control-string introducers is cleaned in linear time (C)", async () => {
  // 100 000 × U+009D took about 16 s with an escape-sequence regex whose body admitted them.
  for (const opener of ["\\u009d", "\\u0090", "\\u0098", "\\u009e", "\\u009f", "\\u001b]"]) {
    const engine = new RequestEngine({ transport: makeMockTransport(() => rawResponse(`{"detail":"${opener.repeat(100_000)} tail"}`, "application/json", 500)).transport, maxRetries: 0 });
    const start = performance.now();
    const err = await engine.getJson("/x").catch((caught: unknown) => caught);
    const ms = performance.now() - start;
    assert.ok(ms < 1000, `${opener}: ${Math.round(ms)} ms`);
    assert.ok(err instanceof FimApiError && !hasControlChars(err.message), String(err));
  }
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

test("a base URL with a backslash, or a scheme not followed by // and the host, is rejected at construction, never echoing the password (F, F4)", () => {
  // WHATWG ends an http(s) authority at "\\" and repairs `http:host`, `http:/host` and
  // `http:///host` silently into `http://host`: the host requested would not be the one typed.
  const backslash = 'A base URL cannot contain a backslash (\\); write "/" instead.';
  const form = 'Expected an absolute http(s) URL ("https://" and the host).';
  for (const [baseUrl, reason] of [
    ["https://alice:s3cret@api.example\\@evil.example", backslash],
    ["https://api.example\\evil", backslash],
    ["https:\\\\alice:s3cret@h.example", backslash],
    ["http:alice:s3cret@h.example", form],
    ["https:/alice:s3cret@h.example", form],
    ["http:///alice:s3cret@h.example", form],
    ["HTTPS:h.example/v1", form],
  ] as const) {
    const mt = makeMockTransport(() => jsonResponse({}));
    assert.throws(
      () => new RequestEngine({ transport: mt.transport, baseUrl }),
      (err: unknown) => err instanceof FimValidationError && err.message === `Invalid baseUrl: ${reason}` && !err.message.includes("s3cret"),
      baseUrl,
    );
    assert.equal(mt.calls.length, 0, baseUrl);
  }
  // A spelling the parser keeps as typed stays accepted: an upper-case scheme, an explicit port.
  for (const baseUrl of ["HTTPS://h.example/v1", "http://alice:pw@h.example:8080"]) {
    assert.doesNotThrow(() => new RequestEngine({ transport: makeMockTransport(() => jsonResponse({})).transport, baseUrl }), baseUrl);
  }
});

test("requests go to the base URL as WHATWG parses it, the reading every check makes (F)", async () => {
  for (const [baseUrl, sent] of [
    ["https://API.Example:443/v1", "https://api.example/v1/x"],
    ["https://alice:pw@api.example/v1/@evil.example", "https://alice:pw@api.example/v1/@evil.example/x"],
    ["https://h.example/fim//", "https://h.example/fim/x"],
  ] as const) {
    const mt = makeMockTransport(() => jsonResponse({}));
    await new RequestEngine({ transport: mt.transport, baseUrl }).getJson("/x");
    assert.equal(mt.last().url, sent, baseUrl);
  }
});

test("credentialsIn ends the authority of a special scheme at a backslash, as WHATWG does (F)", () => {
  for (const scheme of ["http", "https", "HTTPS", "ws", "wss", "ftp"]) {
    assert.deepEqual(credentialsIn(`${scheme}://u:p@a.example\\@b.example/x`), ["u:p"], scheme);
    assert.equal(new URL(`${scheme}://u:p@a.example\\@b.example/x`).password, "p", scheme);
  }
  // Another scheme's authority runs on to "/", "?" or "#".
  assert.deepEqual(credentialsIn("foo://u:p@a.example\\@b.example/x"), ["u:p@a.example\\"]);
  assert.deepEqual(credentialsIn("https://u:p@a.example/x\\@y"), ["u:p"]);
});

test("credentialsIn skips the slashes and backslashes WHATWG skips after a special scheme (F3)", () => {
  // `http:///u:pw@h`, `https:\\u:pw@h` and `http:u:pw@h` all carry `u:pw` for WHATWG; read
  // after "://", the userinfo was missed, so a refused --base-url echoed the password in clear.
  for (const value of [
    "http:alice:pw@h.example",
    "http:/alice:pw@h.example",
    "http:///alice:pw@h.example/x",
    "https:////alice:pw@h.example",
    "HTTPS:\\\\alice:pw@h.example",
    "wss:\\/alice:pw@h.example",
    "ftp:alice:pw@h.example",
  ]) {
    assert.deepEqual(credentialsIn(value), ["alice:pw"], value);
    assert.equal(new URL(value).password, "pw", value);
  }
  // Another scheme needs "//" before an authority: `foo:u:p@h` and `foo:///u:p@h` carry none.
  assert.deepEqual(credentialsIn("foo:u:p@h.example"), []);
  assert.deepEqual(credentialsIn("foo:///u:p@h.example"), []);
  assert.equal(new URL("foo:///u:p@h.example").password, "");
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

test("a credential of the base URL in a redirect's Location is scrubbed, in its path and its query (D2)", async () => {
  // The Location was resolved and only its own userinfo redacted: the base URL's password in its
  // path or query reached the message and `location`. Scrubbed as sent, before resolving
  // percent-encodes what is left of it in a new spelling (`'` as `%27` in a query).
  const pw = "pä\"s's-W0rd";
  const basic = Buffer.from(`alice:${pw}`, "utf8").toString("base64");
  const baseUrl = `https://alice:${encodeURIComponent(pw)}@mirror.example`;
  const decoded = (text: string): string => text.replace(/(?:%[0-9a-fA-F]{2})+/g, (run) => { try { return decodeURIComponent(run); } catch { return run; } });
  for (const location of [
    `https://elsewhere.example/login?user=alice&pw=${encodeURIComponent(pw)}`,
    `https://elsewhere.example/login?pw=${pw}`,
    `https://elsewhere.example/${encodeURIComponent(`alice:${pw}`)}/x`,
    `https://elsewhere.example/auth?basic=${basic}`,
    `/relative/${pw}`,
  ]) {
    const engine = new RequestEngine({ baseUrl, maxRetries: 0, transport: makeMockTransport(() => ({ status: 302, headers: { location }, body: Buffer.alloc(0) })).transport });
    const err = await engine.getJson("/x").catch((caught: unknown) => caught);
    assert.ok(err instanceof FimApiError && /^HTTP 302 /.test(err.message), String(err));
    assert.ok(err.location?.includes("***"), String(err.location));
    const seen = decoded(`${err.message}\n${err.location}`);
    for (const secret of [pw, `alice:${pw}`, basic]) assert.ok(!seen.includes(secret), `${location}: ${seen}`);
  }
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

test("bigIntegerKeys: a declared member's number is its exact literal as a string; others keep the rule (D3)", async () => {
  const body = '{"_version_":1858054135406919680,"small":{"_version_":5},"neg":{"\\u005fversion_":-12345678901234567890},' +
    '"s":{"_version_":"text"},"n":{"_version_":null},"arr":{"_version_":[1]},"t":"\\"_version_\\":1","n2":42}';
  const e = new RequestEngine({
    bigIntegerKeys: new Set(["_version_"]),
    transport: makeMockTransport(() => rawResponse(body, "application/json")).transport,
  });
  assert.deepEqual(await e.getJson("/x"), {
    _version_: "1858054135406919680", small: { _version_: "5" }, neg: { _version_: "-12345678901234567890" },
    s: { _version_: "text" }, n: { _version_: null }, arr: { _version_: [1] }, t: '"_version_":1', n2: 42,
  });
  assert.deepEqual([...e.bigIntegerKeys], ["_version_"]);
  // An undeclared big number is still refused; a declared member doesn't make others exact.
  const other = new RequestEngine({
    bigIntegerKeys: ["_version_"] as unknown as ReadonlySet<string>,
    transport: makeMockTransport(() => rawResponse('{"_version_":1858054135406919680,"id":12345678901234567890}', "application/json")).transport,
  });
  await assert.rejects(other.getJson("/x"), /the number 12345678901234567890 cannot be represented exactly/);
  // Malformed stays malformed: a declared member with a leading zero still fails JSON.parse.
  const malformed = new RequestEngine({ bigIntegerKeys: new Set(["_version_"]), transport: makeMockTransport(() => rawResponse('{"_version_":01}', "application/json")).transport });
  await assert.rejects(malformed.getJson("/x"), /not valid JSON/);
  for (const bad of [new Set([""]), new Set([1]), "x", 5, null]) {
    assert.throws(() => new RequestEngine({ bigIntegerKeys: bad as unknown as ReadonlySet<string> }),
      (err: unknown) => err instanceof FimValidationError && err.message === "Invalid option bigIntegerKeys: expected a set of non-empty member names.");
  }
  // The option reader copies a set or a list; undefined is none.
  const names = new Set(["a"]);
  const copy = bigIntegerKeysOption(names);
  names.add("b");
  assert.deepEqual([...copy], ["a"]);
  assert.deepEqual([...bigIntegerKeysOption(["x", "y"] as unknown as ReadonlySet<string>)], ["x", "y"]);
  assert.equal(bigIntegerKeysOption(undefined).size, 0);
  // Without declarations the scan is the plain number check.
  assert.equal(firstInexactNumber('{"a":"1e400","b":3e-324}'), "3e-324");
  assert.deepEqual(scanNumbers('{"a":1}'), { json: '{"a":1}', inexact: undefined });
});

test("a number with a long run of zeros is checked in linear time (A)", async () => {
  // The trailing-zero regex `/0+$/` tried a match at every zero of a run that doesn't end the
  // literal: 1.<100 000 zeros>1e300 took about 15 s. The zeros are counted with index loops now.
  const literal = `1.${"0".repeat(100_000)}1e300`;
  let inexact: string | undefined;
  assert.ok(elapsed(() => (inexact = firstInexactNumber(`{"x":${literal}}`))) < 1000);
  assert.equal(inexact, literal);
  const engine = new RequestEngine({ transport: makeMockTransport(() => rawResponse(`{"x":${literal}}`, "application/json")).transport });
  await assert.rejects(engine.getJson("/x"), (err: unknown) => err instanceof FimParseError && /cannot be represented exactly/.test(err.message) && err.message.length < 1000);
  // The same digits and exponent as before: zeros on both ends don't change the value.
  assert.equal(firstInexactNumber('{"a":100000000000000000000000,"b":0.000000e0,"c":1000.0e20}'), undefined);
  assert.equal(firstInexactNumber('{"a":12345678901234567890}'), "12345678901234567890");
});

function elapsed(work: () => unknown): number {
  const start = performance.now();
  work();
  return performance.now() - start;
}

test("redactUrlUserinfo hides every URL's userinfo in one linear pass, however many URLs (T15b)", () => {
  // The URL regex this replaces (a scheme tried at every word start) takes about 3 s on this.
  assert.ok(elapsed(() => redactUrlUserinfo("a.".repeat(30_000))) < 1000);
  assert.equal(redactUrlUserinfo("a -https://u:p@h/x and x-ftp://v@w?q, mail@example.org"), "a -https://***@h/x and x-ftp://***@w?q, mail@example.org");
  assert.equal(redactUrlUserinfo("1://u:p@h ://u:p@h"), "1://u:p@h ://u:p@h");
  assert.equal(redactUrlUserinfo("https://h/p?u=a@b"), "https://h/p?u=a@b");
  for (const text of ["a".repeat(1_000_000), "a.".repeat(500_000), "://".repeat(100_000), `https://${"u".repeat(1_000_000)}`]) {
    assert.equal(redactUrlUserinfo(text), text);
  }
  const many = redactUrlUserinfo("https://u:p@h ".repeat(100_000));
  assert.equal(many, "https://***@h ".repeat(100_000));
});


test("redactUrlUserinfo hides the userinfo of a URL glued onto the one before it, still linear (B2)", () => {
  // The authority read for the first `://` ends at the `/` of the second; the second URL starts
  // inside it (its scheme is the first one's host, or follows a redacted `@`), so the search goes
  // on after each `://`, not after the authority. The regex this replaces redacted both; the
  // first linear pass missed them.
  assert.equal(redactUrlUserinfo("https://host://u:p@h"), "https://host://***@h");
  assert.equal(redactUrlUserinfo("https://u:p@x://v:q@w"), "https://***@x://***@w");
  assert.equal(redactUrlUserinfo("see https://h.example:/x://u:p@h"), "see https://h.example:/x://***@h");
  assert.equal(redactUrlUserinfo("https://u:p@1://v:q@w"), "https://***@1://v:q@w");
  // Many glued URLs, unredacted and redacted, and long scheme-character runs: one pass each.
  const n = 100_000;
  for (const [text, want] of [
    [`${"a://".repeat(n)}u:p@h`, `${"a://".repeat(n)}***@h`],
    ["x://u:p@".repeat(n), "x://***@".repeat(n)],
    [`${"a.".repeat(500_000)}://u:p@h`, `${"a.".repeat(500_000)}://***@h`],
    [`https://${"a.".repeat(500_000)}://u:p@h`, `https://${"a.".repeat(500_000)}://***@h`],
    ["a:".repeat(500_000), "a:".repeat(500_000)],
  ] as const) {
    let got = "";
    const ms = elapsed(() => (got = redactUrlUserinfo(text)));
    assert.ok(got === want, `${text.slice(0, 40)}…`);
    assert.ok(ms < 1000, `${Math.round(ms)} ms on ${text.slice(0, 40)}…`);
  }
});

test("a TextBuilder joins its pieces in order across batches", () => {
  const b = new TextBuilder();
  const expected: string[] = [];
  for (let i = 0; i < 40_000; i++) {
    b.push(String(i), ",");
    expected.push(String(i), ",");
  }
  assert.equal(b.toString(), expected.join(""));
  assert.equal(new TextBuilder().toString(), "");
});

test("echoedCredentialForms treats a userinfo without a password as a token (Basic `TOKEN:`)", () => {
  const basic = (pair: string): string => Buffer.from(pair, "utf8").toString("base64");
  assert.deepEqual(echoedCredentialForms("alice:s3cret"), [basic("alice:s3cret"), "alice:s3cret", "s3cret"]);
  assert.deepEqual(echoedCredentialForms("T0ken"), [basic("T0ken:"), "T0ken:", "T0ken"]);
  assert.deepEqual(echoedCredentialForms("T0ken:"), [basic("T0ken:"), "T0ken:", "T0ken"]);
  assert.deepEqual(echoedCredentialForms("T%C3%B6k"), [basic("Tök:"), "Tök:"]); // short: not alone
  assert.deepEqual(echoedCredentialForms(":pw12"), [basic(":pw12"), ":pw12", "pw12"]);
  assert.deepEqual(echoedCredentialForms(""), []);
  assert.deepEqual(echoedCredentialForms(":"), []);
});

test("a userinfo without a password is a token: scrubbed from library errors in every echoed form", async () => {
  const TOKEN = "T0kenS3cret";
  const basic = Buffer.from(`${TOKEN}:`, "utf8").toString("base64");
  for (const baseUrl of [`https://${TOKEN}@mirror.example`, `https://${TOKEN}:@mirror.example`]) {
    for (const echo of [`bad token ${TOKEN}`, `Authorization: Basic ${basic}`, `user ${TOKEN}: unknown`]) {
      const engine = new RequestEngine({ baseUrl, maxRetries: 0, transport: makeMockTransport(() => jsonResponse({ detail: echo }, 401)).transport });
      await assert.rejects(engine.getJson("/x"), (err: unknown) => {
        assert.ok(err instanceof FimApiError && /^HTTP 401 /.test(err.message), String(err));
        for (const text of [err.message, String(err.detail), err.body]) {
          assert.ok(!text.includes(TOKEN) && !text.includes(basic), `${baseUrl} ${echo}: ${text}`);
        }
        return true;
      });
    }
  }
});

// ---- security audit 2026-10-27, class D: a credential scrubbed from decoded server text ----

// A password with characters a JSON writer escapes (a quote) or may write as \u00XX (an umlaut),
// and one a URL's query percent-encodes but encodeURIComponent doesn't (an apostrophe).
const D_PW = "pä\"s's-W0rd";
const D_BASE = `https://alice:${encodeURIComponent(D_PW)}@mirror.example`;
const D_BASIC = Buffer.from(`alice:${D_PW}`, "utf8").toString("base64");
/** The forms of the credential an error must not carry: decoded, and as a quoted value spells them (`\"`). */
const D_SECRETS = [D_PW, `alice:${D_PW}`, D_BASIC].flatMap((secret) => [secret, JSON.stringify(secret).slice(1, -1)]);

/** Everything a library user may log of an error: inspect, message, detail, location, and the decoded body. */
function everything(err: unknown): string {
  let text = inspect(err, { depth: 10, showHidden: true });
  const e = err as { message?: unknown; detail?: unknown; location?: unknown; body?: unknown };
  text += [e.message, e.detail, e.location, e.body].map(String).join("\n");
  let decoded: unknown;
  try {
    decoded = typeof e.body === "string" ? JSON.parse(e.body) : undefined;
  } catch {
    // not JSON: the body as sent is all a caller reads
  }
  const walk = (v: unknown): void => {
    if (typeof v === "string") text += `\n${v}`;
    else if (v !== null && typeof v === "object") {
      for (const [k, w] of Object.entries(v)) {
        text += `\n${k}`;
        walk(w);
      }
    }
  };
  walk(decoded);
  return text;
}

/** `text` as a JSON writer that escapes every non-ASCII character writes it (Python's json.dumps). */
const asciiJson = (text: string): string =>
  JSON.stringify(text).replace(/[\u0080-￿]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
/** `text` with every character written as a \uXXXX escape: no spelling of it as sent matches. */
const escapedJson = (text: string): string => `"${[...text].map((ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`).join("")}"`;

async function failureOf(body: string, status: number, shape?: "record"): Promise<unknown> {
  const engine = new RequestEngine({ baseUrl: D_BASE, maxRetries: 0, transport: async () => rawResponse(body, "application/json", status) });
  return engine.getJson("/x", undefined, shape).then(
    () => assert.fail("the call should have failed"),
    (err: unknown) => err,
  );
}

test("a credential echoed with JSON escapes is scrubbed from the message, the detail and the decoded body", async () => {
  const echoes: Array<[string, string]> = [
    ["the password, ASCII-only JSON", asciiJson(`wrong password ${D_PW}`)],
    ["the user:password, minimal JSON", JSON.stringify(`bad login alice:${D_PW}`)],
    ["the password, every character escaped", escapedJson(D_PW)],
    ["the request URL as the server decoded it", JSON.stringify(`no access to https://alice:${D_PW}@mirror.example/x`)],
  ];
  for (const status of [401, 500]) {
    for (const [label, json] of echoes) {
      const err = await failureOf(`{"detail":${json}}`, status);
      assert.ok(err instanceof FimApiError && err.message.startsWith(`HTTP ${status} `), `${label}: ${String(err)}`);
      const seen = everything(err);
      for (const secret of D_SECRETS) assert.ok(!seen.includes(secret), `${status} ${label}: ${seen.slice(0, 2000)}`);
    }
  }
});

test("a credential in the error envelope of a 2xx answer is scrubbed from the FimParseError, before the cut", async () => {
  for (const json of [asciiJson(D_PW), JSON.stringify(`alice:${D_PW}`), escapedJson(D_PW), JSON.stringify(`${"x".repeat(495)}${D_PW}`)]) {
    const err = await failureOf(`{"detail":${json}}`, 200, "record");
    assert.ok(err instanceof FimParseError && /error envelope/.test(err.message), String(err));
    const seen = everything(err);
    for (const secret of D_SECRETS) assert.ok(!seen.includes(secret), `${json}: ${seen.slice(0, 2000)}`);
    // No prefix of the password is left by a cut before the scrub.
    assert.ok(!seen.includes("pä\"s's"), seen.slice(0, 2000));
  }
  // The pure function still names the envelope's detail.
  assert.equal(responseShapeProblem({ detail: "Not found" }, "record"), "expected a record, got an error envelope: Not found.");
});

test("an error body keeps its spelling unless a credential hides behind an escape", async () => {
  const base = "https://alice:s3cret-pw@mirror.example";
  const bodyOf = async (body: string): Promise<string> => {
    const e = new RequestEngine({ baseUrl: base, maxRetries: 0, transport: async () => rawResponse(body, "application/json", 500) });
    const err = await e.getJson("/x").catch((caught: unknown) => caught);
    assert.ok(err instanceof FimApiError, String(err));
    return err.body;
  };
  // No credential, or one spelled as sent: the body as sent (scrubbed), escapes kept.
  assert.equal(await bodyOf('{"m":"caf\\u00e9 \\"x\\""}'), '{"m":"caf\\u00e9 \\"x\\""}');
  assert.equal(await bodyOf('{"m":"pw s3cret-pw \\u00e9"}'), '{"m":"pw *** \\u00e9"}');
  // Escaped: written again decoded, scrubbed in that spelling.
  assert.equal(await bodyOf('{"m":"pw s3cret\\u002dpw \\u00e9"}'), '{"m":"pw *** é"}');
  // Not JSON: nobody decodes it, it stays as sent.
  assert.equal(await bodyOf("pw s3cret\\u002dpw"), "pw s3cret\\u002dpw");
  // Deeply nested: written again where this runtime can, else left out (probed, not assumed:
  // whether JSON.stringify recurses depends on the Node version).
  const deep = `${"[".repeat(200_000)}"s3cret\\u002dpw"${"]".repeat(200_000)}`;
  let parses = true;
  let writes = true;
  try {
    const value: unknown = JSON.parse(deep);
    try {
      JSON.stringify(value);
    } catch {
      writes = false;
    }
  } catch {
    parses = false;
  }
  if (parses) {
    const body = await bodyOf(deep);
    assert.ok(!body.includes("s3cret"), body.slice(199_990, 200_030));
    assert.equal(body === "", !writes);
  }
});

test("an echo of the request URL as sent is scrubbed, a short password too", async () => {
  // Typed raw; WHATWG sends `p%22%C3%A4` in the URL, which a server echoes.
  const e = new RequestEngine({
    baseUrl: 'https://alice:p"ä@mirror.example',
    maxRetries: 0,
    transport: async (req) => rawResponse(JSON.stringify({ detail: `no access: ${req.url}` }), "application/json", 403),
  });
  const err = await e.getJson("/x").catch((caught: unknown) => caught);
  assert.ok(err instanceof FimApiError, String(err));
  for (const text of [err.message, err.detail ?? "", err.body]) {
    assert.ok(!text.includes("p%22%C3%A4@") && !text.includes('p"ä@'), text);
  }
});

// These tests start a process with a small heap: 30 s instead of the suite's 5 s.
const STARTS_A_PROCESS = { timeout: 30_000 };

/** Run `script` (an ES module that can import `engine`, the built engine's URL) under a heap of `heapMb`; its stdout. */
function withSmallHeap(heapMb: number, script: string): string {
  const engine = JSON.stringify(new URL("../src/engine.js", import.meta.url).href);
  return execFileSync(process.execPath, [`--max-old-space-size=${heapMb}`, "--input-type=module", "-e", `const engine = ${engine};\n${script}`], { encoding: "utf8" });
}

test("scanNumbers quotes millions of declared members within a small heap", STARTS_A_PROCESS, () => {
  // One `+=` per quoted member made a rope node each: 3 million of them exhausted a 128 MB heap.
  const n = 3_000_000;
  const out = withSmallHeap(
    128,
    `const { scanNumbers } = await import(engine);` +
      `const json = "[" + '{"k":1},'.repeat(${n - 1}) + '{"k":1}]';` +
      `process.stdout.write(String(scanNumbers(json, new Set(["k"])).json.length));`,
  );
  assert.equal(out, String(n * 10 + 1));
});

// Each case runs in a process of its own: in one, the first engine (and the 16 MB answer its
// transport holds) was still alive during the second, and on Node 22 the two together passed
// the 128 MB heap that each alone stays well under (CI, Linux x64).
test("a 16 MB error detail is handled within a small heap (C)", STARTS_A_PROCESS, () => {
  // One `+=` per character of a 16 MB detail exhausted a 128 MB heap.
  const out = withSmallHeap(
    128,
    `const { RequestEngine } = await import(engine);` +
      `const answer = (status, text) => async () => ({ status, headers: { "content-type": "application/json" }, body: Buffer.from(text) });` +
      `const big = new RequestEngine({ maxRetries: 0, transport: answer(500, '{"detail":"' + "x ".repeat(8_000_000) + '"}') });` +
      `const err = await big.getJson("/x").catch((e) => e);` +
      `process.stdout.write(JSON.stringify([err.status, err.message.length < 1000]));`,
  );
  assert.deepEqual(JSON.parse(out), [500, true]);
});

test("millions of lone surrogate escapes are repaired within a small heap (C)", STARTS_A_PROCESS, () => {
  // One `+=` per lone-surrogate repair (6 million) exhausted a 128 MB heap.
  const out = withSmallHeap(
    128,
    `const { RequestEngine } = await import(engine);` +
      `const answer = (status, text) => async () => ({ status, headers: { "content-type": "application/json" }, body: Buffer.from(text) });` +
      `const lone = new RequestEngine({ transport: answer(200, '{"x":"' + "\\\\ud800".repeat(6_000_000) + '"}') });` +
      `const value = await lone.getJson("/x");` +
      `process.stdout.write(JSON.stringify([value.x.length, value.x.slice(0, 2)]));`,
  );
  assert.deepEqual(JSON.parse(out), [6_000_000, "\ufffd\ufffd"]);
});

test("typedUrlCredentials reads a value meant as a URL whatever its scheme: missing, special without //, mistyped (F7)", () => {
  for (const [value, userinfo] of [
    ["https://alice:pw@h.example/x", "alice:pw"],
    ["http:///alice:pw@h.example", "alice:pw"],
    ["alice:pw@h.example/x", "alice:pw"],
    ["my_user:pw@h.example", "my_user:pw"],
    ["T0ken:@h.example", "T0ken:"],
    ["http//alice:pw@h.example", "alice:pw"],
    ["https//alice:pw@h.example/v1", "alice:pw"],
    ["http/alice:pw@h.example", "alice:pw"],
    ["htp:/alice:pw@h.example", "alice:pw"],
    ["http\\\\alice:pw@h.example", "alice:pw"],
    ["http//alice:p/w@h.example", "alice:p/w"],
  ] as const) {
    assert.deepEqual(typedUrlCredentials(value), [userinfo], value);
  }
  // No "@" after the slashes, or a scheme spelled with "//" and no userinfo: none.
  for (const value of ["", "h.example/x", "http//h.example/x", "@h.example/x", "http//@h.example", "https://h.example/a@b"]) {
    assert.deepEqual(typedUrlCredentials(value), [], value);
  }
});
