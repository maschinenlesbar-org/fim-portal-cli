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
