import { test } from "node:test";
import assert from "node:assert/strict";
import { FimPortalClient } from "../src/client/client.js";
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

  { name: "serviceProfiles.get", run: (c) => c.serviceProfiles.get("99050048262000"), url: `${BASE}/api/v0/leistung-steckbriefe/99050048262000` },
  { name: "serviceProfiles.downloadXzufi", run: (c) => c.serviceProfiles.downloadXzufi("K1"), url: `${BASE}/api/v0/leistung-steckbriefe/K1/xzufi` },
  { name: "serviceProfiles.exportPdf", run: (c) => c.serviceProfiles.exportPdf("K1", "de-DE"), url: `${BASE}/api/v0/leistung-steckbriefe/K1/de-DE/pdf` },

  { name: "serviceTexts.get", run: (c) => c.serviceTexts.get("R1", "L1", "leika"), url: `${BASE}/api/v0/leistung-stammtexte/R1/L1/leika` },
  { name: "serviceTexts.downloadXzufi", run: (c) => c.serviceTexts.downloadXzufi("R1", "L1", "pvog"), url: `${BASE}/api/v0/leistung-stammtexte/R1/L1/pvog/xzufi` },
  { name: "serviceTexts.exportPdf", run: (c) => c.serviceTexts.exportPdf("R1", "L1", "leika", "en"), url: `${BASE}/api/v0/leistung-stammtexte/R1/L1/leika/en/pdf` },
  { name: "serviceTexts.parsedXzufi", run: (c) => c.serviceTexts.parsedXzufi("R1", "L1", "leika"), url: `${BASE}/api/v0/leistung-stammtexte/R1/L1/leika/parsed-xzufi` },

  { name: "organizationalUnits.downloadXzufi", run: (c) => c.organizationalUnits.downloadXzufi("R1", "O1"), url: `${BASE}/api/v0/organizational-unit/R1/O1/xzufi` },
  { name: "specializations.downloadXzufi", run: (c) => c.specializations.downloadXzufi("R1", "S1"), url: `${BASE}/api/v0/specialization/R1/S1/xzufi` },
  { name: "onlineServices.downloadXzufi", run: (c) => c.onlineServices.downloadXzufi("R1", "N1"), url: `${BASE}/api/v0/online-service/R1/N1/xzufi` },

  { name: "processClasses.get", run: (c) => c.processClasses.get("P1", "1.0"), url: `${BASE}/api/v0/processclasses/P1/1.0` },
  { name: "processClasses.getXprozess", run: (c) => c.processClasses.getXprozess("P1", "1.0"), url: `${BASE}/api/v0/processclasses/P1/1.0/xprozess` },

  { name: "processes.get", run: (c) => c.processes.get("P1", "1.0", "101"), url: `${BASE}/api/v0/processes/P1/1.0/101` },
  { name: "processes.downloadXprozess", run: (c) => c.processes.downloadXprozess("P1", "1.0", "101"), url: `${BASE}/api/v0/processes/P1/1.0/101/xprozess` },
  { name: "processes.downloadReport", run: (c) => c.processes.downloadReport("P1", "1.0", "101"), url: `${BASE}/api/v0/processes/P1/1.0/101/report` },
  { name: "processes.downloadVisualization", run: (c) => c.processes.downloadVisualization("P1", "1.0", "101"), url: `${BASE}/api/v0/processes/P1/1.0/101/visualization` },
  { name: "processes.downloadVisualizationDisplay", run: (c) => c.processes.downloadVisualizationDisplay("P1", "1.0", "101"), url: `${BASE}/api/v0/processes/P1/1.0/101/visualization_display` },
];

for (const tc of cases) {
  test(`client maps ${tc.name} to GET ${tc.url.replace(BASE, "")}`, async () => {
    const { client, mt } = clientReturning({}, tc.name.includes("download") || tc.name.includes("Pdf") ? "application/xml" : "application/json");
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

test("serviceTexts.search hits /api/v0/leistung-stammtexte", async () => {
  const { client, mt } = clientReturning(fx.stammtextSearchResult);
  const result = await client.serviceTexts.search({ source: "leika", fts_query: "Ausweis" });
  assert.deepEqual(result, fx.stammtextSearchResult);
  assert.equal(new URL(mt.last().url).pathname, "/api/v0/leistung-stammtexte");
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
  const { client, mt } = clientReturning({});
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
    resource: "fields",
    term: "Name",
    xdf_version: "2.0",
    feldart: "input",
  });
  assert.equal(res.data.toString("utf8"), fx.csvBody);
  assert.equal(res.contentType, "text/csv");
  const url = new URL(mt.last().url);
  assert.equal(url.pathname, "/tools/search-csv-download");
  assert.equal(url.searchParams.get("resource"), "fields");
  assert.equal(url.searchParams.get("term"), "Name");
  assert.equal(url.searchParams.get("xdf_version"), "2.0");
  assert.equal(url.searchParams.get("feldart"), "input");
  // Requests a CSV Accept header.
  assert.equal(mt.last().headers?.["accept"] ?? mt.last().headers?.["Accept"], "text/csv");
});
