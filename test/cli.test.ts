import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/cli/run.js";
import { FimPortalClient } from "../src/client/client.js";
import type { CliDeps } from "../src/cli/io.js";
import type { HttpRequest, HttpResponse } from "../src/client/http.js";
import { makeMockTransport, jsonResponse, rawResponse } from "./helpers.js";
import * as fx from "./fixtures.js";

function makeCli(responder: (req: HttpRequest) => HttpResponse) {
  const out: string[] = [];
  const err: string[] = [];
  const files = new Map<string, Buffer>();
  const mt = makeMockTransport(responder);

  const deps: CliDeps = {
    io: {
      out: (s) => out.push(s),
      err: (s) => err.push(s),
      writeFile: (p, d) => files.set(p, d),
      outBinary: (d) => out.push(d.toString("utf8")),
    },
    createClient: (opts) => new FimPortalClient({ ...opts, transport: mt.transport }),
  };
  return { deps, out, err, files, mt };
}

test("schemas search prints JSON and sends the right query", async () => {
  const cli = makeCli(() => jsonResponse(fx.schemaSearchResult));
  const code = await run(["schemas", "search", "--name", "Geburt", "--limit", "5"], cli.deps);

  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(cli.out.join("\n")), fx.schemaSearchResult);
  const url = new URL(cli.mt.last().url);
  assert.equal(url.pathname, "/api/v1/schemas");
  assert.equal(url.searchParams.get("name"), "Geburt");
  assert.equal(url.searchParams.get("limit"), "5");
});

test("schemas search rejects an out-of-range freigabe-status", async () => {
  const cli = makeCli(() => jsonResponse(fx.schemaSearchResult));
  const code = await run(["schemas", "search", "--freigabe-status", "99"], cli.deps);
  assert.notEqual(code, 0);
  assert.equal(cli.mt.calls.length, 0); // never reached the client
});

test("schemas get with explicit version", async () => {
  const cli = makeCli(() => jsonResponse(fx.fullSchema));
  const code = await run(["schemas", "get", "S07000009", "1.0"], cli.deps);
  assert.equal(code, 0);
  assert.equal(new URL(cli.mt.last().url).pathname, "/api/v1/schemas/S07000009/1.0");
});

test("schemas get defaults the version to latest", async () => {
  const cli = makeCli(() => jsonResponse(fx.fullSchema));
  await run(["schemas", "get", "S07000009"], cli.deps);
  assert.equal(new URL(cli.mt.last().url).pathname, "/api/v1/schemas/S07000009/latest");
});

test("--compact prints single-line JSON", async () => {
  const cli = makeCli(() => jsonResponse(fx.fullSchema));
  await run(["--compact", "schemas", "get", "S1", "1.0"], cli.deps);
  assert.equal(cli.out.length, 1);
  assert.equal(cli.out[0], JSON.stringify(fx.fullSchema));
});

test("xdf download writes to --output file and reports bytes on stderr", async () => {
  const cli = makeCli(() => rawResponse(fx.xmlBody, "application/xml"));
  const code = await run(
    ["--output", "/tmp/out.xml", "schemas", "xdf", "S1", "1.0"],
    cli.deps,
  );
  assert.equal(code, 0);
  assert.equal(cli.files.get("/tmp/out.xml")?.toString("utf8"), fx.xmlBody);
  assert.equal(cli.out.length, 0); // nothing on stdout
  assert.match(cli.err.join("\n"), /Wrote \d+ bytes to \/tmp\/out\.xml/);
});

test("xdf download without --output streams to stdout", async () => {
  const cli = makeCli(() => rawResponse(fx.xmlBody, "application/xml"));
  await run(["schemas", "xdf", "S1", "1.0"], cli.deps);
  assert.equal(cli.out.join(""), fx.xmlBody);
});

test("--base-url is forwarded to the client", async () => {
  const cli = makeCli(() => jsonResponse(fx.schemaSearchResult));
  await run(["--base-url", "https://schema.fim.fitko.net", "schemas", "search"], cli.deps);
  assert.equal(new URL(cli.mt.last().url).host, "schema.fim.fitko.net");
});

test("a 404 from the API maps to exit code 4 and an error message", async () => {
  const cli = makeCli(() => jsonResponse({ detail: "Schema not found" }, 404));
  const code = await run(["--max-retries", "0", "schemas", "get", "NOPE", "1.0"], cli.deps);
  assert.equal(code, 4);
  assert.match(cli.err.join("\n"), /Schema not found/);
});

test("service-texts get passes the source path segment", async () => {
  const cli = makeCli(() => jsonResponse({ ok: true }));
  await run(["service-texts", "get", "R1", "L1", "leika"], cli.deps);
  assert.equal(new URL(cli.mt.last().url).pathname, "/api/v0/leistung-stammtexte/R1/L1/leika");
});

test("processes get passes the Detaillierungsstufe", async () => {
  const cli = makeCli(() => jsonResponse({ ok: true }));
  await run(["processes", "get", "P1", "1.0", "101"], cli.deps);
  assert.equal(new URL(cli.mt.last().url).pathname, "/api/v0/processes/P1/1.0/101");
});

test("--version prints the version and exits 0", async () => {
  const cli = makeCli(() => jsonResponse({}));
  const code = await run(["--version"], cli.deps);
  assert.equal(code, 0);
  assert.match(cli.out.join("\n"), /1\.0\.0/);
});

test("unknown command is a usage error (non-zero exit, no HTTP call)", async () => {
  const cli = makeCli(() => jsonResponse({}));
  const code = await run(["bogus-command"], cli.deps);
  assert.notEqual(code, 0);
  assert.equal(cli.mt.calls.length, 0);
});
