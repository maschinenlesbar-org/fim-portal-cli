import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_RETRY_AFTER_MS, RequestEngine, parseRetryAfter } from "../src/client/engine.js";
import { FimApiError, FimNetworkError, FimParseError } from "../src/client/errors.js";
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
    await assert.rejects(() => engine.getJson("/x"), (e: unknown) => e instanceof FimApiError && e.status === 429);
    assert.equal(mt.calls.length, 1, header);
    assert.deepEqual(delays, [], header);
  }
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
      (err: unknown) => err instanceof FimNetworkError && /Unsupported protocol/.test(err.message),
      baseUrl,
    );
    assert.equal(mt.calls.length, 0);
  }
});

test("an unparseable base URL is rejected at construction", () => {
  const mt = makeMockTransport(() => jsonResponse({}));
  assert.throws(
    () => new RequestEngine({ transport: mt.transport, baseUrl: "not a url" }),
    (err: unknown) => err instanceof FimNetworkError && /Invalid base URL/.test(err.message),
  );
  assert.equal(mt.calls.length, 0);
});

test("a base URL with a query or fragment is rejected at construction", () => {
  for (const baseUrl of ["https://example.test/?x=1", "https://example.test/#frag", "https://example.test?"]) {
    const mt = makeMockTransport(() => jsonResponse({}));
    assert.throws(
      () => new RequestEngine({ transport: mt.transport, baseUrl }),
      (err: unknown) =>
        err instanceof FimNetworkError && /Base URL must not contain a query or fragment/.test(err.message),
      baseUrl,
    );
  }
});
