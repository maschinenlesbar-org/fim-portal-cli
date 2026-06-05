import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { nodeHttpTransport } from "../src/client/http.js";
import { FimNetworkError } from "../src/client/errors.js";

// The default transport is exercised against a real local http server. This is
// the only suite that performs (loopback-only) socket I/O; everything else mocks.

let server: http.Server;
let base: string;
const seen: Array<{ method: string; url: string; headers: http.IncomingHttpHeaders; body: string }> =
  [];

before(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seen.push({
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });

      if (req.url === "/json") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } else if (req.url === "/slow") {
        setTimeout(() => res.end("late"), 100);
      } else if (req.url === "/boom") {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ detail: "kaboom" }));
      } else if (req.url === "/big") {
        res.writeHead(200, { "content-type": "application/octet-stream" });
        res.end(Buffer.alloc(1000, 0x61)); // 1000 'a' bytes
      } else {
        res.writeHead(404).end("nope");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

test("nodeHttpTransport performs a GET and returns status, headers and body", async () => {
  const res = await nodeHttpTransport({ method: "GET", url: `${base}/json` });
  assert.equal(res.status, 200);
  assert.match(String(res.headers["content-type"]), /application\/json/);
  assert.deepEqual(JSON.parse(res.body.toString("utf8")), { ok: true });
});

test("nodeHttpTransport forwards method, query and headers", async () => {
  await nodeHttpTransport({
    method: "GET",
    url: `${base}/json?a=1&a=2`,
    headers: { "x-test": "hello" },
  });
  const last = seen[seen.length - 1]!;
  assert.equal(last.method, "GET");
  assert.equal(last.url, "/json?a=1&a=2");
  assert.equal(last.headers["x-test"], "hello");
});

test("nodeHttpTransport resolves (does not reject) on non-2xx", async () => {
  const res = await nodeHttpTransport({ method: "GET", url: `${base}/boom` });
  assert.equal(res.status, 500);
  assert.deepEqual(JSON.parse(res.body.toString("utf8")), { detail: "kaboom" });
});

test("nodeHttpTransport rejects with FimNetworkError on timeout", async () => {
  await assert.rejects(
    () => nodeHttpTransport({ method: "GET", url: `${base}/slow`, timeoutMs: 20 }),
    (err: unknown) => err instanceof FimNetworkError,
  );
});

test("nodeHttpTransport rejects with FimNetworkError on an invalid URL", async () => {
  await assert.rejects(
    () => nodeHttpTransport({ method: "GET", url: "not-a-url" }),
    (err: unknown) => err instanceof FimNetworkError,
  );
});

test("nodeHttpTransport rejects unsupported protocols before connecting", async () => {
  await assert.rejects(
    () => nodeHttpTransport({ method: "GET", url: "file:///etc/passwd" }),
    (err: unknown) => err instanceof FimNetworkError && /Unsupported protocol/.test(err.message),
  );
});

test("nodeHttpTransport aborts and rejects when the body exceeds maxResponseBytes", async () => {
  await assert.rejects(
    () => nodeHttpTransport({ method: "GET", url: `${base}/big`, maxResponseBytes: 100 }),
    (err: unknown) => err instanceof FimNetworkError && /maxResponseBytes/.test(err.message),
  );
});

test("nodeHttpTransport returns the body when it is within maxResponseBytes", async () => {
  const res = await nodeHttpTransport({
    method: "GET",
    url: `${base}/big`,
    maxResponseBytes: 10_000,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1000);
});
