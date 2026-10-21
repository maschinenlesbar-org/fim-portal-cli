import { test } from "node:test";
import assert from "node:assert/strict";
import { FimPortalClient } from "../src/client.js";
import { FimError, FimParseError, FimValidationError } from "../src/errors.js";
import { makeMockTransport, jsonResponse, rawResponse, queryOf } from "./helpers.js";
import * as fx from "./fixtures.js";

const BASE = "https://fimportal.de";

function clientReturning(body: unknown, contentType = "application/json") {
  const mt = makeMockTransport(() =>
    contentType === "application/json"
      ? jsonResponse(body)
      : rawResponse(String(body), contentType),
  );
  return { client: new FimPortalClient({ transport: mt.transport }), mt };
}

// ---- URL / method mapping: one assertion per open endpoint ----

const cases: Array<{ name: string; run: (c: FimPortalClient) => Promise<unknown>; url: string }> = [
  { name: "schemas.versions", run: (c) => c.schemas.versions("S07000009"), url: `${BASE}/api/v1/schemas/S07000009` },
  { name: "schemas.get", run: (c) => c.schemas.get("S07000009", "1.0"), url: `${BASE}/api/v1/schemas/S07000009/1.0` },
  { name: "schemas.get latest default", run: (c) => c.schemas.get("S07000009"), url: `${BASE}/api/v1/schemas/S07000009/latest` },
  { name: "schemas.downloadXdf", run: (c) => c.schemas.downloadXdf("S1", "1.0"), url: `${BASE}/api/v1/schemas/S1/1.0/xdf` },
  { name: "schemas.qualityReport", run: (c) => c.schemas.qualityReport("S1", "1.0"), url: `${BASE}/api/v1/schemas/S1/1.0/quality-report` },

  { name: "documentProfiles.versions", run: (c) => c.documentProfiles.versions("D1"), url: `${BASE}/api/v1/document-profiles/D1` },
  { name: "documentProfiles.get", run: (c) => c.documentProfiles.get("D1", "1.0"), url: `${BASE}/api/v1/document-profiles/D1/1.0` },
  { name: "documentProfiles.downloadXdf", run: (c) => c.documentProfiles.downloadXdf("D1", "1.0"), url: `${BASE}/api/v1/document-profiles/D1/1.0/xdf` },

  { name: "fields.versions", run: (c) => c.fields.versions("ns", "F1"), url: `${BASE}/api/v1/fields/ns/F1` },
  { name: "fields.get", run: (c) => c.fields.get("ns", "F1", "1.1"), url: `${BASE}/api/v1/fields/ns/F1/1.1` },
  { name: "fields.downloadXdf", run: (c) => c.fields.downloadXdf("ns", "F1", "1.1"), url: `${BASE}/api/v1/fields/ns/F1/1.1/xdf` },

  { name: "groups.versions", run: (c) => c.groups.versions("ns", "G1"), url: `${BASE}/api/v1/groups/ns/G1` },
  { name: "groups.get", run: (c) => c.groups.get("ns", "G1", "1.1"), url: `${BASE}/api/v1/groups/ns/G1/1.1` },
  { name: "groups.downloadXdf", run: (c) => c.groups.downloadXdf("ns", "G1", "1.1"), url: `${BASE}/api/v1/groups/ns/G1/1.1/xdf` },

  { name: "serviceProfiles.get", run: (c) => c.serviceProfiles.get("99050048262000"), url: `${BASE}/api/v1/leistung-steckbriefe/99050048262000` },
  { name: "serviceProfiles.downloadXzufi", run: (c) => c.serviceProfiles.downloadXzufi("K1"), url: `${BASE}/api/v1/leistung-steckbriefe/K1/xzufi` },
  { name: "serviceProfiles.exportPdf", run: (c) => c.serviceProfiles.exportPdf("K1", "de-DE"), url: `${BASE}/api/v1/leistung-steckbriefe/K1/de-DE/pdf` },

  { name: "serviceTexts.get", run: (c) => c.serviceTexts.get("R1", "L1", "leika"), url: `${BASE}/api/v1/leistung-stammtexte/R1/L1/leika` },
  { name: "serviceTexts.downloadXzufi", run: (c) => c.serviceTexts.downloadXzufi("R1", "L1", "pvog"), url: `${BASE}/api/v1/leistung-stammtexte/R1/L1/pvog/xzufi` },
  { name: "serviceTexts.exportPdf", run: (c) => c.serviceTexts.exportPdf("R1", "L1", "leika", "en"), url: `${BASE}/api/v1/leistung-stammtexte/R1/L1/leika/en/pdf` },
  { name: "serviceTexts.parsedXzufi", run: (c) => c.serviceTexts.parsedXzufi("R1", "L1", "leika"), url: `${BASE}/api/v0/leistung-stammtexte/R1/L1/leika/parsed-xzufi` },

  { name: "organizationalUnits.downloadXzufi", run: (c) => c.organizationalUnits.downloadXzufi("R1", "O1"), url: `${BASE}/api/v0/organizational-unit/R1/O1/xzufi` },
  { name: "specializations.downloadXzufi", run: (c) => c.specializations.downloadXzufi("R1", "S1"), url: `${BASE}/api/v0/specialization/R1/S1/xzufi` },
  { name: "onlineServices.downloadXzufi", run: (c) => c.onlineServices.downloadXzufi("R1", "N1"), url: `${BASE}/api/v0/online-service/R1/N1/xzufi` },

  { name: "processClasses.get", run: (c) => c.processClasses.get("P1", "1.0"), url: `${BASE}/api/v0/processclasses/P1/1.0` },
  { name: "processClasses.downloadXprozess", run: (c) => c.processClasses.downloadXprozess("P1", "1.0"), url: `${BASE}/api/v0/processclasses/P1/1.0/xprozess` },

  { name: "processes.get", run: (c) => c.processes.get("P1", "1.0", "101", "17"), url: `${BASE}/api/v0/processes/P1/1.0/101/17` },
  { name: "processes.downloadXprozess", run: (c) => c.processes.downloadXprozess("P1", "1.0", "101", "17"), url: `${BASE}/api/v0/processes/P1/1.0/101/17/xprozess` },
  { name: "processes.downloadReport", run: (c) => c.processes.downloadReport("P1", "1.0", "101", "17"), url: `${BASE}/api/v0/processes/P1/1.0/101/17/report` },
  { name: "processes.downloadVisualization", run: (c) => c.processes.downloadVisualization("P1", "1.0", "101", "17"), url: `${BASE}/api/v0/processes/P1/1.0/101/17/visualization` },
  { name: "processes.downloadVisualizationDisplay", run: (c) => c.processes.downloadVisualizationDisplay("P1", "1.0", "101", "17"), url: `${BASE}/api/v0/processes/P1/1.0/101/17/visualization_display` },
];

for (const tc of cases) {
  test(`client maps ${tc.name} to GET ${tc.url.replace(BASE, "")}`, async () => {
    const download = tc.name.includes("download") || tc.name.includes("Pdf");
    // A body of the documented shape: an array for `versions`, a record otherwise.
    const body = download ? "<xml/>" : tc.name.endsWith(".versions") ? [] : { fim_id: "X1" };
    const { client, mt } = clientReturning(body, download ? "application/xml" : "application/json");
    await tc.run(client);
    assert.equal(mt.last().method, "GET");
    assert.equal(mt.last().url, tc.url);
  });
}

// ---- Query serialisation for search endpoints ----

test("schemas.search serialises filters, arrays and pagination into the query", async () => {
  const { client, mt } = clientReturning(fx.schemaSearchResult);
  const result = await client.schemas.search({
    name: "Geburt",
    freigabe_status: [5, 6],
    nummernkreis: ["01", "02"],
    is_latest: true,
    offset: 0,
    limit: 10,
  });

  assert.deepEqual(result, fx.schemaSearchResult);
  const q = queryOf(mt.last());
  assert.equal(new URL(mt.last().url).pathname, "/api/v1/schemas");
  assert.equal(q.get("name"), "Geburt");
  assert.deepEqual(q.getAll("freigabe_status"), ["5", "6"]);
  assert.deepEqual(q.getAll("nummernkreis"), ["01", "02"]);
  assert.equal(q.get("is_latest"), "true");
  assert.equal(q.get("limit"), "10");
});

test("fields.search hits /api/v1/fields and parses the paginated result", async () => {
  const { client, mt } = clientReturning(fx.fieldSearchResult);
  const result = await client.fields.search({ feldart: "input", datentyp: "text" });
  assert.deepEqual(result, fx.fieldSearchResult);
  const q = queryOf(mt.last());
  assert.equal(q.get("feldart"), "input");
  assert.equal(q.get("datentyp"), "text");
});

test("serviceProfiles.search hits /api/v1/leistung-steckbriefe (the portal moved the service routes off /api/v0/)", async () => {
  const { client, mt } = clientReturning(fx.stammtextSearchResult);
  await client.serviceProfiles.search({ fts_query: "Personalausweis", limit: 1 });
  assert.equal(new URL(mt.last().url).pathname, "/api/v1/leistung-steckbriefe");
});

test("serviceTexts.search hits /api/v1/leistung-stammtexte", async () => {
  const { client, mt } = clientReturning(fx.stammtextSearchResult);
  const result = await client.serviceTexts.search({ source: "leika", fts_query: "Ausweis" });
  assert.deepEqual(result, fx.stammtextSearchResult);
  assert.equal(new URL(mt.last().url).pathname, "/api/v1/leistung-stammtexte");
  assert.equal(queryOf(mt.last()).get("source"), "leika");
});

test("organizationalUnits.list uses cursor pagination", async () => {
  const { client, mt } = clientReturning(fx.orgUnitListResult);
  const result = await client.organizationalUnits.list({ cursor: 100, limit: 50 });
  assert.deepEqual(result, fx.orgUnitListResult);
  const q = queryOf(mt.last());
  assert.equal(q.get("cursor"), "100");
  assert.equal(q.get("limit"), "50");
});

test("raw download returns the XML bytes untouched", async () => {
  const mt = makeMockTransport(() => rawResponse(fx.xmlBody, "application/xml"));
  const client = new FimPortalClient({ transport: mt.transport });
  const res = await client.schemas.downloadXdf("S1", "1.0");
  assert.equal(res.data.toString("utf8"), fx.xmlBody);
  assert.equal(res.contentType, "application/xml");
});

test("path segments are URL-encoded", async () => {
  const { client, mt } = clientReturning({ fim_id: "F1" });
  await client.fields.get("urn:xoev-de:fim", "F1", "1.0");
  assert.equal(
    mt.last().url,
    `${BASE}/api/v1/fields/urn%3Axoev-de%3Afim/F1/1.0`,
  );
});

test("a custom baseUrl is honoured", async () => {
  const mt = makeMockTransport(() => jsonResponse(fx.schemaSearchResult));
  const client = new FimPortalClient({ transport: mt.transport, baseUrl: "https://schema.fim.fitko.net" });
  await client.schemas.search();
  assert.equal(new URL(mt.last().url).host, "schema.fim.fitko.net");
});

// ---- code-lists ----

test("codeLists.list hits /api/v0/code-lists and parses the paginated envelope", async () => {
  const { client, mt } = clientReturning(fx.codeListResult);
  const result = await client.codeLists.list({ offset: 0, limit: 20 });
  assert.deepEqual(result, fx.codeListResult);
  assert.equal(result.total_count, 1);
  assert.equal(result.items[0]?.short_name, "Geschlecht");
  assert.equal(new URL(mt.last().url).pathname, "/api/v0/code-lists");
  const q = queryOf(mt.last());
  assert.equal(q.get("offset"), "0");
  assert.equal(q.get("limit"), "20");
});

// ---- tools / search-csv ----

test("tools.searchCsvDownload hits /tools/search-csv-download and forwards params", async () => {
  const mt = makeMockTransport(() => rawResponse(fx.csvBody, "text/csv"));
  const client = new FimPortalClient({ transport: mt.transport });
  const res = await client.tools.searchCsvDownload({
    resource: "field",
    term: "Name",
    xdf_version: "2.0",
    feldart: "input",
  });
  assert.equal(res.data.toString("utf8"), fx.csvBody);
  assert.equal(res.contentType, "text/csv");
  const url = new URL(mt.last().url);
  assert.equal(url.pathname, "/tools/search-csv-download");
  assert.equal(url.searchParams.get("resource"), "field");
  assert.equal(url.searchParams.get("term"), "Name");
  assert.equal(url.searchParams.get("xdf_version"), "2.0");
  assert.equal(url.searchParams.get("feldart"), "input");
  // Requests a CSV Accept header.
  assert.equal(mt.last().headers?.["accept"] ?? mt.last().headers?.["Accept"], "text/csv");
});

test("the client rejects a non-http(s) base URL even with a custom transport", () => {
  for (const baseUrl of ["file:///etc/passwd", "ftp://example.org"]) {
    const mt = makeMockTransport(() => jsonResponse({}));
    assert.throws(
      () => new FimPortalClient({ transport: mt.transport, baseUrl }),
      (err: unknown) => err instanceof FimValidationError && /Only "http:" and "https:"/.test(err.message),
      baseUrl,
    );
    assert.equal(mt.calls.length, 0);
  }
});

// ---- Dot segments ----

test("an id of . or .. is rejected before any request instead of re-targeting the URL", async () => {
  for (const [name, call] of [
    ["schemas.get", (c: FimPortalClient) => c.schemas.get("S1", "..")],
    ["fields.versions", (c: FimPortalClient) => c.fields.versions("..", "schemas")],
    ["fields.get", (c: FimPortalClient) => c.fields.get(".", "..")],
    ["processes.get", (c: FimPortalClient) => c.processes.get("P1", "1.0", "101", ".")],
  ] as const) {
    const { client, mt } = clientReturning({});
    await assert.rejects(() => call(client), (err: unknown) => {
      assert.ok(err instanceof FimError, name);
      assert.match((err as Error).message, /Invalid path segment "\.\.?" in \/api\/\S+: "\." and "\.\." cannot be used as an id\./);
      return true;
    });
    assert.equal(mt.calls.length, 0, name);
  }
});

test("ids that merely contain dots are still encoded and sent", async () => {
  const { client, mt } = clientReturning({ fim_id: "S1" });
  await client.schemas.get("S1", "1.0.0");
  await client.schemas.get("...", "%2e%2e");
  assert.equal(mt.calls[0]?.url, `${BASE}/api/v1/schemas/S1/1.0.0`);
  assert.equal(mt.calls[1]?.url, `${BASE}/api/v1/schemas/.../%252e%252e`);
});

// ---- 2xx bodies must have the documented shape (P9) ----

test("a 2xx JSON body without the documented shape is a FimParseError, never data", async () => {
  const calls: Array<[string, (c: FimPortalClient) => Promise<unknown>, unknown[]]> = [
    ["schemas.search (page)", (c) => c.schemas.search(), [null, {}, [], "text", 42, { items: "x" }, { error: "boom" }, { items: [] }]],
    ["processes.search (page)", (c) => c.processes.search(), [null, {}, { items: null, total_count: 0 }]],
    ["organizationalUnits.list (cursor)", (c) => c.organizationalUnits.list(), [null, {}, { items: {} }]],
    ["schemas.versions (list)", (c) => c.schemas.versions("S1"), [null, {}, { items: [] }, "x"]],
    ["schemas.get (record)", (c) => c.schemas.get("S1"), [null, {}, [], "x", 0]],
    ["processes.get (record)", (c) => c.processes.get("P1", "1.0", "101", "17"), [null, {}, []]],
  ];
  for (const [label, call, bodies] of calls) {
    for (const body of bodies) {
      const { client } = clientReturning(body);
      await assert.rejects(
        call(client),
        (e: unknown) => e instanceof FimParseError && /^GET https:\/\/fimportal\.de\/\S*: unexpected response shape/.test(e.message),
        `${label}: ${JSON.stringify(body)}`,
      );
    }
  }
  // The documented shapes pass.
  assert.deepEqual(await clientReturning(fx.schemaSearchResult).client.schemas.search(), fx.schemaSearchResult);
  assert.deepEqual(await clientReturning(fx.orgUnitListResult).client.organizationalUnits.list(), fx.orgUnitListResult);
  assert.deepEqual(await clientReturning([fx.schemaOut]).client.schemas.versions("S1"), [fx.schemaOut]);
});

test("an error envelope ({detail}) answered with a 2xx to a record is a FimParseError naming it, never the record", async () => {
  const calls: Array<[string, (c: FimPortalClient) => Promise<unknown>]> = [
    ["schemas.get", (c) => c.schemas.get("S1")],
    ["schemas.qualityReport", (c) => c.schemas.qualityReport("S1")],
    ["serviceProfiles.get", (c) => c.serviceProfiles.get("99008001012012")],
  ];
  for (const [label, call] of calls) {
    for (const [body, said] of [
      [{ detail: "not ok" }, /got an error envelope: not ok\.$/],
      [{ detail: [{ msg: "field required", loc: ["path", "fim_id"] }] }, /got an error envelope: /],
      [{ detail: null }, /got an error envelope\.$/],
    ] as const) {
      await assert.rejects(
        call(clientReturning(body).client),
        (e: unknown) => e instanceof FimParseError && /^GET https:\/\/fimportal\.de\/\S+: unexpected response shape \(HTTP 200\): expected a record/.test(e.message) && said.test(e.message),
        `${label}: ${JSON.stringify(body)}`,
      );
    }
  }
  // A record that has a field named detail among its own is data.
  const record = { fim_id: "S1", detail: "a field of the record" };
  assert.deepEqual(await clientReturning(record).client.schemas.get("S1"), record);
});

test("an HTML page answered with a 2xx to a download is a FimParseError", async () => {
  for (const [body, type] of [
    ["<html>oops</html>", "text/html; charset=utf-8"],
    ["<!DOCTYPE html><html><body>maintenance</body></html>", "application/pdf"],
    ["  <html lang=de>", ""],
  ] as const) {
    const { client } = clientReturning(body, type);
    await assert.rejects(
      client.processes.downloadReport("P1", "1.0", "101", "17"),
      (e: unknown) => e instanceof FimParseError && /expected application\/pdf, got an HTML page/.test(e.message),
      `${type}: ${body}`,
    );
  }
  const { client } = clientReturning("%PDF-1.4", "application/pdf");
  assert.equal((await client.processes.downloadReport("P1", "1.0", "101", "17")).data.toString(), "%PDF-1.4");
});

test("every method DEVELOPING.md's Methods paragraph names exists on the client", async () => {
  const { readFileSync } = await import("node:fs");
  const text = readFileSync(new URL("../../../../DEVELOPING.md", import.meta.url), "utf8");
  const paragraph = text.slice(text.indexOf("### Methods"), text.indexOf("## Authentication internals"));
  const named = [...paragraph.matchAll(/`(\w+)\(\)`/g)].map((m) => m[1]!);
  assert.ok(named.length >= 10, paragraph);
  const client = new FimPortalClient({ transport: async () => jsonResponse({}) }) as unknown as Record<string, object>;
  const methods = new Set<string>();
  for (const group of Object.values(client)) {
    for (let proto = Object.getPrototypeOf(group); proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
      for (const name of Object.getOwnPropertyNames(proto)) methods.add(name);
    }
  }
  for (const name of named) assert.ok(methods.has(name), `DEVELOPING.md names ${name}(), which no resource group has`);
});

// ---- text filters go out canonical: trimmed, NFC ----

const DECOMPOSED = "  Müller\t";
const COMPOSED = "Müller";

test("every free-text filter is sent trimmed and in composed Unicode (NFC); codes, dates and enum values are tokens, sent trimmed and in NFC (D8)", async () => {
  const textFilters: Array<[string, (c: FimPortalClient) => Promise<unknown>, string]> = [
    ["name", (c) => c.schemas.search({ name: DECOMPOSED }), "name"],
    ["fts_query", (c) => c.fields.search({ fts_query: DECOMPOSED }), "fts_query"],
    ["bezeichnung", (c) => c.documentProfiles.search({ bezeichnung: DECOMPOSED }), "bezeichnung"],
    ["stichwort", (c) => c.schemas.search({ stichwort: DECOMPOSED }), "stichwort"],
    ["bezug", (c) => c.groups.search({ bezug: DECOMPOSED }), "bezug"],
    ["bezug_unterelemente", (c) => c.schemas.search({ bezug_unterelemente: DECOMPOSED }), "bezug_unterelemente"],
    ["Versionshinweis", (c) => c.schemas.search({ Versionshinweis: DECOMPOSED }), "Versionshinweis"],
    ["status_gesetzt_durch", (c) => c.fields.search({ status_gesetzt_durch: DECOMPOSED }), "status_gesetzt_durch"],
    ["title", (c) => c.serviceProfiles.search({ title: DECOMPOSED }), "title"],
    ["leistungsbezeichnung", (c) => c.serviceTexts.search({ leistungsbezeichnung: DECOMPOSED }), "leistungsbezeichnung"],
    ["leistungsbezeichnung2", (c) => c.serviceProfiles.search({ leistungsbezeichnung2: DECOMPOSED }), "leistungsbezeichnung2"],
    ["rechtsgrundlagen", (c) => c.serviceTexts.search({ rechtsgrundlagen: DECOMPOSED }), "rechtsgrundlagen"],
    ["processClasses fts_query", (c) => c.processClasses.search({ fts_query: DECOMPOSED }), "fts_query"],
    ["processes fts_query", (c) => c.processes.search({ fts_query: DECOMPOSED }), "fts_query"],
    ["organizationalUnits fts_query", (c) => c.organizationalUnits.list({ fts_query: DECOMPOSED }), "fts_query"],
    ["search-csv term", (c) => c.tools.searchCsvDownload({ resource: "schema", term: DECOMPOSED }), "term"],
  ];
  for (const [label, call, key] of textFilters) {
    const mt = makeMockTransport((req) =>
      req.url.includes("search-csv") ? rawResponse("a\n", "text/csv") : req.url.includes("organizational-unit") ? jsonResponse({ items: [] }) : jsonResponse({ items: [], total_count: 0 }),
    );
    await call(new FimPortalClient({ transport: mt.transport }));
    assert.equal(queryOf(mt.last()).get(key), COMPOSED, label);
  }
  // Codes, keys, dates and enum values are tokens: trimmed and in NFC (a pasted code with a
  // trailing space matched nothing).
  const mt = makeMockTransport((req) => (req.url.includes("search-csv") ? rawResponse("a\n", "text/csv") : jsonResponse({ items: [], total_count: 0 })));
  const params = { nummernkreis: ["01 ", " 02"], leistungsschluessel: " 99001\u0065\u0301\n", name: " A ", updated_since: " 2024-01-01", xdf_version: " 2.0 " };
  const c = new FimPortalClient({ transport: mt.transport });
  await c.serviceTexts.search({ leistungsschluessel: params.leistungsschluessel, updated_since: params.updated_since });
  assert.equal(queryOf(mt.last()).get("leistungsschluessel"), "99001\u00e9");
  assert.equal(queryOf(mt.last()).get("updated_since"), "2024-01-01");
  await c.schemas.search({ nummernkreis: params.nummernkreis, name: params.name, xdf_version: params.xdf_version as "2.0" });
  assert.deepEqual(queryOf(mt.last()).getAll("nummernkreis"), ["01", "02"]);
  assert.equal(queryOf(mt.last()).get("xdf_version"), "2.0");
  await c.tools.searchCsvDownload({ resource: "field", feldart: " input", term: " A " });
  assert.equal(queryOf(mt.last()).get("feldart"), "input");
  assert.deepEqual(
    params,
    { nummernkreis: ["01 ", " 02"], leistungsschluessel: " 99001\u0065\u0301\n", name: " A ", updated_since: " 2024-01-01", xdf_version: " 2.0 " },
    "the caller's object is not changed",
  );
  // A token with an invisible or control character inside is refused, naming it visibly.
  for (const [call, re] of [
    [() => c.serviceTexts.search({ leistungsschluessel: "9900\u200b1" }), /^Invalid leistungsschluessel: "9900\\u200b1" contains an invisible or control character \(U\+200B\)\.$/],
    [() => c.schemas.search({ nummernkreis: ["01", "0\u00ad2"] }), /^Invalid nummernkreis: item 2 of 2: "0\\u00ad2" contains an invisible/],
    [() => c.schemas.versions("S1\u200b"), /^Invalid fimId: "S1\\u200b" contains an invisible/],
  ] as const) {
    const before = mt.calls.length;
    await assert.rejects(call(), (e: unknown) => e instanceof FimValidationError && re.test(e.message));
    assert.equal(mt.calls.length, before);
  }
});

test("a text filter that is blank once trimmed is refused before any request", async () => {
  for (const blank of ["", " ", " ", "\n\t", "　"]) {
    const mt = makeMockTransport(() => jsonResponse({ items: [], total_count: 0 }));
    await assert.rejects(new FimPortalClient({ transport: mt.transport }).schemas.search({ name: blank }), FimValidationError, JSON.stringify(blank));
    await assert.rejects(new FimPortalClient({ transport: mt.transport }).tools.searchCsvDownload({ resource: "schema", term: blank }), FimValidationError, JSON.stringify(blank));
    assert.equal(mt.calls.length, 0);
  }
});

// ---- path ids: trimmed, never a "/" ----

test("a path id is sent trimmed; one with a \"/\", or a dot segment once trimmed, is refused before any request", async () => {
  const mt = makeMockTransport(() => jsonResponse([{ id: "a1" }]));
  const client = new FimPortalClient({ transport: mt.transport });
  await client.schemas.versions(" S1\n");
  assert.equal(mt.last().url, `${BASE}/api/v1/schemas/S1`);
  await client.serviceTexts.get(" R1 ", "\tL1", "leika").catch(() => {});
  assert.equal(mt.last().url, `${BASE}/api/v1/leistung-stammtexte/R1/L1/leika`);
  const before = mt.calls.length;
  for (const id of ["S1/../S2", "S1/", "/S1", " .. ", "."]) {
    await assert.rejects(client.schemas.versions(id), FimValidationError, JSON.stringify(id));
    await assert.rejects(client.fields.versions(id, "F1"), FimValidationError, JSON.stringify(id));
  }
  await assert.rejects(client.schemas.versions("S1/x"), /Invalid fimId: An id cannot contain "\/"/);
  assert.equal(mt.calls.length, before);
});

test("a refusal quotes the value visibly: invisible and format characters escaped, never raw (D10)", async () => {
  const { client, mt } = clientReturning(fx.schemaSearchResult);
  for (const key of ["fts​query", "name‮", "­name"]) {
    await assert.rejects(
      client.schemas.search({ [key]: "x" } as never),
      (e: unknown) =>
        e instanceof FimValidationError &&
        /\\u(200b|202e|00ad)/.test(e.message) &&
        !/[​‮­]/.test(e.message),
      JSON.stringify(key),
    );
  }
  assert.equal(mt.calls.length, 0);
});
