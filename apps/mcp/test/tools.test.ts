// This server's tools against a mock of the FIM Portal API (the client's live answers of
// 2026-11-19), with the skills' traps as cases: each tool answers through the protocol (its
// structuredContent checked by the SDK against its output schema), released fields lead and the
// namesake ranks first, a quality report is split by severity, the outline comes from the group
// catalogue and pages, a service's texts carry their sources, a schema name that fits several is
// ambiguous, and every result names its requests and the portal's terms. The rules every server
// follows are the conformance tests (M1–M10).

import { test } from "node:test";
import assert from "node:assert/strict";
import { listTools } from "../src/mcp/server.js";
import { DEADLINE_HINT, SIZE_HINT, TOOLS } from "../src/mcp/tools.js";
import { connect } from "./harness.js";
import { fimPortalAnswer, fimPortalApi, makeMockTransport, TEXT_B100019, TEXTS_99008001012011, variant } from "./helpers.js";

const API = "https://fimportal.de";

test("seven tools: the four use cases, then search, one element and one service text", () => {
  assert.deepEqual(listTools().map((t) => t.name), ["findReusableFields", "auditSchemaQuality", "getSchemaBlueprint", "getServiceDossier", "searchCatalogue", "getElement", "getServiceText"]);
});

test("the deadline's and the size cap's advice fit every tool: each option is named with the tools that take it", async () => {
  const properties = new Map(TOOLS.map((tool) => [tool.name, Object.keys((tool.inputSchema as { properties: Record<string, unknown> }).properties)]));
  const options = new Set([...properties.values()].flat());
  for (const hint of [DEADLINE_HINT, SIZE_HINT]) {
    const [, advice = ""] = hint.split(/ask for less: /i);
    const segments = advice.replace(/\.$/, "").split("; ");
    assert.ok(segments.length >= 3, hint);
    for (const segment of segments) {
      const [, before = "", tools = ""] = /^(.*?) \(([A-Za-z, ]+)\)/.exec(segment) ?? [];
      const named = before.split(/\W+/).filter((word) => options.has(word));
      assert.ok(named.length > 0 && tools !== "", `${segment}: names no option or no tool`);
      for (const tool of tools.split(", ")) {
        for (const option of named) assert.ok(properties.get(tool)?.includes(option), `${tool} takes no ${option}: ${hint}`);
      }
    }
  }
  // The deadline's text, as a call stopped at it answers.
  const hanging = { transport: (): Promise<never> => new Promise<never>(() => {}) };
  const connection = await connect({ transport: hanging, config: { callTimeoutMs: 30 } });
  const text = (await connection.call("getElement", { kind: "schema", id: "S05000039" })).content[0]?.text ?? "";
  await connection.close();
  assert.match(text, /took longer than .* and was stopped\. The FIM Portal is sometimes slow: try again shortly/);
});

test("findReusableFields: the gold namesake first, with its namespace; the request asks for released, latest ones; the source and the terms", async () => {
  const transport = fimPortalApi();
  const connection = await connect({ transport });
  const result = await connection.call("findReusableFields", { query: "Staatsangehörigkeit", feldart: "select", limit: 2 });
  const content = result.structuredContent ?? {};
  assert.equal(content["status"], "ok", result.content[0]?.text);
  const [first] = content["candidates"] as { fimId: string; namespace: string; statusLabel: string }[];
  assert.deepEqual([first?.fimId, first?.namespace, first?.statusLabel], ["F60000236", "baukasten", "fachlich freigegeben (gold)"]);
  assert.equal(content["source"], `${API}/api/v1/fields?fts_query=Staatsangeh%C3%B6rigkeit&feldart=select&freigabe_status=5&freigabe_status=6&is_latest=true&limit=200`);
  assert.equal(content["source"], transport.last().url, "the source is the request");
  assert.match(String(content["licence"]), /^Quelle: FIM Portal .*FITKO.*No licence is published.*DATA_LICENSE\.md$/);
  const group = await connection.call("findReusableFields", { kind: "group", query: "Anschrift", feldart: "input" });
  assert.equal(group.isError, true);
  assert.match(group.content[0]?.text ?? "", /groups have neither/);
  await connection.close();
});

test("auditSchemaQuality: the verdict leads with the critical finding; by name, several schemas are ambiguous and no report is fetched", async () => {
  const transport = fimPortalApi();
  const connection = await connect({ transport });
  const content = (await connection.call("auditSchemaQuality", { schema: "S05000039" })).structuredContent ?? {};
  assert.equal(content["status"], "ok");
  assert.match(String(content["verdict"]), /1 critical\): needs fixes: 1 critical/);
  assert.equal(content["source"], `${API}/{api/v1/schemas/S05000039/latest/quality-report,api/v1/schemas/S05000039/latest}`);
  const before = transport.calls.length;
  const ambiguous = (await connection.call("auditSchemaQuality", { schema: "Hundesteuer" })).structuredContent ?? {};
  assert.equal(ambiguous["status"], "ambiguous");
  assert.equal(transport.calls.length, before + 1);
  assert.equal(ambiguous["source"], `${API}/api/v1/schemas?fts_query=Hundesteuer&is_latest=true&limit=10`);
  const named = (await connection.call("auditSchemaQuality", { schema: "Anmeldung zur Hundesteuer" })).structuredContent ?? {};
  assert.equal(named["source"], `${API}/{api/v1/schemas?fts_query=Anmeldung%20zur%20Hundesteuer&is_latest=true&limit=10,api/v1/schemas/S05000039/latest/quality-report,api/v1/schemas/S05000039/latest}`);
  await connection.close();
});

test("getSchemaBlueprint: the outline pages; a name only mentioned inside is empty with the hits", async () => {
  const connection = await connect({ transport: fimPortalApi() });
  const content = (await connection.call("getSchemaBlueprint", { schema: "S05000039", depth: 3, limit: 5 })).structuredContent ?? {};
  assert.equal(content["status"], "ok");
  assert.equal((content["outline"] as unknown[]).length, 5);
  assert.equal(content["nextOffset"], 5);
  assert.ok((content["outlineLines"] as number) > 5);
  assert.equal(content["source"], `${API}/api/v1/schemas/S05000039/latest`);
  const next = (await connection.call("getSchemaBlueprint", { schema: "S05000039", depth: 3, offset: 5, limit: 2 })).structuredContent ?? {};
  assert.equal((next["outline"] as { id: string }[])[0]?.id, "G05000527");
  const mentioned = (await connection.call("getSchemaBlueprint", { schema: "Elterngeld" })).structuredContent ?? {};
  assert.equal(mentioned["status"], "empty");
  assert.equal((mentioned["candidates"] as unknown[]).length, 10);
  await connection.close();
});

test("getServiceDossier and getServiceText: the texts with their sources, then one text by the source the dossier gave", async () => {
  const transport = fimPortalApi();
  const connection = await connect({ transport });
  const dossier = (await connection.call("getServiceDossier", { service: "99008001012011" })).structuredContent ?? {};
  assert.equal(dossier["status"], "ok");
  assert.equal(dossier["source"], `${API}/{api/v1/leistung-steckbriefe/99008001012011,api/v1/leistung-stammtexte?leistungsschluessel=99008001012011&limit=200}`);
  const federal = (dossier["texts"] as { redaktionId: string; leistungId: string; source: string }[])[0]!;
  const text = (await connection.call("getServiceText", { redaktionId: federal.redaktionId, leistungId: federal.leistungId, source: federal.source, limit: 2 })).structuredContent ?? {};
  assert.equal(text["status"], "ok");
  assert.equal((text["paragraphs"] as unknown[]).length, 2);
  assert.equal(text["nextOffset"], 2);
  assert.equal(text["source"], `${API}/api/v1/leistung-stammtexte/B100019/102241587/pvog`);
  const missing = await connection.call("getServiceText", { redaktionId: "B100019", leistungId: "102241587" });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0]?.text ?? "", /can't be told from the redaktionId/);
  const ambiguous = (await connection.call("getServiceDossier", { service: "Personalausweis" })).structuredContent ?? {};
  assert.equal(ambiguous["status"], "ambiguous");
  await connection.close();
});

test("--max-pages limits the pages of a service's texts getServiceDossier reads; the source names each", async () => {
  const first = (TEXTS_99008001012011["items"] as Record<string, unknown>[])[0]!;
  const texts = Array.from({ length: 450 }, (_, i) => ({ ...first, redaktion_id: `L${100000 + i}`, leistung_id: String(i) }));
  for (const [maxPages, read] of [[1, 200], [10, 450]] as const) {
    const transport = fimPortalApi({ serviceTexts: texts as never });
    const connection = await connect({ transport, config: { maxPages, maxResultChars: 1_000_000 } });
    const dossier = (await connection.call("getServiceDossier", { service: "99008001012011" })).structuredContent ?? {};
    await connection.close();
    assert.equal((dossier["texts"] as { source: string | null }[]).filter((t) => t.source !== null).length, read);
    assert.equal(transport.calls.length, 1 + Math.ceil(read / 200));
    assert.equal(dossier["source"], `${API}/{api/v1/leistung-steckbriefe/99008001012011,${transport.calls.slice(1).map((c) => c.url.slice(API.length + 1)).join(",")}}`);
  }
});

test("an empty answer's source names the requests it made, never the bare base", async () => {
  const transport = fimPortalApi();
  const connection = await connect({ transport });
  const unknown = (await connection.call("getServiceDossier", { service: "99999999999999" })).structuredContent ?? {};
  assert.equal(unknown["status"], "empty");
  assert.equal(unknown["source"], `${API}/api/v1/leistung-steckbriefe/99999999999999`);
  assert.equal(unknown["source"], transport.last().url);
  const group = (await connection.call("getSchemaBlueprint", { schema: "S05000039", group: "G99999999" })).structuredContent ?? {};
  assert.equal(group["status"], "empty");
  assert.equal(group["source"], `${API}/api/v1/schemas/S05000039/latest`);
  assert.equal(group["source"], transport.last().url);
  const schema = (await connection.call("auditSchemaQuality", { schema: "S99999999" })).structuredContent ?? {};
  assert.equal(schema["status"], "empty");
  assert.match(String(schema["source"]), /S99999999\/latest/);
  await connection.close();
});

test("getServiceText: the text's source is given back as textSource, which the next page takes; source is the citation", async () => {
  const transport = fimPortalApi();
  const connection = await connect({ transport });
  const first = (await connection.call("getServiceText", { redaktionId: "B100019", leistungId: "102241587", leistungsschluessel: "99008001012011", limit: 2 })).structuredContent ?? {};
  assert.deepEqual([first["status"], first["textSource"], first["sourceLookedUp"]], ["ok", "pvog", true]);
  assert.equal(first["source"], `${API}/{api/v1/leistung-stammtexte?leistungsschluessel=99008001012011&redaktion_id=B100019&limit=200,api/v1/leistung-stammtexte/B100019/102241587/pvog}`);
  const next = await connection.call("getServiceText", { redaktionId: "B100019", leistungId: "102241587", source: first["textSource"], offset: 2, limit: 2 });
  await connection.close();
  assert.equal(next.isError, undefined, next.content[0]?.text);
  assert.equal(next.structuredContent?.["textSource"], "pvog");
});

test("getServiceText: a paragraph of the office's text comes whole, not cut like other upstream text", async () => {
  const long = "lang ".repeat(1000).trim();
  const volltext = `<p>Absatz eins</p><p>${long}</p>${"<p>p</p>".repeat(500)}`;
  const transport = makeMockTransport((request) => (new URL(request.url).pathname.endsWith("/pvog") ? { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify(variant(TEXT_B100019, { volltext }))) } : fimPortalAnswer(request)));
  const connection = await connect({ transport });
  const text = (await connection.call("getServiceText", { redaktionId: "B100019", leistungId: "102241587", source: "pvog", limit: 3 })).structuredContent ?? {};
  await connection.close();
  assert.equal(text["status"], "ok");
  assert.deepEqual(text["paragraphs"], ["Absatz eins", long, "p"]);
  assert.equal(text["paragraphCount"], 502);
  assert.equal(text["nextOffset"], 3);
  assert.equal(text["truncated"], undefined);
});

test("searchCatalogue and getElement: a page with the next offset; a field with its code list and use count", async () => {
  const transport = fimPortalApi();
  const connection = await connect({ transport });
  const page = (await connection.call("searchCatalogue", { resource: "schemas", query: "Hundesteuer", limit: 3 })).structuredContent ?? {};
  assert.deepEqual([page["status"], page["total"], (page["items"] as unknown[]).length, page["nextOffset"]], ["ok", 7, 3, 3]);
  assert.equal(page["source"], `${API}/api/v1/schemas?fts_query=Hundesteuer&is_latest=true&offset=0&limit=3`);
  const field = (await connection.call("getElement", { kind: "field", id: "F60000236" })).structuredContent ?? {};
  assert.equal(field["status"], "ok");
  assert.equal(((field["element"] as Record<string, unknown>)["codeList"] as Record<string, unknown>)["id"], 12451);
  assert.equal(field["source"], `${API}/api/v1/fields/baukasten/F60000236/latest`);
  const lower = (await connection.call("getElement", { kind: "field", id: "f60000236" })).structuredContent ?? {};
  assert.equal(lower["status"], "ok", "an id typed in lower case is the element's");
  assert.equal(lower["source"], transport.last().url);
  const versions = (await connection.call("getElement", { kind: "schema", id: "S05000039", versions: true })).structuredContent ?? {};
  assert.equal((versions["versions"] as unknown[]).length, 2);
  assert.equal(versions["source"], `${API}/api/v1/schemas/S05000039`);
  const wrong = await connection.call("searchCatalogue", { resource: "processes", name: "Ausweis" });
  assert.equal(wrong.isError, true);
  await connection.close();
});
