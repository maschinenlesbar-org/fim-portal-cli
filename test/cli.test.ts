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

for (const group of ["schemas", "document-profiles", "fields", "groups"]) {
  test(`${group} search sends --versionshinweis as the capitalised Versionshinweis parameter`, async () => {
    const cli = makeCli(() => jsonResponse(fx.schemaSearchResult));
    const code = await run([group, "search", "--versionshinweis", "neu"], cli.deps);
    assert.equal(code, 0);
    const params = new URL(cli.mt.last().url).searchParams;
    assert.equal(params.get("Versionshinweis"), "neu");
    assert.equal(params.has("versionshinweis"), false);
  });
}

test("--xdf-version offers only the values the API accepts (2.0, 3.0.0)", async () => {
  for (const [value, ok] of [["2.0", true], ["3.0.0", true], ["2.0.0", false]] as const) {
    const cli = makeCli(() => jsonResponse(fx.schemaSearchResult));
    const code = await run(["schemas", "search", "--xdf-version", value], cli.deps);
    assert.equal(code, ok ? 0 : 1, value);
    assert.equal(cli.mt.calls.length, ok ? 1 : 0, value);
  }
});

for (const group of ["schemas", "document-profiles", "fields", "groups"]) {
  test(`${group} search accepts --order-by relevance`, async () => {
    const cli = makeCli(() => jsonResponse(fx.schemaSearchResult));
    const code = await run([group, "search", "--fts-query", "Geburt", "--order-by", "relevance"], cli.deps);
    assert.equal(code, 0);
    assert.equal(new URL(cli.mt.last().url).searchParams.get("order_by"), "relevance");
  });
}

test("schemas search rejects an out-of-range freigabe-status", async () => {
  const cli = makeCli(() => jsonResponse(fx.schemaSearchResult));
  const code = await run(["schemas", "search", "--freigabe-status", "99"], cli.deps);
  assert.notEqual(code, 0);
  assert.equal(cli.mt.calls.length, 0); // never reached the client
});

test("--freigabe-status accepts only a plain decimal code", async () => {
  for (const value of [" 5", "0x5", "5.0", "1e0", "0b101", "+5", ""]) {
    const cli = makeCli(() => jsonResponse(fx.schemaSearchResult));
    const code = await run(["schemas", "search", "--freigabe-status", value], cli.deps);
    assert.equal(code, 1, JSON.stringify(value));
    assert.equal(cli.mt.calls.length, 0, JSON.stringify(value));
  }
  const cli = makeCli(() => jsonResponse(fx.schemaSearchResult));
  assert.equal(await run(["schemas", "search", "--freigabe-status", "5"], cli.deps), 0);
  assert.deepEqual(new URL(cli.mt.last().url).searchParams.getAll("freigabe_status"), ["5"]);
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

test("DEL and C1 control characters in server data are escaped in the JSON output", async () => {
  const controls = String.fromCharCode(0x7f, 0x85, 0x9b) + "2J";
  const served = { ...fx.fullSchema, name: `Geburt${controls}`, fim_version: String.fromCharCode(0x1b) + "[31m" };
  for (const format of [[], ["--compact"]]) {
    const cli = makeCli(() => jsonResponse(served));
    assert.equal(await run([...format, "schemas", "get", "S1", "1.0"], cli.deps), 0);
    const text = cli.out.join("\n");
    const raw = [...text].filter((c) => c.charCodeAt(0) < 0x20 ? c !== "\n" : c.charCodeAt(0) >= 0x7f && c.charCodeAt(0) <= 0x9f);
    assert.deepEqual(raw, [], format.join(" "));
    assert.match(text, /Geburt\\u007f\\u0085\\u009b2J/);
    assert.deepEqual(JSON.parse(text), served);
  }
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

test("a non-http(s) --base-url is rejected at parse time (usage error, no HTTP call)", async () => {
  const cli = makeCli(() => jsonResponse(fx.schemaSearchResult));
  const code = await run(["--base-url", "file:///etc/passwd", "schemas", "search"], cli.deps);
  // Rejected by the value-parser before any request is built: commander's usage
  // exit code (1 in this version), and crucially the transport is never reached.
  assert.equal(code, 1);
  assert.equal(cli.mt.calls.length, 0);
});

test("a malformed --base-url is rejected at parse time", async () => {
  const cli = makeCli(() => jsonResponse(fx.schemaSearchResult));
  const code = await run(["--base-url", "not a url", "schemas", "search"], cli.deps);
  assert.equal(code, 1);
  assert.equal(cli.mt.calls.length, 0);
});

test("a --base-url with a query, a fragment or surrounding whitespace is a usage error", async () => {
  for (const [baseUrl, message] of [
    ["http://127.0.0.1:18113/?x=1", /cannot have a query \(\?\) or fragment \(#\)/],
    ["http://127.0.0.1:18113/#frag", /cannot have a query \(\?\) or fragment \(#\)/],
    ["http://127.0.0.1:18113?", /cannot have a query \(\?\) or fragment \(#\)/],
    [" https://fimportal.de", /cannot have surrounding whitespace/],
    ["https://fimportal.de\t", /cannot have surrounding whitespace/],
  ] as const) {
    const cli = makeCli(() => jsonResponse(fx.schemaSearchResult));
    const code = await run(["--base-url", baseUrl, "schemas", "search"], cli.deps);
    assert.equal(code, 1, baseUrl);
    assert.equal(cli.mt.calls.length, 0, baseUrl);
    assert.match(cli.err.join("\n"), message, baseUrl);
  }
});

test("a --base-url with a path prefix still works", async () => {
  const cli = makeCli(() => jsonResponse(fx.schemaSearchResult));
  const code = await run(["--base-url", "https://mirror.example/fim/", "schemas", "get", "S1"], cli.deps);
  assert.equal(code, 0);
  assert.equal(cli.mt.last().url, "https://mirror.example/fim/api/v1/schemas/S1/latest");
});

test("a blank -o/--output is a usage error instead of silently writing to stdout", async () => {
  for (const value of ["", " "]) {
    const cli = makeCli(() => jsonResponse(fx.schemaSearchResult));
    const code = await run(["-o", value, "--compact", "schemas", "get", "X"], cli.deps);
    assert.equal(code, 1, JSON.stringify(value));
    assert.equal(cli.mt.calls.length, 0);
    assert.deepEqual(cli.out, []);
    assert.match(cli.err.join("\n"), /Expected a non-empty value/);
  }
});

test("--timeout accepts up to the largest timer Node supports", async () => {
  const cli = makeCli(() => jsonResponse(fx.schemaSearchResult));
  assert.equal(await run(["--timeout", "2147483647", "schemas", "search"], cli.deps), 0);
  assert.equal(cli.mt.last().timeoutMs, 2_147_483_647);

  const over = makeCli(() => jsonResponse(fx.schemaSearchResult));
  assert.equal(await run(["--timeout", "2147483648", "schemas", "search"], over.deps), 1);
  assert.equal(over.mt.calls.length, 0);
  assert.match(over.err.join("\n"), /Must be <= 2147483647/);
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

test("processes get passes the Detaillierungsstufe and the verwaltungspolitische Kodierung", async () => {
  const cli = makeCli(() => jsonResponse({ ok: true }));
  await run(["processes", "get", "P1", "1.0", "101", "17"], cli.deps);
  assert.equal(new URL(cli.mt.last().url).pathname, "/api/v0/processes/P1/1.0/101/17");
});

for (const [name, suffix] of [
  ["xprozess", "xprozess"],
  ["report", "report"],
  ["visualization", "visualization"],
  ["visualization-display", "visualization_display"],
] as const) {
  test(`processes ${name} addresses the process by all four path segments`, async () => {
    const cli = makeCli(() => rawResponse("%PDF-1.4", "application/pdf"));
    const code = await run(["-o", "out.bin", "processes", name, "P1", "1.0", "105", "17"], cli.deps);
    assert.equal(code, 0);
    assert.equal(new URL(cli.mt.last().url).pathname, `/api/v0/processes/P1/1.0/105/17/${suffix}`);
  });
}

test("process-classes xprozess downloads the XML instead of parsing it as JSON", async () => {
  const xml = "<?xml version='1.0' encoding='utf-8'?><xprozess:alleInhalte.export.0303/>";
  const cli = makeCli(() => rawResponse(xml, "application/xml"));
  const code = await run(["-o", "pc.xml", "process-classes", "xprozess", "P1", "1.0"], cli.deps);
  assert.equal(code, 0);
  assert.equal(new URL(cli.mt.last().url).pathname, "/api/v0/processclasses/P1/1.0/xprozess");
  assert.equal(cli.mt.last().headers?.["Accept"], "application/xml");
  assert.equal(cli.files.get("pc.xml")?.toString("utf8"), xml);
  assert.match(cli.err.join("\n"), /Wrote \d+ bytes to pc\.xml \(Content-Type: application\/xml\)/);
});

test("an id of .. exits 1 without a request instead of printing another endpoint's data", async () => {
  const cli = makeCli(() => jsonResponse(fx.schemaSearchResult));
  const code = await run(["--compact", "fields", "versions", "..", "schemas"], cli.deps);
  assert.equal(code, 1);
  assert.equal(cli.mt.calls.length, 0);
  assert.deepEqual(cli.out, []);
  assert.match(cli.err.join("\n"), /^Error: Invalid path segment "\.\."/);
});

test("--max-retries is bounded to 0..10", async () => {
  for (const [value, ok] of [["0", true], ["10", true], ["11", false], ["1000000", false]] as const) {
    const cli = makeCli(() => jsonResponse(fx.schemaSearchResult));
    const code = await run(["--max-retries", value, "schemas", "search"], cli.deps);
    assert.equal(code, ok ? 0 : 1, value);
    if (!ok) assert.match(cli.err.join("\n"), /Must be <= 10\./);
  }
});

test("organizational-units and online-services list forward --fts-query", async () => {
  for (const [group, path] of [
    ["organizational-units", "/api/v0/organizational-unit"],
    ["online-services", "/api/v0/online-service"],
  ] as const) {
    const cli = makeCli(() => jsonResponse({ items: [], limit: 5, count: 0, next_cursor: null }));
    const code = await run([group, "list", "--fts-query", "Standesamt", "--limit", "5"], cli.deps);
    assert.equal(code, 0);
    const url = new URL(cli.mt.last().url);
    assert.equal(url.pathname, path);
    assert.equal(url.searchParams.get("fts_query"), "Standesamt");
  }
});

test("specializations list has no --fts-query (the endpoint does not support it)", async () => {
  const cli = makeCli(() => jsonResponse({ items: [] }));
  const code = await run(["specializations", "list", "--fts-query", "x"], cli.deps);
  assert.equal(code, 1);
  assert.equal(cli.mt.calls.length, 0);
});

test("process-classes search forwards --is-latest", async () => {
  const cli = makeCli(() => jsonResponse({ items: [] }));
  const code = await run(["process-classes", "search", "--is-latest"], cli.deps);
  assert.equal(code, 0);
  assert.equal(new URL(cli.mt.last().url).searchParams.get("is_latest"), "true");
});

test("processes get without the Kodierung is a usage error, before any request", async () => {
  const cli = makeCli(() => jsonResponse({ ok: true }));
  const code = await run(["processes", "get", "P1", "1.0", "101"], cli.deps);
  assert.equal(code, 1);
  assert.equal(cli.mt.calls.length, 0);
  assert.match(cli.err.join("\n"), /missing required argument 'kodierung'/);
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
  const code = await run(["processes", "get", "P1", "1.0", "999", "17"], cli.deps);
  assert.equal(code, 1);
  assert.equal(cli.mt.calls.length, 0);
  assert.match(cli.err.join("\n"), /Invalid Detaillierungsstufe "999"/);
});

test("processes get accepts a valid Detaillierungsstufe", async () => {
  const cli = makeCli(() => jsonResponse({ ok: true }));
  const code = await run(["processes", "get", "P1", "1.0", "101", "17"], cli.deps);
  assert.equal(code, 0);
  assert.equal(new URL(cli.mt.last().url).pathname, "/api/v0/processes/P1/1.0/101/17");
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

// ---- search-csv ----

test("search-csv maps options to query params and streams CSV to stdout", async () => {
  const cli = makeCli(() => rawResponse(fx.csvBody, "text/csv"));
  const code = await run(
    [
      "search-csv",
      "--resource",
      "field",
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
  assert.equal(q.get("resource"), "field");
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

for (const resource of ["schema", "document-profile", "field", "group", "leistung-steckbriefe", "processclass", "process"]) {
  test(`search-csv accepts --resource ${resource}`, async () => {
    const cli = makeCli(() => rawResponse(fx.csvBody, "text/csv"));
    const code = await run(["search-csv", "--resource", resource], cli.deps);
    assert.equal(code, 0);
    assert.equal(new URL(cli.mt.last().url).searchParams.get("resource"), resource);
  });
}

test("search-csv rejects a --resource the server would silently replace with Leistungen", async () => {
  for (const resource of ["schemas", "fields", "leistungen", "steckbriefe", "bogus"]) {
    const cli = makeCli(() => rawResponse(fx.csvBody, "text/csv"));
    const code = await run(["search-csv", "--resource", resource], cli.deps);
    assert.equal(code, 1, resource);
    assert.equal(cli.mt.calls.length, 0);
    assert.match(cli.err.join("\n"), /Allowed choices are schema, document-profile, field/);
  }
});

test("search-csv forwards the other filters verbatim (no enum guard)", async () => {
  // Only --resource is checked; the other CSV filters are forwarded unvalidated.
  const cli = makeCli(() => rawResponse(fx.csvBody, "text/csv"));
  const code = await run(
    ["search-csv", "--resource", "field", "--feldart", "bogus"],
    cli.deps,
  );
  assert.equal(code, 0);
  assert.equal(new URL(cli.mt.last().url).searchParams.get("feldart"), "bogus");
});

test("search-csv writes the CSV to --output and reports bytes on stderr", async () => {
  const cli = makeCli(() => rawResponse(fx.csvBody, "text/csv"));
  const code = await run(
    ["--output", "/tmp/fields.csv", "search-csv", "--resource", "field"],
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

// ---- blank values are a usage error, never an empty parameter ----

// Each free-text, filter or id input once, set to "" (plus one whitespace case).
// A blank value is never meaningful: it must be rejected at parse time, before
// any request, instead of being sent as `key=` or an empty path segment.
const blankCases: Array<[string, string[]]> = [
  ["--bezug-unterelemente", ["schemas", "search", "--bezug-unterelemente", ""]],
  ["--bezeichnung", ["schemas", "search", "--bezeichnung", ""]],
  ["--stichwort", ["schemas", "search", "--stichwort", ""]],
  ["--name", ["schemas", "search", "--name", ""]],
  ["--name (whitespace)", ["schemas", "search", "--name", "   "]],
  ["--nummernkreis", ["schemas", "search", "--nummernkreis", ""]],
  ["--gueltig-am", ["schemas", "search", "--gueltig-am", ""]],
  ["--status-gesetzt-durch", ["schemas", "search", "--status-gesetzt-durch", ""]],
  ["--status-gesetzt-seit", ["schemas", "search", "--status-gesetzt-seit", ""]],
  ["--status-gesetzt-bis", ["schemas", "search", "--status-gesetzt-bis", ""]],
  ["--bezug", ["schemas", "search", "--bezug", ""]],
  ["--versionshinweis", ["schemas", "search", "--versionshinweis", ""]],
  ["--updated-since", ["schemas", "search", "--updated-since", ""]],
  ["--fts-query", ["schemas", "search", "--fts-query", ""]],
  ["--leistungstyp", ["service-profiles", "search", "--leistungstyp", ""]],
  ["--typisierung", ["service-profiles", "search", "--typisierung", ""]],
  ["--title", ["service-profiles", "search", "--title", ""]],
  ["--leistungsbezeichnung", ["service-profiles", "search", "--leistungsbezeichnung", ""]],
  ["--leistungsbezeichnung2", ["service-profiles", "search", "--leistungsbezeichnung2", ""]],
  ["--leistungsschluessel", ["service-profiles", "search", "--leistungsschluessel", ""]],
  ["--rechtsgrundlagen", ["service-profiles", "search", "--rechtsgrundlagen", ""]],
  ["--sdg", ["service-profiles", "search", "--sdg", ""]],
  ["--leistungsadressat", ["service-profiles", "search", "--leistungsadressat", ""]],
  ["--ozg-themenfeld", ["service-profiles", "search", "--ozg-themenfeld", ""]],
  ["--ozg-id", ["service-profiles", "search", "--ozg-id", ""]],
  ["--lagen-portalverbund", ["service-profiles", "search", "--lagen-portalverbund", ""]],
  ["--redaktion-id", ["service-texts", "search", "--redaktion-id", ""]],
  ["--resource", ["search-csv", "--resource", ""]],
  ["--term", ["search-csv", "--resource", "field", "--term", ""]],
  ["--xdf-version", ["search-csv", "--resource", "field", "--xdf-version", ""]],
  ["--order-by", ["search-csv", "--resource", "field", "--order-by", ""]],
  ["--feldart", ["search-csv", "--resource", "field", "--feldart", ""]],
  ["--datentyp", ["search-csv", "--resource", "field", "--datentyp", ""]],
  ["--dokumentart", ["search-csv", "--resource", "field", "--dokumentart", ""]],
  ["--sprache", ["search-csv", "--resource", "field", "--sprache", ""]],
  ["<fimId>", ["schemas", "versions", ""]],
  ["[fimVersion]", ["schemas", "get", "S1", ""]],
  ["<namespace>", ["fields", "versions", "", "F1"]],
  ["<leistungsschluessel>", ["service-profiles", "get", ""]],
  ["<languageCode>", ["service-profiles", "pdf", "99123456760000", ""]],
  ["<redaktionId>", ["organizational-units", "xzufi", "", "1"]],
  ["<id>", ["process-classes", "get", "", "1.0"]],
  ["<version>", ["process-classes", "get", "P1", ""]],
  ["service-texts <redaktionId>", ["service-texts", "get", "", "L1", "leika"]],
  ["service-texts <leistungId>", ["service-texts", "get", "R1", "", "leika"]],
  ["service-texts <source>", ["service-texts", "get", "R1", "L1", ""]],
  ["service-texts <languageCode>", ["service-texts", "pdf", "R1", "L1", "leika", ""]],
];

for (const [input, argv] of blankCases) {
  test(`a blank ${input} is a usage error with no request`, async () => {
    const cli = makeCli(() => jsonResponse({}));
    const code = await run(argv, cli.deps);
    assert.notEqual(code, 0);
    assert.equal(cli.mt.calls.length, 0);
  });
}
