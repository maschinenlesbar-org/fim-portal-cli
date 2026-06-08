import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/cli/run.js";
import { FimPortalClient } from "../src/client/client.js";
import type { CliDeps } from "../src/cli/io.js";
import type { HttpRequest, HttpResponse } from "../src/client/http.js";
import { makeMockTransport, jsonResponse, rawResponse } from "./helpers.js";
import * as fx from "./fixtures.js";
import { FimNetworkError } from "../src/client/errors.js";

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

test("--max-response-bytes is forwarded to the transport", async () => {
  const cli = makeCli(() => jsonResponse(fx.schemaSearchResult));
  await run(["--max-response-bytes", "2048", "schemas", "search"], cli.deps);
  assert.equal(cli.mt.last().maxResponseBytes, 2048);
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
  assert.match(cli.out.join("\n"), /\d+\.\d+\.\d+/);
});

test("unknown command is a usage error (non-zero exit, no HTTP call)", async () => {
  const cli = makeCli(() => jsonResponse({}));
  const code = await run(["bogus-command"], cli.deps);
  assert.notEqual(code, 0);
  assert.equal(cli.mt.calls.length, 0);
});

// ---- H1: service searches expose order_by and lagen_portalverbund ----

test("service-profiles search forwards --order-by and --lagen-portalverbund", async () => {
  const cli = makeCli(() => jsonResponse({ items: [] }));
  const code = await run(
    [
      "service-profiles",
      "search",
      "--order-by",
      "titel_asc",
      "--lagen-portalverbund",
      "Familie",
    ],
    cli.deps,
  );
  assert.equal(code, 0);
  const q = new URL(cli.mt.last().url).searchParams;
  assert.equal(q.get("order_by"), "titel_asc");
  assert.equal(q.get("lagen_portalverbund"), "Familie");
});

test("service-profiles search rejects an order value from a different enum", async () => {
  const cli = makeCli(() => jsonResponse({ items: [] }));
  // "name_asc" is a Datenfelder order, not a Leistungsteckbrief order.
  const code = await run(["service-profiles", "search", "--order-by", "name_asc"], cli.deps);
  assert.notEqual(code, 0);
  assert.equal(cli.mt.calls.length, 0);
});

test("service-texts search forwards --order-by", async () => {
  const cli = makeCli(() => jsonResponse(fx.stammtextSearchResult));
  await run(["service-texts", "search", "--order-by", "relevance"], cli.deps);
  assert.equal(new URL(cli.mt.last().url).searchParams.get("order_by"), "relevance");
});

// ---- H2: --limit is bounded to 1..200 ----

test("--limit accepts a value within 1..200", async () => {
  const cli = makeCli(() => jsonResponse(fx.schemaSearchResult));
  const code = await run(["schemas", "search", "--limit", "50"], cli.deps);
  assert.equal(code, 0);
  assert.equal(new URL(cli.mt.last().url).searchParams.get("limit"), "50");
});

for (const bad of ["0", "201", "999999", "-1", "1.5"]) {
  test(`--limit rejects ${bad}`, async () => {
    const cli = makeCli(() => jsonResponse(fx.schemaSearchResult));
    const code = await run(["schemas", "search", "--limit", bad], cli.deps);
    assert.notEqual(code, 0);
    assert.equal(cli.mt.calls.length, 0);
  });
}

test("organizational-units --limit is also bounded", async () => {
  const cli = makeCli(() => jsonResponse(fx.orgUnitListResult));
  const code = await run(["organizational-units", "list", "--limit", "500"], cli.deps);
  assert.notEqual(code, 0);
  assert.equal(cli.mt.calls.length, 0);
});

// ---- L3: positional enum args are validated client-side ----

test("processes get rejects an invalid Detaillierungsstufe without an HTTP call", async () => {
  const cli = makeCli(() => jsonResponse({}));
  const code = await run(["processes", "get", "P1", "1.0", "999"], cli.deps);
  assert.equal(code, 1);
  assert.equal(cli.mt.calls.length, 0);
  assert.match(cli.err.join("\n"), /Invalid Detaillierungsstufe "999"/);
});

test("processes get accepts a valid Detaillierungsstufe", async () => {
  const cli = makeCli(() => jsonResponse({ ok: true }));
  const code = await run(["processes", "get", "P1", "1.0", "101"], cli.deps);
  assert.equal(code, 0);
  assert.equal(new URL(cli.mt.last().url).pathname, "/api/v0/processes/P1/1.0/101");
});

test("service-texts get rejects an invalid source without an HTTP call", async () => {
  const cli = makeCli(() => jsonResponse({}));
  const code = await run(["service-texts", "get", "R1", "L1", "bogus"], cli.deps);
  assert.equal(code, 1);
  assert.equal(cli.mt.calls.length, 0);
  assert.match(cli.err.join("\n"), /Invalid source "bogus"/);
});

// ---- M3: choice options reuse the spec enums (incl. schema-only "Stichwort") ----

test("schemas search accepts the schema-only suche-nur-in value Stichwort", async () => {
  const cli = makeCli(() => jsonResponse(fx.schemaSearchResult));
  const code = await run(["schemas", "search", "--suche-nur-in", "Stichwort"], cli.deps);
  assert.equal(code, 0);
  assert.equal(new URL(cli.mt.last().url).searchParams.get("suche_nur_in"), "Stichwort");
});

test("fields search rejects the schema-only value Stichwort (not in FeldSucheIn)", async () => {
  const cli = makeCli(() => jsonResponse(fx.fieldSearchResult));
  const code = await run(["fields", "search", "--suche-nur-in", "Stichwort"], cli.deps);
  assert.notEqual(code, 0);
  assert.equal(cli.mt.calls.length, 0);
});

// ---- code-lists ----

test("code-lists hits /api/v0/code-lists and forwards pagination", async () => {
  const cli = makeCli(() => jsonResponse(fx.codeListResult));
  const code = await run(["code-lists", "--offset", "0", "--limit", "20"], cli.deps);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(cli.out.join("\n")), fx.codeListResult);
  const url = new URL(cli.mt.last().url);
  assert.equal(url.pathname, "/api/v0/code-lists");
  assert.equal(url.searchParams.get("offset"), "0");
  assert.equal(url.searchParams.get("limit"), "20");
});

test("code-lists --limit is bounded to 1..200", async () => {
  const cli = makeCli(() => jsonResponse(fx.codeListResult));
  const code = await run(["code-lists", "--limit", "500"], cli.deps);
  assert.notEqual(code, 0);
  assert.equal(cli.mt.calls.length, 0);
});

// ---- search-csv (unvalidated pass-through) ----

test("search-csv maps options to query params and streams CSV to stdout", async () => {
  const cli = makeCli(() => rawResponse(fx.csvBody, "text/csv"));
  const code = await run(
    [
      "search-csv",
      "--resource",
      "fields",
      "--term",
      "Name",
      "--xdf-version",
      "2.0",
      "--order-by",
      "name_asc",
      "--feldart",
      "input",
      "--datentyp",
      "text",
      "--dokumentart",
      "001",
      "--sprache",
      "Deutsch",
    ],
    cli.deps,
  );
  assert.equal(code, 0);
  assert.equal(cli.out.join(""), fx.csvBody);
  const q = new URL(cli.mt.last().url).searchParams;
  assert.equal(new URL(cli.mt.last().url).pathname, "/tools/search-csv-download");
  assert.equal(q.get("resource"), "fields");
  assert.equal(q.get("term"), "Name");
  assert.equal(q.get("xdf_version"), "2.0");
  assert.equal(q.get("order_by"), "name_asc");
  assert.equal(q.get("feldart"), "input");
  assert.equal(q.get("datentyp"), "text");
  assert.equal(q.get("dokumentart"), "001");
  assert.equal(q.get("sprache"), "Deutsch");
});

test("search-csv requires --resource", async () => {
  const cli = makeCli(() => rawResponse(fx.csvBody, "text/csv"));
  const code = await run(["search-csv", "--term", "Name"], cli.deps);
  assert.notEqual(code, 0);
  assert.equal(cli.mt.calls.length, 0);
});

test("search-csv forwards unvalidated values verbatim (no enum guard)", async () => {
  // The CSV command is a documented pass-through: bogus values are forwarded, not rejected.
  const cli = makeCli(() => rawResponse(fx.csvBody, "text/csv"));
  const code = await run(
    ["search-csv", "--resource", "fields", "--feldart", "bogus"],
    cli.deps,
  );
  assert.equal(code, 0);
  assert.equal(new URL(cli.mt.last().url).searchParams.get("feldart"), "bogus");
});

test("search-csv writes the CSV to --output and reports bytes on stderr", async () => {
  const cli = makeCli(() => rawResponse(fx.csvBody, "text/csv"));
  const code = await run(
    ["--output", "/tmp/fields.csv", "search-csv", "--resource", "fields"],
    cli.deps,
  );
  assert.equal(code, 0);
  assert.equal(cli.files.get("/tmp/fields.csv")?.toString("utf8"), fx.csvBody);
  assert.equal(cli.out.length, 0);
  assert.match(cli.err.join("\n"), /Wrote \d+ bytes to \/tmp\/fields\.csv/);
});

// ---- error paths through run() ----

test("a transport-level network error maps to exit 1 with a clean Error message", async () => {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    io: {
      out: (s) => out.push(s),
      err: (s) => err.push(s),
      writeFile: () => {},
      outBinary: (d) => out.push(d.toString("utf8")),
    },
    createClient: (opts) =>
      new FimPortalClient({
        ...opts,
        transport: () => Promise.reject(new FimNetworkError("connection reset")),
      }),
  };
  const code = await run(["--max-retries", "0", "schemas", "search"], deps);
  assert.equal(code, 1);
  assert.equal(out.length, 0);
  assert.match(err.join("\n"), /^Error: connection reset/);
});

test("a failed -o write degrades to exit 1 with a clean Error (not Unexpected error)", async () => {
  const out: string[] = [];
  const err: string[] = [];
  const mt = makeMockTransport(() => rawResponse(fx.xmlBody, "application/xml"));
  const deps: CliDeps = {
    io: {
      out: (s) => out.push(s),
      err: (s) => err.push(s),
      writeFile: () => {
        const e = new Error("ENOENT: no such file or directory, open '/nope/out.xml'");
        throw e;
      },
      outBinary: (d) => out.push(d.toString("utf8")),
    },
    createClient: (opts) => new FimPortalClient({ ...opts, transport: mt.transport }),
  };
  const code = await run(["--output", "/nope/out.xml", "schemas", "xdf", "S1", "1.0"], deps);
  assert.equal(code, 1);
  const errText = err.join("\n");
  assert.match(errText, /^Error: could not write \/nope\/out\.xml/);
  assert.doesNotMatch(errText, /Unexpected error/);
});
