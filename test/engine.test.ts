import { test } from "node:test";
import assert from "node:assert/strict";
import { RequestEngine } from "../src/client/engine.js";
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
