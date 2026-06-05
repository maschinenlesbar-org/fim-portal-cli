import { test } from "node:test";
import assert from "node:assert/strict";
import { RequestEngine } from "../src/client/engine.js";
import { FimApiError, FimParseError } from "../src/client/errors.js";
import { makeMockTransport, jsonResponse, rawResponse } from "./helpers.js";

const noSleep = async (): Promise<void> => {};

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

test("FimApiError.isRetryable reflects 429/503", () => {
  const e1 = new FimApiError({ status: 429, url: "u", method: "GET", body: "" });
  const e2 = new FimApiError({ status: 404, url: "u", method: "GET", body: "" });
  assert.equal(e1.isRetryable, true);
  assert.equal(e2.isRetryable, false);
});
