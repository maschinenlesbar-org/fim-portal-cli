// Conformance test P24 (trend analysis 2026-10-21): an input is canonicalised or refused, never
// sent raw. One corpus of tricky values goes through every text filter and every id the repo
// declares, on the CLI and in the library. Either both refuse it before any request (exit 2,
// the validation error), or both send the same request with the value in canonical form: a
// text without surrounding whitespace, in composed Unicode, never blank; an id as the adapter
// canonicalises it, never empty, a dot segment or with a "/". Each value here was once sent raw
// by some *-cli and matched nothing, or the wrong thing, with exit 0. Shared across the *-cli
// repos; only the adapter differs.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { HttpRequest, HttpResponse } from "@maschinenlesbar.org/fim-portal-client/internal/http";

// ---- adapter (per repo) -------------------------------------------------------------
/**
 * `parity(argv, call, responder)`: argv through run() and `call` through the library, each on a
 * recording mock transport; resolves to `{ cli: { code, out, err, requests }, lib: { ok, value?,
 * error?: { name, message }, requests } }`. Map the repo's own helper to this shape if it differs.
 */
import { jsonResponse, parity as fimParity } from "./helpers.js";
import type { Transport } from "@maschinenlesbar.org/fim-portal-client/internal/http";
/** The exit code of a usage error in this repo (commander's default is 1; most repos use 2). */
const USAGE_EXIT = 1;
import { FimPortalClient as Client } from "@maschinenlesbar.org/fim-portal-client/internal/client";
/** fim-portal's parity(): the same arguments; the library's error as `{ name, message }`, `value` on both branches. */
async function parity(argv: string[], call: (transport: Transport) => unknown, responder: (req: HttpRequest) => HttpResponse) {
  const o = await fimParity(argv, call, responder);
  const e: unknown = o.lib.ok ? undefined : o.lib.error;
  return {
    cli: o.cli,
    lib: {
      ok: o.lib.ok,
      value: o.lib.ok ? o.lib.value : undefined,
      error: e === undefined ? undefined : e instanceof Error ? { name: e.constructor.name, message: e.message } : { name: typeof e, message: String(e) },
      requests: o.lib.requests,
    },
  };
}
interface Input {
  name: string;
  /** CLI argv that sends `value`. */
  argv: (value: string) => string[];
  /** The same in the library. */
  lib: (client: Client, value: string) => Promise<unknown>;
  /** The value as it went out, read from the request URL (null when it wasn't sent). */
  sent: (url: URL) => string | null;
}
const q = (key: string) => (u: URL): string | null => u.searchParams.get(key);
/**
 * Every text filter (sent as a query parameter): the `text` parameters of filters.ts and the CSV
 * export's term. Codes, keys and dates (--nummernkreis, --leistungsschluessel, --ozg-id,
 * --lagen-portalverbund, --gueltig-am, …) are sent as given and are not text filters.
 */
const textInputs: Input[] = [
  { name: "schemas search --name", argv: (v) => ["schemas", "search", "--name", v], lib: (c, v) => c.schemas.search({ name: v }), sent: q("name") },
  { name: "schemas search --fts-query", argv: (v) => ["schemas", "search", "--fts-query", v], lib: (c, v) => c.schemas.search({ fts_query: v }), sent: q("fts_query") },
  { name: "schemas search --bezeichnung", argv: (v) => ["schemas", "search", "--bezeichnung", v], lib: (c, v) => c.schemas.search({ bezeichnung: v }), sent: q("bezeichnung") },
  { name: "schemas search --stichwort", argv: (v) => ["schemas", "search", "--stichwort", v], lib: (c, v) => c.schemas.search({ stichwort: v }), sent: q("stichwort") },
  { name: "schemas search --bezug-unterelemente", argv: (v) => ["schemas", "search", "--bezug-unterelemente", v], lib: (c, v) => c.schemas.search({ bezug_unterelemente: v }), sent: q("bezug_unterelemente") },
  { name: "fields search --bezug", argv: (v) => ["fields", "search", "--bezug", v], lib: (c, v) => c.fields.search({ bezug: v }), sent: q("bezug") },
  { name: "groups search --versionshinweis", argv: (v) => ["groups", "search", "--versionshinweis", v], lib: (c, v) => c.groups.search({ Versionshinweis: v }), sent: q("Versionshinweis") },
  { name: "document-profiles search --status-gesetzt-durch", argv: (v) => ["document-profiles", "search", "--status-gesetzt-durch", v], lib: (c, v) => c.documentProfiles.search({ status_gesetzt_durch: v }), sent: q("status_gesetzt_durch") },
  { name: "service-profiles search --title", argv: (v) => ["service-profiles", "search", "--title", v], lib: (c, v) => c.serviceProfiles.search({ title: v }), sent: q("title") },
  { name: "service-profiles search --leistungsbezeichnung", argv: (v) => ["service-profiles", "search", "--leistungsbezeichnung", v], lib: (c, v) => c.serviceProfiles.search({ leistungsbezeichnung: v }), sent: q("leistungsbezeichnung") },
  { name: "service-texts search --leistungsbezeichnung2", argv: (v) => ["service-texts", "search", "--leistungsbezeichnung2", v], lib: (c, v) => c.serviceTexts.search({ leistungsbezeichnung2: v }), sent: q("leistungsbezeichnung2") },
  { name: "service-texts search --rechtsgrundlagen", argv: (v) => ["service-texts", "search", "--rechtsgrundlagen", v], lib: (c, v) => c.serviceTexts.search({ rechtsgrundlagen: v }), sent: q("rechtsgrundlagen") },
  { name: "organizational-units list --fts-query", argv: (v) => ["organizational-units", "list", "--fts-query", v], lib: (c, v) => c.organizationalUnits.list({ fts_query: v }), sent: q("fts_query") },
  { name: "process-classes search --fts-query", argv: (v) => ["process-classes", "search", "--fts-query", v], lib: (c, v) => c.processClasses.search({ fts_query: v }), sent: q("fts_query") },
  { name: "processes search --fts-query", argv: (v) => ["processes", "search", "--fts-query", v], lib: (c, v) => c.processes.search({ fts_query: v }), sent: q("fts_query") },
  { name: "search-csv --term", argv: (v) => ["search-csv", "--resource", "schema", "--term", v], lib: (c, v) => c.tools.searchCsvDownload({ resource: "schema", term: v }), sent: q("term") },
];
/** Path segment `index` of the request (0 = the empty one before the first "/"). */
const segment = (index: number) => (u: URL): string => decodeURIComponent(u.pathname.split("/")[index] ?? "");
const last = (u: URL): string => decodeURIComponent(u.pathname.slice(u.pathname.lastIndexOf("/") + 1));
/** Every id that goes into a request path: each kind once, read from its own segment. */
const idInputs: Input[] = [
  { name: "schemas versions <fimId>", argv: (v) => ["schemas", "versions", v], lib: (c, v) => c.schemas.versions(v), sent: last },
  { name: "schemas get S1 <fimVersion>", argv: (v) => ["schemas", "get", "S1", v], lib: (c, v) => c.schemas.get("S1", v), sent: last },
  { name: "fields versions <namespace> F1", argv: (v) => ["fields", "versions", v, "F1"], lib: (c, v) => c.fields.versions(v, "F1"), sent: segment(4) },
  { name: "service-profiles get <leistungsschluessel>", argv: (v) => ["service-profiles", "get", v], lib: (c, v) => c.serviceProfiles.get(v), sent: last },
  { name: "service-texts get <redaktionId> L1 leika", argv: (v) => ["service-texts", "get", v, "L1", "leika"], lib: (c, v) => c.serviceTexts.get(v, "L1", "leika"), sent: segment(4) },
  { name: "service-texts get R1 <leistungId> leika", argv: (v) => ["service-texts", "get", "R1", v, "leika"], lib: (c, v) => c.serviceTexts.get("R1", v, "leika"), sent: segment(5) },
  { name: "process-classes get <id> 1.0", argv: (v) => ["process-classes", "get", v, "1.0"], lib: (c, v) => c.processClasses.get(v, "1.0"), sent: segment(4) },
  { name: "processes get P1 1.0 101 <kodierung>", argv: (v) => ["processes", "get", "P1", "1.0", "101", v], lib: (c, v) => c.processes.get("P1", "1.0", "101", v), sent: last },
];
/** The id as the repo sends it (trimmed; a repo with numeric ids may drop leading zeros). */
const canonicalId = (value: string): string => value.trim();
/** A valid answer to any of these requests: the shape each endpoint must have. */
const respond = (req: HttpRequest): HttpResponse => {
  const path = new URL(req.url).pathname;
  if (path.startsWith("/tools/")) return { status: 200, headers: { "content-type": "text/csv" }, body: Buffer.from("a;b\n") };
  if (/\/(schemas|fields)\/[^/]+(\/[^/]+)?$/.test(path) && !/\/schemas\/[^/]+\/[^/]+$/.test(path)) return jsonResponse([{ id: "a1" }]);
  if (/\/(organizational-unit)$/.test(path)) return jsonResponse({ items: [], next_cursor: null });
  if (/\/(schemas|fields|groups|document-profiles|leistung-steckbriefe|leistung-stammtexte|processclasses|processes)$/.test(path)) return jsonResponse({ items: [], total_count: 0 });
  return jsonResponse({ id: decodeURIComponent(path.split("/").pop() ?? "") });
};
// --------------------------------------------------------------------------------------

const TEXT_CORPUS = [
  "Müller", "Müller", "  Müller  ", " Müller ", "Müller\n", "\tMüller", "a  b", "Å",
  "ﬁ", "x".repeat(5000), "", " ", " ", "\n\t", "　",
];
const ID_CORPUS = ["a1", " a1 ", "a1\n", " a1", ".", "..", " .. ", "a1/../a2", "a1/", "/a1", "", "  ", "%2e%2e", "a b"];

type Outcome = Awaited<ReturnType<typeof parity>>;

/** Both sides refused before any request, or both sent the same requests. Returns the one sent URL, if any. */
function sameOutcome(o: Outcome, label: string): URL | undefined {
  if (o.cli.code === USAGE_EXIT) {
    assert.deepEqual(o.cli.requests, [], `${label}: the CLI refused but sent a request`);
    assert.equal(o.lib.ok, false, `${label}: the CLI refused, the library resolved`);
    assert.deepEqual(o.lib.requests, [], `${label}: the library sent a request`);
    assert.match(o.lib.error?.name ?? "", /ValidationError$/, `${label}: ${String(o.lib.error)}`);
    return undefined;
  }
  assert.equal(o.cli.code, 0, `${label}: CLI exit ${o.cli.code}: ${o.cli.err}`);
  assert.equal(o.lib.ok, true, `${label}: the library rejected: ${String(o.lib.error)}`);
  assert.deepEqual(o.lib.requests.map((r) => r.url), o.cli.requests.map((r) => r.url), `${label}: different requests`);
  assert.equal(o.cli.requests.length, 1, label);
  return new URL(o.cli.requests[0]!.url);
}

test("P24: a text filter is sent trimmed and in composed Unicode, or refused; never blank", async () => {
  for (const input of textInputs) {
    for (const value of TEXT_CORPUS) {
      const label = `${input.name} ${JSON.stringify(value.length > 20 ? `${value.slice(0, 20)}…` : value)}`;
      const url = sameOutcome(await parity(input.argv(value), (t) => input.lib(new Client({ transport: t }), value), respond), label);
      if (value.trim() === "") {
        assert.equal(url, undefined, `${label}: a blank value was sent (it reads as "no filter")`);
        continue;
      }
      if (url === undefined) continue;
      const sent = input.sent(url);
      assert.ok(sent !== null && sent !== "", `${label}: not sent`);
      const canonical = [value.trim().normalize("NFC"), value.trim().normalize("NFKC")];
      assert.ok(canonical.includes(sent), `${label}: sent ${JSON.stringify(sent)}`);
    }
  }
});

test("P24: an id is sent in its canonical form, or refused; never empty, a dot segment or with a slash", async () => {
  for (const input of idInputs) {
    for (const value of ID_CORPUS) {
      const label = `${input.name} ${JSON.stringify(value)}`;
      const url = sameOutcome(await parity(input.argv(value), (t) => input.lib(new Client({ transport: t }), value), respond), label);
      const id = canonicalId(value);
      if (id === "" || id === "." || id === ".." || id.includes("/")) {
        assert.equal(url, undefined, `${label}: sent although it would re-target the request`);
        continue;
      }
      if (url === undefined) continue;
      assert.equal(input.sent(url), id, label);
    }
  }
});
