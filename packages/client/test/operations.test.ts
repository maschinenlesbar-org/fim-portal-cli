// The use cases (operations.ts) against the recorded portal (portal.ts), with the skills' traps
// as cases: released and latest only, ranked by name, status and the central Baukasten; the
// severity of a quality report, never "error"; the outline joined from the catalogues; a
// service's texts with their sources looked up; full-text hits that only mention a name are not
// taken for it; ambiguity reported, never guessed; no bare "not found".

import { test } from "node:test";
import assert from "node:assert/strict";
import { FimPortalClient } from "../src/client.js";
import { FimApiError, FimValidationError } from "../src/errors.js";
import type { Transport } from "../src/http.js";
import type { JsonObject } from "../src/types.js";
import {
  auditSchemaQuality,
  findReusableFields,
  freigabeStatusLabel,
  getElement,
  getSchemaBlueprint,
  getServiceDossier,
  getServiceText,
  plainText,
  searchCatalogue,
} from "../src/operations.js";
import { makeMockTransport, queryOf } from "./helpers.js";
import { FIELDS_STAATSANGEHOERIGKEIT, REPORT_S00000000239, TEXT_B100019, fimPortalAnswer, fimPortalApi, variant } from "./portal.js";

const clientOf = (mock: { transport: Transport }) => new FimPortalClient({ transport: mock.transport });
const recorded = () => {
  const mock = fimPortalApi();
  return { mock, client: clientOf(mock) };
};
const FIELD_ROWS = FIELDS_STAATSANGEHOERIGKEIT["items"] as JsonObject[];
const row = (id: string): JsonObject => FIELD_ROWS.find((r) => r["fim_id"] === id) as JsonObject;

test("findReusableFields: released (5, 6) and latest only, never the retired; the namesake first, then by status and the central Baukasten", async () => {
  const { mock, client } = recorded();
  const answer = await findReusableFields(client, { query: "Staatsangehörigkeit", feldart: "select" });
  assert.equal(answer.status, "ok");
  if (answer.status !== "ok") return;
  const query = queryOf(mock.last());
  assert.deepEqual(query.getAll("freigabe_status"), ["5", "6"]);
  assert.equal(query.get("is_latest"), "true");
  assert.equal(query.get("limit"), "200");
  assert.deepEqual(answer.candidates.map((c) => [c.fimId, c.nameMatch]), [
    ["F60000236", "exact"],
    ["F00000001839", "name"],
    ["F00000003381", "text"],
    ["F00000003398", "text"],
  ]);
  const top = answer.candidates[0]!;
  assert.equal(top.namespace, "baukasten");
  assert.equal(top.codeListId, 12451);
  assert.equal(top.central, false, "the released one is in 60000, not the central Baukasten");
  assert.match(answer.best, /^F60000236 Staatsangehörigkeit \(fachlich freigegeben \(gold\), Nummernkreis 60000, select · text\) is the most reusable of 4 released fields\.$/);
  assert.match(answer.notes.join(" "), /namespace: getElement needs both/);
  assert.match(answer.notes.join(" "), /matched only in their definition/);
  // The central F00000001839 is gold too: the best leads by its name, not by status.
  assert.match(answer.notes.join(" "), /not in the central Baukasten \(00000\): the central one's name fits the search less well \(F00000001839, nameMatch name\)/);
  assert.doesNotMatch(answer.notes.join(" "), /lower status/);
});

test("findReusableFields: with the unreleased, status wins among namesakes (gold before the central draft), retired ones are never asked for", async () => {
  const fields = [
    row("F60000236"),
    variant(row("F60000236"), { fim_id: "F00000000039", fim_version: "2.1.0", nummernkreis: "00000", freigabe_status: 3, freigabe_status_label: "Entwurf", code_list_id: 15917 }),
    variant(row("F60000236"), { fim_id: "F60000000236", fim_version: "1.7.0", freigabe_status: 3, freigabe_status_label: "Entwurf", code_list_id: 15926 }),
    variant(row("F60000236"), { fim_id: "F99000000001", freigabe_status: 7, freigabe_status_label: "inaktiv" }),
  ];
  const mock = fimPortalApi({ fields });
  const answer = await findReusableFields(clientOf(mock), { name: "Staatsangehörigkeit", includeUnreleased: true });
  assert.deepEqual(queryOf(mock.last()).getAll("freigabe_status"), ["1", "2", "3", "4", "5", "6"]);
  assert.equal(answer.status, "ok");
  if (answer.status !== "ok") return;
  assert.deepEqual(answer.candidates.map((c) => [c.fimId, c.released]), [
    ["F60000236", true],
    ["F00000000039", false],
    ["F60000000236", false],
  ]);
  assert.match(answer.notes.join(" "), /a central one has a lower status \(F00000000039, Entwurf\), and status wins/);
  assert.match(answer.notes.join(" "), /name is a substring match/);
});

test("findReusableFields: a query of several words, punctuated or not, ranks the field named for one of them first, not as text", async () => {
  // Every field search answers the four recorded Staatsangehörigkeit rows.
  const mock = fimPortalApi({ fields: FIELD_ROWS });
  for (const query of ["Staatsangehörigkeit, Nationalität", "Staatsangehörigkeit Nationalität", "Nationalität (Staatsangehörigkeit)"]) {
    const answer = await findReusableFields(clientOf(mock), { query });
    assert.equal(answer.status, "ok");
    if (answer.status !== "ok") continue;
    assert.deepEqual(answer.candidates.map((c) => [c.fimId, c.nameMatch]), [
      ["F60000236", "name"],
      ["F00000001839", "partial"],
      ["F00000003381", "text"],
      ["F00000003398", "text"],
    ], query);
    assert.match(answer.best, /^F60000236 Staatsangehörigkeit/);
  }
  // Short words and articles don't make a name match: "des" is in "Zweck des Aufenthalts".
  const articles = await findReusableFields(clientOf(mock), { query: "Staatsangehörigkeit des Kindes" });
  assert.equal(articles.status === "ok" ? articles.candidates.find((c) => c.fimId === "F00000003381")?.nameMatch : "", "text");
  // The name that is the whole query leads; one that is one of its words follows.
  const both = await findReusableFields(clientOf(mock), { query: "frühere Staatsangehörigkeit" });
  assert.deepEqual(both.status === "ok" ? both.candidates.slice(0, 2).map((c) => [c.fimId, c.nameMatch]) : [], [["F00000001839", "exact"], ["F60000236", "name"]]);
});

test("findReusableFields: when no candidate's name fits the query, best says so instead of recommending one", async () => {
  const answer = await findReusableFields(clientOf(fimPortalApi({ fields: FIELD_ROWS })), { query: "Steuer-Identifikationsnummer" });
  assert.equal(answer.status, "ok");
  if (answer.status !== "ok") return;
  assert.ok(answer.candidates.every((c) => c.nameMatch === "text"));
  assert.doesNotMatch(answer.best, /is the most reusable/);
  assert.match(answer.best, /^No released field is named for "Steuer-Identifikationsnummer": the 4 hits only mention it in their definition or references\./);
  assert.match(answer.best, /F00000003381 Zweck des Aufenthalts \(Schweiz\) .* only as related/);
});

test("findReusableFields: an unreleased best match is flagged; nothing found says what to change; groups take no feldart; no filter is refused before any request", async () => {
  const draft = variant(row("F60000236"), { freigabe_status: 3, freigabe_status_label: "Entwurf" });
  const flagged = await findReusableFields(clientOf(fimPortalApi({ fields: [draft] })), { query: "Staatsangehörigkeit", includeUnreleased: true });
  assert.equal(flagged.status, "ok");
  assert.match(flagged.status === "ok" ? flagged.notes.join(" ") : "", /The best match is not released \(Entwurf\)/);
  const none = await findReusableFields(recorded().client, { query: "Raumschiff" });
  assert.equal(none.status, "empty");
  assert.match(none.status === "empty" ? none.reason : "", /No released \(silber or gold\) field matches\. includeUnreleased/);
  const { mock, client } = recorded();
  await assert.rejects(findReusableFields(client, { kind: "group", query: "Anschrift", feldart: "input" }), FimValidationError);
  await assert.rejects(findReusableFields(client, {}), /Give at least one of query/);
  await assert.rejects(findReusableFields(client, { query: "x", limit: 51 }), FimValidationError);
  assert.equal(mock.calls.length, 0);
});

test("findReusableFields: groups too, ranked the same way", async () => {
  const { mock, client } = recorded();
  const answer = await findReusableFields(client, { kind: "group", query: "Anschrift", limit: 3 });
  assert.equal(new URL(mock.last().url).pathname, "/api/v1/groups");
  assert.equal(answer.status, "ok");
  if (answer.status !== "ok") return;
  assert.equal(answer.total, 10);
  assert.equal(answer.candidates.length, 3);
  assert.ok(answer.candidates.every((c) => c.feldart === undefined));
  assert.equal(answer.candidates[0]?.nameMatch, "name", "a name with Anschrift before the hits that matched in other text");
});

test("auditSchemaQuality: one critical finding is 'needs fixes', named from the catalogue; the severity is error_type, never 'error'", async () => {
  const { mock, client } = recorded();
  const answer = await auditSchemaQuality(client, { schema: "S05000039" });
  assert.equal(answer.status, "ok");
  if (answer.status !== "ok") return;
  assert.deepEqual(mock.calls.map((c) => new URL(c.url).pathname), ["/api/v1/schemas/S05000039/latest/quality-report", "/api/v1/schemas/S05000039/latest"]);
  assert.equal(answer.totalChecks, 1);
  assert.deepEqual(answer.bySeverity, { critical: 1 });
  assert.equal(answer.issues[0]?.code, 1005);
  assert.deepEqual(answer.issues[0]?.elements, [{ id: "F05000802", version: "1.0", type: "field", name: "Auswahl des Grundes für die Ermäßigung oder Befreiung der Hundesteuer" }]);
  assert.match(answer.verdict, /^Anmeldung zur Hundesteuer \(S05000039 v1\.1\): 1 findings \(1 critical\): needs fixes: 1 critical\.$/);
});

test("auditSchemaQuality: warnings only are 'reusable with caveats', grouped by code, most frequent first; more rule reports than rules is noted", async () => {
  const answer = await auditSchemaQuality(recorded().client, { schema: "S00000000239", perIssue: 2 });
  assert.equal(answer.status, "ok");
  if (answer.status !== "ok") return;
  assert.equal(answer.totalChecks, 14);
  assert.deepEqual(answer.bySeverity, { warning: 14 });
  assert.deepEqual(answer.findings, { schema: 0, groups: 1, fields: 13, rules: 0 });
  const counts = answer.issues.map((i) => i.count);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
  assert.equal(answer.issues.reduce((sum, i) => sum + i.count, 0), 14);
  const first = answer.issues[0]!;
  assert.equal(first.elements.length, 2);
  assert.equal(first.more, first.count - 2);
  assert.ok(first.elements.every((e) => e.name !== null), "every flagged id is named");
  assert.match(answer.verdict, /reusable with caveats/);
  assert.match(answer.notes.join(" "), /checks 22 rules, more than the schema's own 0/);
});

test("auditSchemaQuality: an all-clean report passes; an unexpected severity is counted, not dropped", async () => {
  const clean = { ...REPORT_S00000000239, total_checks: 0, group_reports: [], field_reports: [], rule_reports: [{ identifier: { id: "R1", version: "1" }, failing_checks: [] }] };
  const odd = { ...REPORT_S00000000239, total_checks: 1, schema_checks: [{ code: 9, error_type: "notice", message: "Neu" }], group_reports: [], field_reports: [], rule_reports: [] };
  for (const [report, verdict, severities] of [
    [clean, /0 findings: passed, no findings: clean/, {}],
    [odd, /1 findings \(1 notice\)/, { notice: 1 }],
  ] as const) {
    const mock = makeMockTransport((request) => (request.url.endsWith("/quality-report") ? { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify(report)) } : fimPortalAnswer(request)));
    const answer = await auditSchemaQuality(clientOf(mock), { schema: "S00000000239" });
    assert.equal(answer.status, "ok");
    if (answer.status !== "ok") continue;
    assert.match(answer.verdict, verdict);
    assert.deepEqual(answer.bySeverity, severities);
  }
});

test("a schema by name: several titled hits are ambiguous; hits that only mention it are empty; one exact title is the answer", async () => {
  const { mock, client } = recorded();
  const several = await auditSchemaQuality(client, { schema: "Hundesteuer" });
  assert.equal(several.status, "ambiguous");
  if (several.status === "ambiguous") {
    assert.deepEqual(several.candidates.filter((c) => c.titleNamesIt).map((c) => c.fimId), ["S05000039", "S05000040", "S05000069"]);
    assert.equal(several.candidates.length, 7);
  }
  assert.equal(mock.calls.length, 1, "no report fetched for an ambiguous name");
  const mentioned = await getSchemaBlueprint(client, { schema: "Elterngeld" });
  assert.equal(mentioned.status, "empty");
  if (mentioned.status === "empty") assert.match(mentioned.reason, /No schema's name or title contains every word of "Elterngeld"/);
  const exact = await auditSchemaQuality(client, { schema: "anmeldung zur hundesteuer" });
  assert.equal(exact.status === "ok" ? exact.schema.fimId : exact.status, "S05000039");
  const unknown = await auditSchemaQuality(client, { schema: "S99999999" });
  assert.equal(unknown.status, "empty");
  if (unknown.status === "empty" && "reason" in unknown) assert.match(unknown.reason, /no schema S99999999 in version latest/);
});

test("getSchemaBlueprint: the outline is joined from the group catalogue, deeper groups are counted, retired elements named", async () => {
  const { client } = recorded();
  const two = await getSchemaBlueprint(client, { schema: "S05000039" });
  assert.equal(two.status, "ok");
  if (two.status !== "ok") return;
  assert.deepEqual(two.outline.filter((n) => n.depth === 0).map((n) => n.id), ["F05000698", "G05000276", "G05000434", "G05000442"]);
  const applicant = two.outline.filter((n) => n.depth === 1).slice(0, 3);
  assert.deepEqual(applicant.map((n) => [n.id, n.name, n.hidden]), [
    ["G05000366", "Persönliche Angaben (Familienname & Vorname)", 2],
    ["G05000527", "Anschrift Inland Straßenanschrift", 3],
    ["G05000528", "Kommunikation (Telefon/E-Mail)", 2],
  ]);
  assert.deepEqual([two.schema.fields, two.schema.groups, two.schema.rules, two.schema.topLevel], [29, 15, 1, 4]);
  assert.deepEqual(two.retired.map((r) => [r.id, r.name, r.statusLabel]), [["F60000240", "Telefon", "inaktiv"]]);
  assert.equal(two.elementStatuses.fields["inaktiv"], 1);
  assert.match(two.notes.join(" "), /some of its elements are not released/);
  const deep = await getSchemaBlueprint(client, { schema: "S05000039", depth: 3 });
  assert.equal(deep.status, "ok");
  if (deep.status !== "ok") return;
  const phone = deep.outline.find((n) => n.id === "F60000240");
  assert.deepEqual([phone?.depth, phone?.cardinality, phone?.use, phone?.retired], [2, "0:1", "optional", "inaktiv"]);
  const reason = deep.outline.find((n) => n.id === "F05000802");
  assert.equal(reason?.codeListId, 1844);
});

test("getSchemaBlueprint: one group expanded on its own; a group not in the schema is empty with the schema's groups", async () => {
  const { client } = recorded();
  const group = await getSchemaBlueprint(client, { schema: "S05000039", group: "g05000442", depth: 1 });
  assert.equal(group.status, "ok");
  if (group.status === "ok") {
    assert.deepEqual(group.group, { id: "G05000442", name: "Angaben (Hund Steueranmeldung)" });
    assert.ok(group.outline.every((n) => n.depth === 0));
  }
  const missing = await getSchemaBlueprint(client, { schema: "S05000039", group: "G1" });
  assert.equal(missing.status, "empty");
  if (missing.status === "empty" && "groups" in missing) assert.equal(missing.groups.length, 15);
});

test("getServiceDossier: by key, the profile, every text with its source (federal first, under pvog), the statuses mapped, no process said", async () => {
  const { mock, client } = recorded();
  const answer = await getServiceDossier(client, { service: "99008001012011" });
  assert.equal(answer.status, "ok");
  if (answer.status !== "ok") return;
  assert.equal(mock.calls.length, 2);
  assert.equal(answer.service.statusLabel, "fachlich freigegeben (gold)");
  assert.deepEqual(answer.service.for, [{ code: "001", label: "Bürger (citizens)" }]);
  assert.deepEqual(answer.service.type, { code: "lovd", label: "Leistungsobjekt mit Verrichtung und Detail" });
  assert.deepEqual(answer.service.sdg, ["1010100"]);
  assert.equal(answer.service.process, null);
  assert.equal(answer.texts.length, 10);
  assert.deepEqual(answer.texts[0], { redaktionId: "B100019", leistungId: "102241587", source: "pvog", title: "Personalausweis Ausstellung für Deutsche mit Wohnsitz außerhalb Deutschlands", level: "federal", statusLabel: "fachlich freigegeben (gold)" });
  assert.deepEqual(answer.byLevel, { state: 9, federal: 1 });
  assert.equal(answer.texts.find((t) => t.redaktionId === "L100108")?.source, "pvog", "a state text under pvog: the prefix doesn't tell the source");
  assert.ok(answer.canonical !== null && !answer.canonical.summary.includes("<"));
  assert.match(answer.canonical?.summary ?? "", /^- Beantragung eines Personalausweises/);
  assert.match(answer.notes.join(" "), /No process class is linked/);
  assert.match(answer.verdict, /10 editorial offices have a text \(9 state, 1 federal\); no process linked/);
});

test("getServiceDossier: by name, several hits are ambiguous; one exact name, or the one hit named with every word, is the answer; an unknown key is empty", async () => {
  const { client } = recorded();
  const several = await getServiceDossier(client, { service: "Personalausweis" });
  assert.equal(several.status, "ambiguous");
  if (several.status === "ambiguous") assert.deepEqual(several.candidates.map((c) => [c.key, c.statusLabel]), [["99008001012011", "fachlich freigegeben (gold)"], ["99008001011001", "fachlich freigegeben (gold)"]]);
  // Both hits of the recorded search; only the first holds every word (its citizen name: "… im Ausland").
  const named = await getServiceDossier(client, { service: "Personalausweis Wohnsitz im Ausland" });
  assert.equal(named.status === "ok" ? named.service.key : named.status, "99008001012011");
  const { mock, client: one } = recorded();
  const exact = await getServiceDossier(one, { service: "Personalausweis Ausstellung für Deutsche mit Wohnsitz außerhalb Deutschlands" });
  assert.equal(exact.status === "ok" ? exact.service.key : exact.status, "99008001012011");
  assert.equal(queryOf(mock.calls[0]!).get("sprache"), "Deutsch");
  const unknown = await getServiceDossier(client, { service: "99999999999999" });
  assert.equal(unknown.status, "empty");
});

test("getServiceText: with the source; without it looked up by the key; a wrong source is empty; neither is refused before any request", async () => {
  const { mock, client } = recorded();
  const text = await getServiceText(client, { redaktionId: "B100019", leistungId: "102241587", source: "pvog" });
  assert.equal(text.status, "ok");
  if (text.status === "ok") {
    assert.equal(text.sourceLookedUp, false);
    assert.ok(text.paragraphs.length > 3);
    assert.ok(text.paragraphs.every((p) => !/[<>]/.test(p)));
    assert.match(text.legalBases[0] ?? "", /PAuswG/);
  }
  const looked = await getServiceText(client, { redaktionId: "B100019", leistungId: "102241587", leistungsschluessel: "99008001012011" });
  assert.equal(looked.status === "ok" ? `${looked.source} ${looked.sourceLookedUp}` : looked.status, "pvog true");
  const wrong = await getServiceText(client, { redaktionId: "B100019", leistungId: "102241587", source: "leika" });
  assert.equal(wrong.status, "empty");
  if (wrong.status === "empty") assert.match(wrong.reason, /under source leika/);
  const before = mock.calls.length;
  await assert.rejects(getServiceText(client, { redaktionId: "B100019", leistungId: "102241587" }), /can't be told from the redaktionId/);
  assert.equal(mock.calls.length, before);
});

test("getServiceText: paragraphs written without a line break between them stay apart, a long one whole", async () => {
  // The portal's HTML may close one <p> and open the next with nothing between them: a block's end
  // was one line break, and only blank lines split paragraphs, so the whole text was one paragraph.
  const long = "lang ".repeat(1000).trim();
  const volltext = `<p>Absatz eins</p><p>${long}</p>${"<p>p</p>".repeat(500)}<ul><li>a</li><li>b</li></ul><p>Zeile<br>zwei</p><h3>Titel</h3>Ende`;
  const mock = makeMockTransport((request) => (new URL(request.url).pathname.endsWith("/pvog") ? { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify(variant(TEXT_B100019, { volltext }))) } : fimPortalAnswer(request)));
  const text = await getServiceText(clientOf(mock), { redaktionId: "B100019", leistungId: "102241587", source: "pvog" });
  assert.equal(text.status, "ok");
  if (text.status !== "ok") return;
  assert.equal(text.paragraphs.length, 507);
  assert.deepEqual(text.paragraphs.slice(0, 3), ["Absatz eins", long, "p"]);
  assert.deepEqual(text.paragraphs.slice(-5), ["- a", "- b", "Zeile\nzwei", "Titel", "Ende"], "a <br> stays inside its paragraph");
  assert.equal(plainText("<p>a</p><p>b</p>"), "a\nb", "plainText itself keeps one line per block");
});

test("searchCatalogue: latest only by default, rows cut to their ids, the next page; a filter a resource doesn't take is refused", async () => {
  const { mock, client } = recorded();
  const page = await searchCatalogue(client, { resource: "schemas", query: "Hundesteuer", limit: 5 });
  assert.equal(page.status, "ok");
  if (page.status === "ok") {
    assert.equal(page.total, 7);
    assert.equal(page.nextOffset, 5);
    assert.deepEqual(Object.keys(page.items[0]!), ["fimId", "version", "name", "title", "statusLabel", "nummernkreis", "xdfVersion", "steckbriefId", "isLatest"]);
  }
  assert.equal(queryOf(mock.last()).get("is_latest"), "true");
  const texts = await searchCatalogue(client, { resource: "serviceTexts", leistungsschluessel: "99008001012011", limit: 50 });
  assert.equal(texts.status === "ok" ? texts.items.length : 0, 10);
  assert.equal(queryOf(mock.last()).get("is_latest"), null, "service texts have no latest flag");
  const before = mock.calls.length;
  await assert.rejects(searchCatalogue(client, { resource: "processes", name: "Ausweis" }), /processes have no name filter/);
  await assert.rejects(searchCatalogue(client, { resource: "serviceTexts", status: [6] }), /no status filter/);
  await assert.rejects(searchCatalogue(client, { resource: "schemas", leistungsschluessel: "99008001012011" }), FimValidationError);
  assert.equal(mock.calls.length, before);
  const past = await searchCatalogue(client, { resource: "processes", query: "Personalausweis", offset: 50 });
  assert.equal(past.status, "empty");
});

test("searchCatalogue: a catalogue the portal can't narrow to the newest version says so; latestOnly there does nothing and says so", async () => {
  const { mock, client } = recorded();
  const processes = await searchCatalogue(client, { resource: "processes", query: "Personalausweis" });
  assert.equal(processes.status, "ok");
  assert.equal(queryOf(mock.last()).get("is_latest"), null);
  if (processes.status === "ok") assert.match(processes.notes.join(" "), /Processes are listed in every version/);
  const profiles = await searchCatalogue(client, { resource: "serviceProfiles", query: "Personalausweis", latestOnly: true });
  if (profiles.status === "ok") assert.match(profiles.notes.join(" "), /latestOnly does nothing for serviceProfiles/);
  const plain = await searchCatalogue(client, { resource: "serviceProfiles", query: "Personalausweis" });
  if (plain.status === "ok") assert.doesNotMatch(plain.notes.join(" "), /latestOnly/);
  const schemas = await searchCatalogue(client, { resource: "schemas", query: "Hundesteuer" });
  if (schemas.status === "ok") assert.doesNotMatch(schemas.notes.join(" "), /every version|latestOnly/);
});

test("searchCatalogue past the last page: total is still the number of hits, as the reason says", async () => {
  const past = await searchCatalogue(recorded().client, { resource: "schemas", query: "Hundesteuer", offset: 100 });
  assert.equal(past.status, "empty");
  assert.equal(past.total, 7);
  if (past.status === "empty") assert.match(past.reason, /The search has 7 hits; offset 100 is past them/);
  const none = await searchCatalogue(recorded().client, { resource: "schemas", query: "Zzzz" });
  assert.equal(none.total, 0);
});

test("getElement: a field's code list and use count (not its 1 MB of schemas); a group without children says so; versions; a 404 names the namespace", async () => {
  const { client } = recorded();
  const field = await getElement(client, { kind: "field", id: "F60000236" });
  assert.equal(field.status, "ok");
  if (field.status === "ok" && "element" in field) {
    assert.equal((field.element["codeList"] as JsonObject)["id"], 12451);
    const used = field.element["usedIn"] as JsonObject;
    assert.deepEqual([used["schemaVersions"], used["schemas"], (used["first"] as unknown[]).length], [148, 140, 25]);
  }
  const group = await getElement(client, { kind: "group", id: "G05000276" });
  assert.equal(group.status, "ok");
  if (group.status === "ok" && "element" in group) {
    // The portal sends no children; the ones derived are those of G05000276 in schema S05000039.
    assert.deepEqual((group.element["children"] as JsonObject[]).map((c) => [c["type"], c["id"], c["name"]]), [
      ["group", "G05000366", "Persönliche Angaben (Familienname & Vorname)"],
      ["group", "G05000527", "Anschrift Inland Straßenanschrift"],
      ["group", "G05000528", "Kommunikation (Telefon/E-Mail)"],
    ]);
    assert.equal(group.element["childrenDerived"], true);
    assert.match(group.notes.join(" "), /no direct children for this group, only the 10 fields and 5 groups inside it/);
  }
  const versions = await getElement(client, { kind: "schema", id: "S05000039", versions: true });
  assert.equal(versions.status, "ok");
  if (versions.status === "ok" && "versions" in versions) assert.deepEqual(versions.versions.map((v) => [v["version"], v["statusLabel"], v["isLatest"]]), [["1.0", "inaktiv", false], ["1.1", "fachlich freigegeben (gold)", true]]);
  const missing = await getElement(client, { kind: "field", id: "F1", namespace: "elsewhere" });
  assert.equal(missing.status, "empty");
  if (missing.status === "empty") assert.match(missing.reason, /need the namespace from the search \(elsewhere was used\)/);
  const process = await getElement(client, { kind: "processClass", id: "99008001012000", version: "01.01.00" });
  assert.equal(process.status === "ok" && "element" in process ? (process.element["processes"] as JsonObject[])[0]?.["statusLabel"] : undefined, "Entwurf");
  await assert.rejects(getElement(client, { kind: "processClass", id: "99008001012000" }), /needs its version/);
  const profile = await getElement(client, { kind: "documentProfile", id: "D05000033" });
  assert.deepEqual(profile.status === "ok" && "element" in profile ? profile.element["schemas"] : undefined, [{ fimId: "S05000039", version: "1.0", name: "Anmeldung zur Hundesteuer", statusLabel: "inaktiv" }]);
});

test("a 404 that isn't the portal's (an HTML page, an unknown route: a wrong base path) is an error, never 'the portal has no such element'", async () => {
  const html = { status: 404, headers: { "content-type": "text/html" }, body: Buffer.from("<html><body><h1>404 Not Found</h1>nginx</body></html>") };
  const route = { status: 404, headers: { "content-type": "application/json" }, body: Buffer.from('{"detail":"unknown route"}') };
  for (const answer of [html, route]) {
    const client = clientOf(makeMockTransport(() => answer));
    await assert.rejects(getElement(client, { kind: "schema", id: "S05000039" }), (err) => err instanceof FimApiError && err.status === 404);
    await assert.rejects(getSchemaBlueprint(client, { schema: "S05000039" }), FimApiError);
    await assert.rejects(auditSchemaQuality(client, { schema: "S05000039" }), FimApiError);
    await assert.rejects(getServiceDossier(client, { service: "99008001012011" }), FimApiError);
    await assert.rejects(getServiceText(client, { redaktionId: "B100019", leistungId: "102241587", source: "pvog" }), FimApiError);
  }
  // The portal's own answer for an id it doesn't know (as live, 2026-11-23): empty, with what to check.
  const portal = clientOf(makeMockTransport(() => ({ status: 404, headers: { "content-type": "application/json" }, body: Buffer.from('{"detail":"Could not find schema s05000039Vlatest."}') })));
  assert.equal((await getElement(portal, { kind: "schema", id: "S05000039" })).status, "empty");
});

test("getElement: an id typed in lower case is the element's (the portal's ids are upper case and case-sensitive)", async () => {
  const { mock, client } = recorded();
  const schema = await getElement(client, { kind: "schema", id: " s05000039 " });
  assert.equal(schema.status, "ok");
  assert.equal(new URL(mock.last().url).pathname, "/api/v1/schemas/S05000039/latest");
  const field = await getElement(client, { kind: "field", id: "f60000236" });
  assert.equal(field.status, "ok");
  const versions = await getElement(client, { kind: "schema", id: "s05000039", versions: true });
  assert.equal(versions.status, "ok");
  const missing = await getElement(client, { kind: "field", id: "f12345" });
  assert.equal(missing.status === "empty" ? missing.searched["id"] : missing.status, "F12345");
});

test("plainText: tags dropped, list items and blocks as lines, entities decoded, nothing reworded", () => {
  assert.equal(plainText("<p>Erste&nbsp;Zeile &amp; mehr</p><ul><li>a</li><li>b&#252;</li></ul>"), "Erste Zeile & mehr\n\n- a\n- bü");
  assert.equal(plainText(null), "");
  assert.equal(freigabeStatusLabel(null), "unset");
  assert.equal(freigabeStatusLabel(6), "fachlich freigegeben (gold)");
});

test("plainText is linear: an opening bracket with no closing one never rescans the rest of the text", () => {
  // `/<[^>]*>/` and `/<\s*li[^>]*>/` tried every "<" against the rest of the text: quadratic, so
  // 120 000 characters of "<li" took seconds, and a service text of a few MiB held the event loop.
  const text = "<li".repeat(40_000);
  const start = performance.now();
  const out = plainText(text);
  const ms = performance.now() - start;
  assert.ok(ms < 500, `${Math.round(ms)} ms`);
  assert.ok(out.startsWith("<li<li"), "a bracket that closes no tag is text, as before");
  assert.equal(plainText("a < b <p>c</p> d > e"), "a c\nd > e", "a tag runs from < to the next >, as before");
  assert.equal(plainText("x<br />y<br>z<brx>w< / h2 >v<li-x>u"), "x\ny\nzw\nv\n- u");
  assert.equal(plainText("<P>Ein</P><BR/>Zwei<UL><LI>Drei</LI></UL>< /div >Vier"), "Ein\n\nZwei\n- Drei\n\nVier");
});
