// CLI ↔ library parity: the same input through run() and through the library
// call the CLI makes, on one recording mock transport, must give the same outcome
// — both reject before any request, or both send the identical request.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FimPortalClient } from "../src/client/client.js";
import { FimValidationError } from "../src/client/errors.js";
import type { Transport } from "../src/client/http.js";
import { parity, requestShapes, jsonResponse, rawResponse } from "./helpers.js";

const client = (transport: Transport) => new FimPortalClient({ transport });

/** Both sides reject the input and neither sends a request. */
async function assertBothReject(
  argv: string[],
  call: (transport: Transport) => unknown,
  message: RegExp,
): Promise<void> {
  const { cli, lib } = await parity(argv, call);
  const label = JSON.stringify(argv);
  assert.equal(cli.code, 1, `${label}: CLI exit code`);
  assert.equal(cli.requests.length, 0, `${label}: CLI sent a request`);
  assert.equal(lib.ok, false, `${label}: library accepted the input`);
  if (!lib.ok) {
    assert.ok(lib.error instanceof FimValidationError, `${label}: ${String(lib.error)}`);
    assert.match((lib.error as Error).message, message, label);
  }
  assert.equal(lib.requests.length, 0, `${label}: library sent a request`);
}

// ---- Finding #2 (PAT-9): blank search/list filters ----

const blankFilterCases: Array<[string[], (t: Transport) => unknown, RegExp]> = [
  [["schemas", "search", "--name", ""], (t) => client(t).schemas.search({ name: "" }), /^Invalid name: Expected a non-empty value\.$/],
  [["schemas", "search", "--name", "   "], (t) => client(t).schemas.search({ name: "   " }), /^Invalid name: /],
  [
    ["fields", "search", "--nummernkreis", "07", "--nummernkreis", " "],
    (t) => client(t).fields.search({ nummernkreis: ["07", " "] }),
    /^Invalid nummernkreis: /,
  ],
  [["document-profiles", "search", "--fts-query", "\t"], (t) => client(t).documentProfiles.search({ fts_query: "\t" }), /^Invalid fts_query: /],
  [["service-profiles", "search", "--title", ""], (t) => client(t).serviceProfiles.search({ title: "" }), /^Invalid title: /],
  [["service-texts", "search", "--redaktion-id", " "], (t) => client(t).serviceTexts.search({ redaktion_id: " " }), /^Invalid redaktion_id: /],
  [["organizational-units", "list", "--fts-query", ""], (t) => client(t).organizationalUnits.list({ fts_query: "" }), /^Invalid fts_query: /],
  [["process-classes", "search", "--fts-query", " "], (t) => client(t).processClasses.search({ fts_query: " " }), /^Invalid fts_query: /],
  [["processes", "search", "--fts-query", "  "], (t) => client(t).processes.search({ fts_query: "  " }), /^Invalid fts_query: /],
  [
    ["search-csv", "--resource", "field", "--term", ""],
    (t) => client(t).tools.searchCsvDownload({ resource: "field", term: "" }),
    /^Invalid term: /,
  ],
];

for (const [argv, call, message] of blankFilterCases) {
  test(`parity: a blank filter is rejected by CLI and library alike (${argv.join(" ")})`, async () => {
    await assertBothReject(argv, call, message);
  });
}

test("parity: a non-blank filter sends the identical request from CLI and library", async () => {
  const { cli, lib } = await parity(
    ["schemas", "search", "--name", "Wohn", "--nummernkreis", "07"],
    (t) => client(t).schemas.search({ name: "Wohn", nummernkreis: ["07"] }),
    () => jsonResponse({ items: [] }),
  );
  assert.equal(cli.code, 0);
  assert.ok(lib.ok);
  assert.deepEqual(requestShapes(cli.requests), requestShapes(lib.requests));
});

test("parity: search-csv with a non-blank term sends the identical request", async () => {
  const { cli, lib } = await parity(
    ["search-csv", "--resource", "field", "--term", "Name"],
    (t) => client(t).tools.searchCsvDownload({ resource: "field", term: "Name" }),
    () => rawResponse("a;b\n", "text/csv"),
  );
  assert.equal(cli.code, 0);
  assert.ok(lib.ok);
  assert.deepEqual(requestShapes(cli.requests), requestShapes(lib.requests));
});

// ---- Finding #1 (PAT-10): blank path ids ----

const blankIdCases: Array<[string[], (t: Transport) => unknown, RegExp]> = [
  [["schemas", "versions", ""], (t) => client(t).schemas.versions(""), /^Invalid fimId: Expected a non-empty value\.$/],
  [["schemas", "versions", "  "], (t) => client(t).schemas.versions("  "), /^Invalid fimId: /],
  [["schemas", "get", "S1", ""], (t) => client(t).schemas.get("S1", ""), /^Invalid fimVersion: /],
  [["schemas", "quality-report", "", "1.0"], (t) => client(t).schemas.qualityReport("", "1.0"), /^Invalid fimId: /],
  [["document-profiles", "versions", ""], (t) => client(t).documentProfiles.versions(""), /^Invalid fimId: /],
  [["fields", "get", "ns", "F1", ""], (t) => client(t).fields.get("ns", "F1", ""), /^Invalid fimVersion: /],
  [["groups", "xdf", "ns", "", "1.0"], (t) => client(t).groups.downloadXdf("ns", "", "1.0"), /^Invalid fimId: /],
  [["service-profiles", "get", ""], (t) => client(t).serviceProfiles.get(""), /^Invalid leistungsschluessel: /],
  [["service-profiles", "pdf", "K", ""], (t) => client(t).serviceProfiles.exportPdf("K", ""), /^Invalid languageCode: /],
  [["service-texts", "get", "", "L1", "leika"], (t) => client(t).serviceTexts.get("", "L1", "leika"), /^Invalid redaktionId: /],
  [["service-texts", "pdf", "R1", "L1", "leika", " "], (t) => client(t).serviceTexts.exportPdf("R1", "L1", "leika", " "), /^Invalid languageCode: /],
  [["organizational-units", "xzufi", "R1", ""], (t) => client(t).organizationalUnits.downloadXzufi("R1", ""), /^Invalid id: /],
  [["specializations", "xzufi", "", "S1"], (t) => client(t).specializations.downloadXzufi("", "S1"), /^Invalid redaktionId: /],
  [["process-classes", "get", "P1", ""], (t) => client(t).processClasses.get("P1", ""), /^Invalid version: /],
  [["processes", "report", "P1", " ", "101", "17"], (t) => client(t).processes.downloadReport("P1", " ", "101", "17"), /^Invalid version: /],
  [["processes", "get", "P1", "1.0", "101", ""], (t) => client(t).processes.get("P1", "1.0", "101", ""), /^Invalid kodierung: /],
];

for (const [argv, call, message] of blankIdCases) {
  test(`parity: a blank path id is rejected by CLI and library alike (${argv.join(" ")})`, async () => {
    await assertBothReject(argv, call, message);
  });
}

test("parity: a valid path id sends the identical request from CLI and library", async () => {
  const { cli, lib } = await parity(
    ["schemas", "get", "S1", "1.0"],
    (t) => client(t).schemas.get("S1", "1.0"),
    () => jsonResponse({ fim_id: "S1" }),
  );
  assert.equal(cli.code, 0);
  assert.ok(lib.ok);
  assert.deepEqual(requestShapes(cli.requests), requestShapes(lib.requests));
});

// ---- Finding #3 (PAT-12): the search-csv resource is required and from the allow-list ----

const csvResourceCases: Array<[string[], Record<string, string | undefined>]> = [
  [["search-csv", "--resource", "schemas", "--term", "Name"], { resource: "schemas", term: "Name" }],
  [["search-csv", "--resource", " schema", "--term", "Name"], { resource: " schema", term: "Name" }],
  [["search-csv", "--resource", "", "--term", "Name"], { resource: "", term: "Name" }],
  [["search-csv", "--term", "Name"], { term: "Name" }],
];

for (const [argv, params] of csvResourceCases) {
  test(`parity: search-csv rejects resource ${JSON.stringify(params["resource"])} on both sides`, async () => {
    await assertBothReject(
      argv,
      // A plain-JS caller (or a cast) can pass any string or none at all.
      (t) => client(t).tools.searchCsvDownload(params as never),
      /^Invalid resource: Expected one of: schema, document-profile, field, group, leistung-steckbriefe, processclass, process\.$/,
    );
  });
}

test("parity: search-csv with a known resource sends the identical request", async () => {
  const { cli, lib } = await parity(
    ["search-csv", "--resource", "schema", "--term", "Name"],
    (t) => client(t).tools.searchCsvDownload({ resource: "schema", term: "Name" }),
    () => rawResponse("a;b\n", "text/csv"),
  );
  assert.equal(cli.code, 0);
  assert.ok(lib.ok);
  assert.deepEqual(requestShapes(cli.requests), requestShapes(lib.requests));
});

// ---- Finding #8 (PAT-12): enum-typed query and path values ----

// Plain-JS callers, casts and values taken from data bypass the TypeScript unions.
const anyClient = (t: Transport) => client(t) as unknown as {
  [group: string]: { [method: string]: (...args: unknown[]) => Promise<unknown> };
};

const enumCases: Array<[string[], (t: Transport) => unknown, RegExp]> = [
  [["processes", "get", "P1", "1.0", "999", "17"], (t) => anyClient(t)["processes"]!["get"]!("P1", "1.0", "999", "17"), /^Invalid stufe: Expected one of: 101, 102, 103, 104, 105\.$/],
  [["processes", "report", "P1", "1.0", " 101", "17"], (t) => anyClient(t)["processes"]!["downloadReport"]!("P1", "1.0", " 101", "17"), /^Invalid stufe: /],
  [["processes", "xprozess", "P1", "1.0", "999", "17"], (t) => anyClient(t)["processes"]!["downloadXprozess"]!("P1", "1.0", "999", "17"), /^Invalid stufe: /],
  [["service-texts", "get", "R1", "L1", "bogus"], (t) => anyClient(t)["serviceTexts"]!["get"]!("R1", "L1", "bogus"), /^Invalid source: Expected one of: leika, landesredaktion, pvog\.$/],
  [["service-texts", "pdf", "R1", "L1", "LEIKA", "de"], (t) => anyClient(t)["serviceTexts"]!["exportPdf"]!("R1", "L1", "LEIKA", "de"), /^Invalid source: /],
  [["processes", "search", "--anwendungsgebiet", "1"], (t) => anyClient(t)["processes"]!["search"]!({ anwendungsgebiet: "1" }), /^Invalid anwendungsgebiet: /],
  [["processes", "search", "--detaillierungsstufe", "999"], (t) => anyClient(t)["processes"]!["search"]!({ detaillierungsstufe: "999" }), /^Invalid detaillierungsstufe: /],
  [["fields", "search", "--feldart", "INPUT"], (t) => anyClient(t)["fields"]!["search"]!({ feldart: "INPUT" }), /^Invalid feldart: /],
  [["fields", "search", "--datentyp", "TEXT"], (t) => anyClient(t)["fields"]!["search"]!({ datentyp: "TEXT" }), /^Invalid datentyp: /],
  [["fields", "search", "--suche-nur-in", "Stichwort"], (t) => anyClient(t)["fields"]!["search"]!({ suche_nur_in: "Stichwort" }), /^Invalid suche_nur_in: /],
  [["schemas", "search", "--xdf-version", " 2.0"], (t) => anyClient(t)["schemas"]!["search"]!({ xdf_version: " 2.0" }), /^Invalid xdf_version: /],
  [["schemas", "search", "--order-by", "NAME_ASC"], (t) => anyClient(t)["schemas"]!["search"]!({ order_by: "NAME_ASC" }), /^Invalid order_by: /],
  [["schemas", "search", "--freigabe-status", "NaN"], (t) => anyClient(t)["schemas"]!["search"]!({ freigabe_status: [NaN] }), /^Invalid freigabe_status: Expected one of: 1, 2, 3, 4, 5, 6, 7, 8\.$/],
  [["schemas", "search", "--freigabe-status", "9"], (t) => anyClient(t)["schemas"]!["search"]!({ freigabe_status: [5, 9] }), /^Invalid freigabe_status: /],
  [["groups", "search", "--suche-nur-in", "Foo"], (t) => anyClient(t)["groups"]!["search"]!({ suche_nur_in: "Foo" }), /^Invalid suche_nur_in: /],
  [["document-profiles", "search", "--dokumentart", " 001"], (t) => anyClient(t)["documentProfiles"]!["search"]!({ dokumentart: " 001" }), /^Invalid dokumentart: /],
  [["process-classes", "search", "--operatives-ziel", "000"], (t) => anyClient(t)["processClasses"]!["search"]!({ operatives_ziel: "000" }), /^Invalid operatives_ziel: /],
  [["process-classes", "search", "--verfahrensart", "000"], (t) => anyClient(t)["processClasses"]!["search"]!({ verfahrensart: "000" }), /^Invalid verfahrensart: /],
  [["process-classes", "search", "--handlungsform", "000"], (t) => anyClient(t)["processClasses"]!["search"]!({ handlungsform: "000" }), /^Invalid handlungsform: /],
  [["process-classes", "search", "--freigabe-status", "0"], (t) => anyClient(t)["processClasses"]!["search"]!({ freigabe_status: [0] }), /^Invalid freigabe_status: /],
  [["service-profiles", "search", "--sprache", "Klingonisch"], (t) => anyClient(t)["serviceProfiles"]!["search"]!({ sprache: "Klingonisch" }), /^Invalid sprache: /],
  [["service-profiles", "search", "--vollzugsbehoerde", "XYZ"], (t) => anyClient(t)["serviceProfiles"]!["search"]!({ vollzugsbehoerde: "XYZ" }), /^Invalid vollzugsbehoerde: /],
  [["service-profiles", "search", "--order-by", "name_asc"], (t) => anyClient(t)["serviceProfiles"]!["search"]!({ order_by: "name_asc" }), /^Invalid order_by: /],
  [["service-profiles", "search", "--suche-nur-in", "titel"], (t) => anyClient(t)["serviceProfiles"]!["search"]!({ suche_nur_in: "titel" }), /^Invalid suche_nur_in: /],
  [["service-texts", "search", "--source", "primary"], (t) => anyClient(t)["serviceTexts"]!["search"]!({ source: "primary" }), /^Invalid source: /],
  [["service-texts", "search", "--order-by", "id_asc"], (t) => anyClient(t)["serviceTexts"]!["search"]!({ order_by: "id_asc" }), /^Invalid order_by: /],
];

for (const [argv, call, message] of enumCases) {
  test(`parity: an out-of-domain enum value is rejected by CLI and library alike (${argv.join(" ")})`, async () => {
    await assertBothReject(argv, call, message);
  });
}

test("parity: valid enum values send the identical request from CLI and library", async () => {
  for (const [argv, call] of [
    [["processes", "get", "P1", "1.0", "101", "17"], (t: Transport) => client(t).processes.get("P1", "1.0", "101", "17")],
    [["service-texts", "get", "R1", "L1", "pvog"], (t: Transport) => client(t).serviceTexts.get("R1", "L1", "pvog")],
    [
      ["fields", "search", "--feldart", "input", "--freigabe-status", "5", "--xdf-version", "3.0.0"],
      (t: Transport) => client(t).fields.search({ freigabe_status: [5], xdf_version: "3.0.0", feldart: "input" }),
    ],
    [
      ["service-profiles", "search", "--leistungstyp", "lo", "--sprache", "Deutsch"],
      (t: Transport) => client(t).serviceProfiles.search({ leistungstyp: ["lo"], sprache: "Deutsch" }),
    ],
  ] as const) {
    const { cli, lib } = await parity([...argv], call, () => jsonResponse({ items: [] }));
    assert.equal(cli.code, 0, argv.join(" "));
    assert.ok(lib.ok, argv.join(" "));
    assert.deepEqual(requestShapes(cli.requests), requestShapes(lib.requests), argv.join(" "));
  }
});

// ---- Finding #4 (PAT-11): pagination bounds ----

const paginationCases: Array<[string[], (t: Transport) => unknown, RegExp]> = [
  [["schemas", "search", "--limit", "500"], (t) => client(t).schemas.search({ limit: 500 }), /^Invalid limit: Must be <= 200\.$/],
  [["schemas", "search", "--limit", "0"], (t) => client(t).schemas.search({ limit: 0 }), /^Invalid limit: Must be >= 1\.$/],
  [["groups", "search", "--limit", "1.5"], (t) => client(t).groups.search({ limit: 1.5 }), /^Invalid limit: Expected an integer\.$/],
  [["processes", "search", "--limit", "Infinity"], (t) => client(t).processes.search({ limit: Infinity }), /^Invalid limit: Expected an integer\.$/],
  [["fields", "search", "--offset", "-1"], (t) => client(t).fields.search({ offset: -1 }), /^Invalid offset: Expected a non-negative integer\.$/],
  [["service-texts", "search", "--offset", "NaN"], (t) => client(t).serviceTexts.search({ offset: NaN }), /^Invalid offset: /],
  [["document-profiles", "search", "--offset", "1e21"], (t) => client(t).documentProfiles.search({ offset: 1e21 }), /^Invalid offset: /],
  [["service-profiles", "search", "--limit", "201"], (t) => client(t).serviceProfiles.search({ limit: 201 }), /^Invalid limit: /],
  [["process-classes", "search", "--limit", "500"], (t) => client(t).processClasses.search({ limit: 500 }), /^Invalid limit: /],
  [["code-lists", "--offset", "1e21"], (t) => client(t).codeLists.list({ offset: 1e21 }), /^Invalid offset: /],
  [["code-lists", "--limit", "500"], (t) => client(t).codeLists.list({ limit: 500 }), /^Invalid limit: /],
  [["specializations", "list", "--cursor", "-1"], (t) => client(t).specializations.list({ cursor: -1 }), /^Invalid cursor: Expected a non-negative integer\.$/],
  [["online-services", "list", "--limit", "0"], (t) => client(t).onlineServices.list({ limit: 0 }), /^Invalid limit: /],
  [["organizational-units", "list", "--cursor", "1.5"], (t) => client(t).organizationalUnits.list({ cursor: 1.5 }), /^Invalid cursor: /],
];

for (const [argv, call, message] of paginationCases) {
  test(`parity: an out-of-range page parameter is rejected by CLI and library alike (${argv.join(" ")})`, async () => {
    await assertBothReject(argv, call, message);
  });
}

test("parity: in-range pagination sends the identical request from CLI and library", async () => {
  for (const [argv, call] of [
    [["schemas", "search", "--offset", "20", "--limit", "10"], (t: Transport) => client(t).schemas.search({ offset: 20, limit: 10 })],
    [["code-lists", "--offset", "0", "--limit", "200"], (t: Transport) => client(t).codeLists.list({ offset: 0, limit: 200 })],
    [["specializations", "list", "--cursor", "0", "--limit", "1"], (t: Transport) => client(t).specializations.list({ cursor: 0, limit: 1 })],
  ] as const) {
    const { cli, lib } = await parity([...argv], call, () => jsonResponse({ items: [] }));
    assert.equal(cli.code, 0, argv.join(" "));
    assert.ok(lib.ok, argv.join(" "));
    assert.deepEqual(requestShapes(cli.requests), requestShapes(lib.requests), argv.join(" "));
  }
});

// ---- Finding #5 (PAT-8): the engine's numeric limits ----

const engineOptionCases: Array<[string[], Record<string, number>, RegExp]> = [
  [["--timeout", "-1"], { timeoutMs: -1 }, /^Invalid timeoutMs: Must be >= 0\.$/],
  [["--timeout", "NaN"], { timeoutMs: NaN }, /^Invalid timeoutMs: Expected an integer\.$/],
  [["--timeout", "1.5"], { timeoutMs: 1.5 }, /^Invalid timeoutMs: Expected an integer\.$/],
  [["--timeout", "2147483648"], { timeoutMs: 2_147_483_648 }, /^Invalid timeoutMs: Must be <= 2147483647\.$/],
  [["--max-response-bytes", "-1"], { maxResponseBytes: -1 }, /^Invalid maxResponseBytes: Must be >= 0\.$/],
  [["--max-response-bytes", "NaN"], { maxResponseBytes: NaN }, /^Invalid maxResponseBytes: Expected an integer\.$/],
  [["--max-retries", "11"], { maxRetries: 11 }, /^Invalid maxRetries: Must be <= 10\.$/],
  [["--max-retries", "50"], { maxRetries: 50 }, /^Invalid maxRetries: Must be <= 10\.$/],
  [["--max-retries", "1.5"], { maxRetries: 1.5 }, /^Invalid maxRetries: Expected an integer\.$/],
  [["--max-retries", "-1"], { maxRetries: -1 }, /^Invalid maxRetries: Must be >= 0\.$/],
];

for (const [flags, options, message] of engineOptionCases) {
  test(`parity: an out-of-range engine option is rejected by CLI and library alike (${flags.join(" ")})`, async () => {
    await assertBothReject(
      [...flags, "schemas", "versions", "S1"],
      (t) => new FimPortalClient({ ...options, transport: t }).schemas.versions("S1"),
      message,
    );
  });
}

test("parity: in-range engine options send the identical request from CLI and library", async () => {
  const { cli, lib } = await parity(
    ["--timeout", "0", "--max-retries", "10", "--max-response-bytes", "0", "schemas", "versions", "S1"],
    (t) => new FimPortalClient({ timeoutMs: 0, maxRetries: 10, maxResponseBytes: 0, transport: t }).schemas.versions("S1"),
    () => jsonResponse([]),
  );
  assert.equal(cli.code, 0);
  assert.ok(lib.ok);
  assert.deepEqual(cli.requests, lib.requests);
});

// ---- Finding #6 (PAT-5): User-Agent validity ----

const CR = String.fromCharCode(0x0d);
const LF = String.fromCharCode(0x0a);
const userAgentCases: Array<[string, RegExp]> = [
  [`a${CR}${LF}X-Evil: 1`, /^Invalid userAgent: Value contains control characters\.$/],
  [`x${String.fromCharCode(0)}y`, /^Invalid userAgent: Value contains control characters\.$/],
  [`a${String.fromCharCode(0x7f)}`, /^Invalid userAgent: Value contains control characters\.$/],
  ["agent€", /^Invalid userAgent: Value contains characters outside Latin-1 \(above U\+00FF\)\.$/],
  ["", /^Invalid userAgent: Expected a non-empty value\.$/],
  ["   ", /^Invalid userAgent: Expected a non-empty value\.$/],
];

for (const [userAgent, message] of userAgentCases) {
  test(`parity: an unsendable User-Agent ${JSON.stringify(userAgent)} is rejected by CLI and library alike`, async () => {
    await assertBothReject(
      ["--user-agent", userAgent, "schemas", "versions", "S1"],
      (t) => new FimPortalClient({ userAgent, transport: t }).schemas.versions("S1"),
      message,
    );
  });
}

test("parity: a valid Latin-1 User-Agent with a tab is sent identically by CLI and library", async () => {
  const userAgent = "müller-bot/1.0\t(test)";
  const { cli, lib } = await parity(
    ["--user-agent", userAgent, "schemas", "versions", "S1"],
    (t) => new FimPortalClient({ userAgent, transport: t }).schemas.versions("S1"),
    () => jsonResponse([]),
  );
  assert.equal(cli.code, 0);
  assert.ok(lib.ok);
  assert.deepEqual(requestShapes(cli.requests), requestShapes(lib.requests));
  assert.equal(lib.requests[0]?.headers?.["User-Agent"], userAgent);
});

// ---- Finding #7 (PAT-1): whitespace in the base URL ----

const TAB = String.fromCharCode(0x09);
const baseUrlWhitespaceCases: Array<[string, RegExp]> = [
  ["https://x.example/ ", /^Invalid baseUrl: A base URL cannot have surrounding whitespace\.$/],
  [" https://x.example", /^Invalid baseUrl: A base URL cannot have surrounding whitespace\.$/],
  ["https://x.example ", /^Invalid baseUrl: A base URL cannot have surrounding whitespace\.$/],
  [`${TAB}https://x.example`, /^Invalid baseUrl: A base URL cannot have surrounding whitespace\.$/],
  [`https://x.example${LF}`, /^Invalid baseUrl: A base URL cannot have surrounding whitespace\.$/],
  // new URL() silently strips an interior tab or newline too; the engine would not.
  [`https://x.ex${TAB}ample`, /^Invalid baseUrl: A base URL cannot contain whitespace or control characters\.$/],
  [`https://x.example/fi${LF}m`, /^Invalid baseUrl: A base URL cannot contain whitespace or control characters\.$/],
  [`https://x.example/f${String.fromCharCode(0x7f)}`, /^Invalid baseUrl: A base URL cannot contain whitespace or control characters\.$/],
];

for (const [baseUrl, message] of baseUrlWhitespaceCases) {
  test(`parity: base URL ${JSON.stringify(baseUrl)} is rejected by CLI and library alike`, async () => {
    await assertBothReject(
      ["--base-url", baseUrl, "schemas", "versions", "S1"],
      (t) => new FimPortalClient({ baseUrl, transport: t }).schemas.versions("S1"),
      message,
    );
  });
}

test("parity: a clean base URL with a trailing slash sends the identical request", async () => {
  const { cli, lib } = await parity(
    ["--base-url", "https://x.example/", "schemas", "versions", "S1"],
    (t) => new FimPortalClient({ baseUrl: "https://x.example/", transport: t }).schemas.versions("S1"),
    () => jsonResponse([]),
  );
  assert.equal(cli.code, 0);
  assert.ok(lib.ok);
  assert.deepEqual(requestShapes(cli.requests), requestShapes(lib.requests));
  assert.equal(lib.requests[0]?.url, "https://x.example/api/v1/schemas/S1");
});
