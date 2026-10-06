// P10 (fix plan 2026-10-06), fim-portal's own cases: no parameter the portal would ignore
// reaches it. An unknown or misspelled key, a wrong value type, a list for a single-value
// parameter, and — for the CSV export — a filter for another resource or a value outside
// its domain are FimValidationErrors before any request; a repeated single-value flag is a
// usage error. Each of these returned the whole unfiltered result live (exploratory
// results 01 and 06). The shared conformance-p10 test comes from marktstammdatenregister-cli.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FimPortalClient } from "../src/client/client.js";
import { FimValidationError } from "../src/client/errors.js";
import { run } from "../src/cli/run.js";
import type { CliDeps } from "../src/cli/io.js";
import type { SearchCsvParams } from "../src/client/params.js";
import { makeMockTransport, jsonResponse, rawResponse } from "./helpers.js";

const page = { items: [], offset: 0, limit: 200, count: 0, total_count: 0 };

function recording(body: () => ReturnType<typeof jsonResponse> = () => jsonResponse(page)) {
  const mt = makeMockTransport(body);
  return { client: new FimPortalClient({ transport: mt.transport }), mt };
}

async function rejects(call: () => Promise<unknown>, message: RegExp, label: string, mt: { calls: unknown[] }): Promise<void> {
  await assert.rejects(call, (e: unknown) => e instanceof FimValidationError && message.test(e.message), label);
  assert.equal(mt.calls.length, 0, `${label}: a request was sent`);
}

test("P10: an unknown or misspelled search parameter is refused, with a suggestion", async () => {
  for (const [params, message] of [
    [{ fts_querry: "zzqqxx" }, /parameter "fts_querry": schemas\.search has no such parameter \(did you mean fts_query\?\)/],
    [{ ftsQuery: "zzqqxx" }, /\(did you mean fts_query\?\)/],
    [{ versionshinweis: "zzz" }, /\(did you mean Versionshinweis\?\)/],
    [{ totally_unrelated_key: "x" }, /has no such parameter; the portal would ignore it/],
    [JSON.parse('{"__proto__": {"x": 1}}'), /parameter "__proto__"/],
    [{ constructor: "x" }, /parameter "constructor"/],
  ] as const) {
    const { client, mt } = recording();
    await rejects(() => client.schemas.search(params as object), message, JSON.stringify(params), mt);
  }
});

test("P10: every search and list call checks its own parameter table", async () => {
  const calls: Array<[string, (c: FimPortalClient) => Promise<unknown>]> = [
    ["documentProfiles.search gueltig_am", (c) => c.documentProfiles.search({ gueltig_am: "2026-01-01" } as object)],
    ["fields.search stichwort", (c) => c.fields.search({ stichwort: "x" } as object)],
    ["groups.search feldart", (c) => c.groups.search({ feldart: "input" } as object)],
    ["serviceProfiles.search source", (c) => c.serviceProfiles.search({ source: "leika" } as object)],
    ["serviceTexts.search sprache", (c) => c.serviceTexts.search({ sprache: "Englisch" } as object)],
    ["processClasses.search detaillierungsstufe", (c) => c.processClasses.search({ detaillierungsstufe: "101" } as object)],
    ["processes.search is_latest", (c) => c.processes.search({ is_latest: true } as object)],
    ["specializations.list fts_query (ignored upstream)", (c) => c.specializations.list({ fts_query: "x" })],
    ["codeLists.list name", (c) => c.codeLists.list({ name: "x" } as object)],
  ];
  for (const [label, call] of calls) {
    const { client, mt } = recording();
    await rejects(() => call(client), /has no such parameter/, label, mt);
  }
  // The documented parameters still go through.
  const { client, mt } = recording();
  await client.organizationalUnits.list({ fts_query: "Amt", cursor: 0, limit: 5 });
  await client.serviceTexts.search({ redaktion_id: "B100019", source: "leika", leistungstyp: ["lo"] });
  assert.equal(mt.calls.length, 2);
});

test("P10: wrong value types, lists for single values and non-object parameters are refused", async () => {
  for (const [label, call, message] of [
    ["a bare string", (c: FimPortalClient) => c.schemas.search("Geburt" as unknown as object), /Expected an object of query parameters, got a string/],
    ["a list as parameters", (c: FimPortalClient) => c.schemas.search(["Geburt"] as unknown as object), /got an array/],
    ["name: NaN", (c: FimPortalClient) => c.schemas.search({ name: NaN as unknown as string }), /Invalid name: Expected a string\./],
    ["fts_query: an object", (c: FimPortalClient) => c.schemas.search({ fts_query: {} as unknown as string }), /Invalid fts_query: Expected a string\./],
    ["name: two values", (c: FimPortalClient) => c.schemas.search({ name: ["a", "b"] as unknown as string }), /Invalid name: Expected a single value, not a list/],
    ["is_latest: 'true'", (c: FimPortalClient) => c.schemas.search({ is_latest: "true" as unknown as boolean }), /Invalid is_latest: Expected true or false\./],
    ["nummernkreis: [5]", (c: FimPortalClient) => c.schemas.search({ nummernkreis: [5 as unknown as string] }), /Invalid nummernkreis: Expected a string\./],
    ["xdf_version: two values", (c: FimPortalClient) => c.schemas.search({ xdf_version: ["2.0", "3.0.0"] as unknown as "2.0" }), /Expected a single value/],
  ] as const) {
    const { client, mt } = recording();
    await rejects(() => call(client), message, label, mt);
  }
  // A list parameter also takes a single value, and a date filter a Date.
  const { client, mt } = recording();
  await client.schemas.search({ nummernkreis: "01" as unknown as string[], updated_since: new Date(0) as unknown as string });
  assert.equal(new URL(mt.last().url).searchParams.get("updated_since"), "1970-01-01T00:00:00.000Z");
});

test("P10: allowUnknownFilters sends a parameter the table doesn't know, still type-checked", async () => {
  const { client, mt } = recording();
  await client.schemas.search({ brand_new_filter: "x", limit: 1 } as object, { allowUnknownFilters: true });
  assert.equal(new URL(mt.last().url).searchParams.get("brand_new_filter"), "x");
  await assert.rejects(
    client.schemas.search({ brand_new_filter: {} } as object, { allowUnknownFilters: true }),
    (e: unknown) => e instanceof FimValidationError && /Invalid brand_new_filter: Expected a string, number, boolean or Date/.test(e.message),
  );
  assert.equal(mt.calls.length, 1);
});

test("P10: the CSV export refuses unknown keys, inapplicable filters and unknown values", async () => {
  for (const [params, message] of [
    [{ resource: "process", term: "Feuerbestattung", detaillierungsstufe: "999" }, /Invalid detaillierungsstufe: Expected one of: 101, 102, 103, 104, 105\./],
    [{ resource: "field", term: "Familienname", feldart: "SELECT" }, /Invalid feldart: Expected one of: input, select/],
    [{ resource: "field", datentyp: "string" }, /Invalid datentyp: Expected one of/],
    [{ resource: "field", xdf_version: "3" }, /Invalid xdf_version: Expected one of: 2\.0, 3\.0\.0\./],
    [{ resource: "document-profile", dokumentart: "1" }, /Invalid dokumentart: Expected one of: 001/],
    [{ resource: "leistung-steckbriefe", sprache: "Klingonisch" }, /Invalid sprache: Expected one of: Deutsch/],
    [{ resource: "schema", term: "Wohngeld", feldart: "select" }, /Invalid feldart: it filters resource field only, not schema; the CSV export would ignore it/],
    [{ resource: "schema", sprache: "Englisch" }, /Invalid sprache: it filters resource leistung-steckbriefe only, not schema/],
    [{ resource: "processclass", detaillierungsstufe: "101" }, /it filters resource process only, not processclass/],
    [{ resource: "field", order_by: "titel_asc" }, /Invalid order_by: Expected one of: relevance/],
    // The CSV export reads sdg_relevant as Ja/Nein (the JSON search's true/false is ignored, live 2026-10-05).
    [{ resource: "leistung-steckbriefe", sdg_relevant: "true" }, /Invalid sdg_relevant: Expected one of: Ja, Nein\./],
    [{ resource: "leistung-steckbriefe", sdg_relevant: "ja" }, /Invalid sdg_relevant: Expected one of: Ja, Nein\./],
    [{ resource: "schema", sdg_relevant: "Ja" }, /Invalid sdg_relevant: it filters resource leistung-steckbriefe only, not schema/],
    // abstraktionsstufe filters document profiles only, as Abstrakt/Konkret (portal source; live 2026-10-06).
    [{ resource: "document-profile", abstraktionsstufe: "konkret" }, /Invalid abstraktionsstufe: Expected one of: Abstrakt, Konkret\./],
    [{ resource: "process", abstraktionsstufe: "Abstrakt" }, /Invalid abstraktionsstufe: it filters resource document-profile only, not process/],
    // The process exports have no sort order: the portal never reads order_by for them.
    [{ resource: "process", order_by: "name_asc" }, /Invalid order_by: the CSV export of process has no sort order/],
    [{ resource: "processclass", order_by: "relevance" }, /Invalid order_by: the CSV export of processclass has no sort order/],
    [{ resource: "field", feldartt: "select" }, /parameter "feldartt": tools\.searchCsvDownload has no such parameter \(did you mean feldart\?\)/],
    [{ resource: "field", feldart: ["input", "select"] }, /Invalid feldart: Expected a single value, not a list/],
    [{ resource: "field", term: 5 }, /Invalid term: Expected a string\./],
    [{ resource: "schemas" }, /Invalid resource: Expected one of: schema, document-profile/],
  ] as const) {
    const { client, mt } = recording(() => rawResponse("a,b\n", "text/csv"));
    await rejects(() => client.tools.searchCsvDownload(params as unknown as SearchCsvParams), message, JSON.stringify(params), mt);
  }
});

test("P10: the CSV export sends filters that apply, and allowUnknownFilters sends the rest", async () => {
  const { client, mt } = recording(() => rawResponse("a,b\n", "text/csv"));
  for (const params of [
    { resource: "process", term: "Feuerbestattung", detaillierungsstufe: "105" },
    { resource: "field", term: "Familienname", feldart: "select", datentyp: "text", xdf_version: "3.0.0", order_by: "name_asc" },
    { resource: "leistung-steckbriefe", sprache: "Englisch", order_by: "titel_asc", sdg_relevant: "Nein" },
    { resource: "document-profile", abstraktionsstufe: "Konkret", order_by: "name_asc" },
  ] as const) {
    await client.tools.searchCsvDownload(params as unknown as SearchCsvParams);
  }
  assert.equal(mt.calls.length, 4);
  await client.tools.searchCsvDownload({ resource: "schema", feldart: "select", brand_new: "x" } as SearchCsvParams, {
    allowUnknownFilters: true,
  });
  const q = new URL(mt.last().url).searchParams;
  assert.equal(q.get("feldart"), "select");
  assert.equal(q.get("brand_new"), "x");
});

function cli() {
  const out: string[] = [];
  const err: string[] = [];
  const mt = makeMockTransport(() => jsonResponse(page));
  const deps: CliDeps = {
    io: { out: (s) => out.push(s), err: (s) => err.push(s), writeFile: () => {}, outBinary: () => {} },
    createClient: (opts) => new FimPortalClient({ ...opts, transport: mt.transport }),
  };
  return { deps, out, err, mt };
}

test("P10: a single-value option given twice is a usage error; repeatable ones collect", async () => {
  for (const argv of [
    ["schemas", "search", "--name", "A", "--name", "B"],
    ["fields", "search", "--feldart", "input", "--feldart", "select"],
    ["--timeout", "1000", "code-lists", "--timeout", "2000"],
    ["--base-url", "https://fimportal.de", "--base-url", "https://schema.fim.fitko.net", "code-lists"],
    ["-o", "a.json", "--output", "b.json", "code-lists"],
  ]) {
    const c = cli();
    assert.equal(await run(argv, c.deps), 1, argv.join(" "));
    assert.equal(c.mt.calls.length, 0, argv.join(" "));
    assert.match(c.err.join("\n"), /was given more than once; it takes one value\./, argv.join(" "));
  }
  const c = cli();
  assert.equal(await run(["schemas", "search", "--nummernkreis", "01", "--nummernkreis", "02", "--freigabe-status", "5", "--freigabe-status", "6"], c.deps), 0);
  const q = new URL(c.mt.last().url).searchParams;
  assert.deepEqual(q.getAll("nummernkreis"), ["01", "02"]);
  assert.deepEqual(q.getAll("freigabe_status"), ["5", "6"]);
});
