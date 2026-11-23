// The use cases of the skills as library functions, built on the resources: each composes the
// client's calls and carries the traps the skills document, so no caller (the CLI, the MCP
// server's tools, a library user) has to know them:
// - findReusableFields (fim-field-finder): released, latest building blocks ranked by reuse;
// - auditSchemaQuality (fim-quality-audit): the quality report by severity and issue;
// - getSchemaBlueprint (fim-schema-blueprint): the nested form outline, joined from the catalogues;
// - getServiceDossier (fim-service-dossier): a Leistung with its master texts and their sources;
// and three generic ones for what those don't reach: searchCatalogue, getElement, getServiceText.
//
// The rules they keep: ambiguity is reported, never guessed (several schemas or services are
// `ambiguous`, with the candidates); no bare "not found" (an empty answer says what was searched
// and what to change); each answer is a named type (public API of the CLI package: a changed shape
// is a `feat(client)!:` commit). Status codes are mapped to their labels here, since most of the
// portal's XZuFi answers carry none.

import type { FimPortalClient } from "./client.js";
import { FimApiError, FimValidationError } from "./errors.js";
import type { Datentyp, Feldart, FreigabeStatus, XzufiSource } from "./enums.js";
import { DatentypValues, FeldartValues, XzufiSourceValues } from "./enums.js";
import type { JsonObject, JsonValue } from "./types.js";
import type { FieldSearchParams } from "./params.js";
import { assertValid, normalizeText, oneOfProblem, textProblem } from "./validate.js";

// ---- shared ----------------------------------------------------------------------------

/** The Freigabestatus codes with the labels the portal uses (`freigabe_status_label`). */
export const FREIGABE_STATUS_LABELS: Readonly<Record<number, string>> = {
  1: "in Planung",
  2: "in Bearbeitung",
  3: "Entwurf",
  4: "methodisch freigegeben",
  5: "fachlich freigegeben (silber)",
  6: "fachlich freigegeben (gold)",
  7: "inaktiv",
  8: "vorgesehen zum Löschen",
};

/** The label of a Freigabestatus code; `unset` for null, the code itself for one not listed. */
export function freigabeStatusLabel(code: unknown): string {
  if (code === null || code === undefined) return "unset";
  return FREIGABE_STATUS_LABELS[Number(code)] ?? String(code);
}

/** Released: fachlich freigegeben, silber (5) or gold (6). */
const RELEASED: readonly FreigabeStatus[] = [5, 6];
/** Every status but the retired ones (7 inaktiv, 8 vorgesehen zum Löschen). */
const NOT_RETIRED: readonly FreigabeStatus[] = [1, 2, 3, 4, 5, 6];

const str = (value: JsonValue | undefined): string | undefined => (typeof value === "string" ? value : undefined);
const num = (value: JsonValue | undefined): number | undefined => (typeof value === "number" ? value : undefined);
const arr = (value: JsonValue | undefined): JsonValue[] => (Array.isArray(value) ? value : []);
const obj = (value: JsonValue | undefined): JsonObject | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
const objects = (value: JsonValue | undefined): JsonObject[] => arr(value).flatMap((item) => (obj(item) === undefined ? [] : [obj(item) as JsonObject]));
const strings = (value: JsonValue | undefined): string[] => arr(value).flatMap((item) => (typeof item === "string" ? [item] : []));

/** `text` cut to `max` characters, with an ellipsis. */
function cut(text: string | undefined, max: number): string | undefined {
  if (text === undefined) return undefined;
  const clean = text.replace(/\r\n?/g, "\n").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** Folded for comparing names: NFC, case, inner whitespace. */
function fold(text: string | undefined): string {
  return (text ?? "").normalize("NFC").toLocaleLowerCase("de").replace(/\s+/g, " ").trim();
}

/** True when every word of `wanted` (folded) is in one of `texts` (folded) together. */
function namesAll(wanted: string, texts: (string | null | undefined)[]): boolean {
  const haystack = texts.map((t) => fold(t ?? "")).join(" ");
  return wanted.split(" ").every((word) => haystack.includes(word));
}

/** What the portal's router answers for a path it has no route for (live, 2026-11-23), and FastAPI's default. */
const ROUTE_MISSES = new Set(["unknown route", "not found"]);

/**
 * True for the portal's answer that an element it routes to doesn't exist: a 404 with its JSON
 * `detail` ("Could not find schema …"). A 404 without one (an HTML page of a proxy) or the
 * router's "unknown route" (a wrong base path) is about the service, not the element: an error.
 */
function isNotFound(err: unknown): err is FimApiError {
  return err instanceof FimApiError && err.status === 404 && err.detail !== undefined && err.detail.trim() !== "" && !ROUTE_MISSES.has(err.detail.trim().toLowerCase());
}

/** A whole number from `min` to `max`, else a validation error naming the input. */
function bounded(name: string, value: number | undefined, fallback: number, min: number, max: number): number {
  const n = value ?? fallback;
  return assertValid(name, n, (v) => (Number.isSafeInteger(v) && v >= min && v <= max ? undefined : `Expected a whole number from ${min} to ${max}.`));
}

/** An optional text input, checked and canonicalised (trimmed, NFC); undefined stays undefined. */
function optionalText(name: string, value: string | undefined): string | undefined {
  return value === undefined ? undefined : normalizeText(assertValid(name, value, textProblem));
}

/** A version input: `latest` unless given. */
function versionOf(version: string | undefined): string {
  return optionalText("version", version) ?? "latest";
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/**
 * What a tag (the text between "<" and ">") becomes: a line break, a list item's "- ", `blockEnd`
 * for the end of a block (a paragraph, a list, a heading), or nothing.
 */
function tagText(tag: string, blockEnd: string): string {
  // Read by index, not by a regular expression with two optional runs of spaces, which
  // backtracks over a long run of them.
  let i = 0;
  const spaces = (): void => {
    while (i < tag.length && /\s/.test(tag[i] as string)) i++;
  };
  spaces();
  const closing = tag[i] === "/";
  if (closing) {
    i++;
    spaces();
  }
  const start = i;
  while (i < tag.length && /[a-z0-9]/i.test(tag[i] as string)) i++;
  const name = tag.slice(start, i).toLowerCase();
  const rest = tag.slice(i);
  if (!closing && name.startsWith("li")) return "\n- ";
  if (!closing && name === "br" && /^\s*\/?$/.test(rest)) return "\n";
  if (closing && rest.trim() === "" && /^(p|div|ul|ol|h[1-6]|table|tr)$/.test(name)) return blockEnd;
  return "";
}

/**
 * `html` with its tags replaced (tagText): a tag runs from "<" to the next ">"; a "<" with no ">"
 * after it is text. One pass with indexOf, so linear: a regular expression tried at every "<"
 * rescans the rest of a text without a ">" (quadratic).
 */
function withoutTags(html: string, blockEnd: string): string {
  const out: string[] = [];
  let at = 0;
  for (let open = html.indexOf("<"); open !== -1; open = html.indexOf("<", at)) {
    const close = html.indexOf(">", open + 1);
    if (close === -1) break;
    out.push(html.slice(at, open), tagText(html.slice(open + 1, close), blockEnd));
    at = close + 1;
  }
  out.push(html.slice(at));
  return out.join("");
}

/**
 * Plain text of the HTML the XZuFi texts carry: tags dropped, block ends and line breaks as new
 * lines, list items as "- ", entities decoded, blank runs collapsed. Nothing is reworded.
 */
export function plainText(html: string | null | undefined): string {
  return textOf(html, "\n");
}

/** plainText, with `blockEnd` for the end of a block. */
function textOf(html: string | null | undefined, blockEnd: string): string {
  if (html === null || html === undefined) return "";
  return withoutTags(html, blockEnd)
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] === "#") {
        const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isSafeInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    })
    .replace(/[ \t ]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line, i, lines) => line !== "" || (i > 0 && lines[i - 1] !== ""))
    .join("\n")
    .trim();
}

/** The lines of a text that may be HTML (legal bases): plain, each cut to 300 characters, at most `max`. */
function linesOf(text: string | undefined, max: number): string[] {
  return plainText(text)
    .split("\n")
    .map((line) => cut(line.replace(/^- /, ""), 300) ?? "")
    .filter((line) => line !== "")
    .slice(0, max);
}

/**
 * The paragraphs of an HTML text: its blocks as plain text, empty ones left out. A block's end is
 * a paragraph's end even with no line break after it in the HTML (`<p>a</p><p>b</p>`); a `<br>`
 * stays inside its paragraph.
 */
function paragraphsOf(html: string | null | undefined): string[] {
  return textOf(html, "\n\n")
    .split(/\n{2,}|\n(?=- )/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

/** A schema, field, group or document profile's id: a letter and digits (S05000039, F60000236). */
const ELEMENT_ID = /^[SFGDR]\d{5,}$/i;
/** A Leistungsschlüssel: 14 digits. */
const SERVICE_KEY = /^\d{14}$/;

// ---- schemas by id or name ------------------------------------------------------------------

/** A schema hit of a search, as an ambiguous or empty answer lists it. */
export interface SchemaCandidate {
  fimId: string;
  version: string;
  name: string;
  title: string | null;
  statusLabel: string;
  xdfVersion: string;
  /** True when its name and title together contain every searched word; else it matched inside its elements. */
  titleNamesIt: boolean;
}

/** How a schema given by id or by name was found. */
type SchemaLookup =
  | { status: "ok"; fimId: string; version: string }
  | { status: "ambiguous" | "empty"; searched: { schema: string }; total: number; candidates: SchemaCandidate[]; reason: string };

/** How many schema hits a name is looked up among. */
const SCHEMA_CANDIDATES = 10;

/**
 * A schema by its id (S…), or by a name searched among the latest versions. The full-text search
 * also matches the elements' texts ("Elterngeld" finds Wohngeld forms that mention it), so a hit
 * whose name and title don't contain every word of the text is never taken as the answer: one
 * exact title, or one hit that names it, is; several are `ambiguous`; hits that only mention it
 * are `empty`, with them listed.
 */
async function resolveSchema(client: FimPortalClient, schema: string, version: string): Promise<SchemaLookup> {
  const given = normalizeText(assertValid("schema", schema, textProblem));
  if (ELEMENT_ID.test(given)) return { status: "ok", fimId: given.toUpperCase(), version };
  const page = await client.schemas.search({ fts_query: given, is_latest: true, limit: SCHEMA_CANDIDATES });
  const wanted = fold(given);
  const candidates = page.items.map((item): SchemaCandidate => {
    const titleNamesIt = namesAll(wanted, [item.name, item.bezeichnung]);
    return { fimId: item.fim_id, version: item.fim_version, name: item.name.trim(), title: item.bezeichnung?.trim() ?? null, statusLabel: item.freigabe_status_label, xdfVersion: item.xdf_version, titleNamesIt };
  });
  const exact = page.items.filter((item) => fold(item.name) === wanted || fold(item.bezeichnung ?? "") === wanted);
  const titled = candidates.filter((c) => c.titleNamesIt);
  const searched = { schema: given };
  if (exact.length === 1) return { status: "ok", fimId: exact[0]!.fim_id, version };
  if (titled.length === 1 && exact.length === 0) return { status: "ok", fimId: titled[0]!.fimId, version };
  if (candidates.length === 0) {
    return { status: "empty", searched, total: 0, candidates: [], reason: `No schema matches "${given}". Try another word (the schemas are named in German: Antrag, Anzeige, Meldung) or give the schema's id (S…).` };
  }
  if (titled.length === 0) {
    return {
      status: "empty",
      searched,
      total: page.total_count,
      candidates,
      reason: `No schema's name or title contains every word of "${given}": these ${candidates.length} of ${page.total_count} hits only mention it inside their elements, so none is about it. Say so; offer them only as related, or try another word.`,
    };
  }
  return {
    status: "ambiguous",
    searched,
    total: page.total_count,
    candidates: [...titled, ...candidates.filter((c) => !c.titleNamesIt)],
    reason: `${titled.length} schemas are named for "${given}"${page.total_count > candidates.length ? ` (of ${page.total_count} hits, the first ${candidates.length} listed)` : ""}: ask which one, then call again with its id.`,
  };
}

/** The answer for a schema id or version the portal doesn't know. */
function schemaNotFound(fimId: string, version: string): { status: "empty"; searched: { schema: string; version: string }; reason: string } {
  return {
    status: "empty",
    searched: { schema: fimId, version },
    reason: `The portal has no schema ${fimId} in version ${version}. Take ids from a search (searchCatalogue, resource schemas) and versions from getElement with versions: true; ids and versions change as the catalogue is updated.`,
  };
}

/** The schema's catalogue entries by id@version, and by id for a node without a version. */
function catalogueOf(entries: JsonObject[]): Map<string, JsonObject> {
  const map = new Map<string, JsonObject>();
  for (const entry of entries) {
    const id = str(entry["fim_id"]);
    if (id === undefined) continue;
    map.set(`${id}@${str(entry["fim_version"]) ?? ""}`, entry);
    if (!map.has(id)) map.set(id, entry);
  }
  return map;
}

/** A node's catalogue entry: by id and version, else by id. */
function lookup(map: Map<string, JsonObject>, id: string, version: string | undefined): JsonObject | undefined {
  return map.get(`${id}@${version ?? ""}`) ?? map.get(id);
}

/** Counts by label, most frequent first. */
function countBy(labels: string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  return Object.fromEntries([...counts].sort((a, b) => b[1] - a[1]));
}

/** The schema's facts every schema answer leads with. */
export interface SchemaFacts {
  fimId: string;
  version: string;
  name: string;
  title: string | null;
  xdfVersion: string | null;
  statusLabel: string;
  fields: number;
  groups: number;
  rules: number;
}

function schemaFacts(schema: JsonObject, fimId: string, version: string): SchemaFacts {
  return {
    fimId: str(schema["fim_id"]) ?? fimId,
    version: str(schema["fim_version"]) ?? version,
    name: (str(schema["name"]) ?? "").trim(),
    title: str(schema["bezeichnung"])?.trim() ?? null,
    xdfVersion: str(schema["xdf_version"]) ?? null,
    statusLabel: str(schema["freigabe_status_label"]) ?? freigabeStatusLabel(schema["freigabe_status"]),
    fields: arr(schema["datenfelder"]).length,
    groups: arr(schema["datenfeldgruppen"]).length,
    rules: arr(schema["regeln"]).length,
  };
}

// ---- findReusableFields (fim-field-finder) ---------------------------------------------------

/** The input of {@link findReusableFields}. */
export interface ReusableFieldsInput {
  /** Full-text search (name, definition and more): the concept. */
  query?: string | undefined;
  /** A part of the name (substring: "Name" matches Familienname, Vorname). */
  name?: string | undefined;
  /** Fields (default) or groups (bundles of fields: an address, a person's name). */
  kind?: "field" | "group" | undefined;
  /** Fields only: input, select, label, hidden, locked. */
  feldart?: Feldart | undefined;
  /** Fields only: text, date, bool, num, num_currency, file, … */
  datentyp?: Datentyp | undefined;
  /** The owning number range, a prefix (00000: the central Baukasten). */
  nummernkreis?: string | undefined;
  /** Also unreleased ones (in Planung to methodisch freigegeben); never the retired (inaktiv, zum Löschen). */
  includeUnreleased?: boolean | undefined;
  /** At most this many candidates (1–50, default 10). */
  limit?: number | undefined;
}

/** One building block, ranked. */
export interface ReusableCandidate {
  rank: number;
  /**
   * exact: the name is the searched text; name: it contains every word, or is one of them (a
   * query of several words often names one concept several ways: "Staatsangehörigkeit,
   * Nationalität"); partial: it contains some of them; text: none, it matched elsewhere
   * (definition, bezug), likely not about it. Words under three letters and articles don't count.
   */
  nameMatch: NameMatch;
  fimId: string;
  /** Needed with fimId to fetch the element (getElement); in practice `baukasten`. */
  namespace: string;
  version: string;
  name: string;
  definition: string | null;
  feldart?: string;
  datentyp?: string;
  /** For a select field: the code list holding its values. */
  codeListId?: number | null;
  freigabeStatus: number;
  statusLabel: string;
  released: boolean;
  nummernkreis: string;
  /** In the central Baukasten (Nummernkreis 00000). */
  central: boolean;
  /** References to XÖV core components or legal bases: a reuse signal. */
  bezug: string[];
  xdfVersion: string;
}

/** The answer of {@link findReusableFields}. */
export type ReusableFields =
  | { status: "ok"; kind: "field" | "group"; searched: Record<string, unknown>; total: number; rankedAmong: number; best: string; candidates: ReusableCandidate[]; notes: string[] }
  | { status: "empty"; kind: "field" | "group"; searched: Record<string, unknown>; total: 0; reason: string };

/** How many hits are fetched and ranked (the API's largest page). */
const RANK_AMONG = 200;

/** How a candidate's name fits the searched text (ReusableCandidate.nameMatch). */
type NameMatch = "exact" | "name" | "partial" | "text";

/** Short German words that say nothing about a field's concept ("Staatsangehörigkeit des Kindes"). */
const FILLER_WORDS = new Set(["der", "die", "das", "des", "dem", "den", "ein", "eine", "einer", "eines", "einem", "einen", "und", "oder", "für", "von", "mit", "bei", "zur", "zum", "auf", "aus", "nach", "über", "unter", "vor", "ohne", "gegen"]);

/**
 * The words of a folded text: split at anything not a letter or digit (spaces, commas, hyphens,
 * brackets), and, unless `all`, without words under three letters and filler words; when nothing
 * is left, every word.
 */
function wordsOf(folded: string, all = true): string[] {
  const every = folded.split(/[^\p{L}\p{N}]+/u).filter((word) => word !== "");
  if (!all) return every;
  const telling = every.filter((word) => word.length >= 3 && !FILLER_WORDS.has(word));
  return telling.length > 0 ? telling : every;
}

/** Rank of a status for reuse: gold, silber, methodisch freigegeben, then the drafts. */
const STATUS_RANK: Readonly<Record<number, number>> = { 6: 0, 5: 1, 4: 2, 3: 3, 2: 4, 1: 5 };

/** The query of {@link findReusableFields}: always the latest version, never the retired. */
export function reusableFieldsQuery(input: ReusableFieldsInput): Record<string, string | number | boolean | (string | number)[] | undefined> {
  const kind = input.kind ?? "field";
  assertValid("kind", kind, oneOfProblem(["field", "group"]));
  if (kind === "group" && (input.feldart !== undefined || input.datentyp !== undefined)) {
    throw new FimValidationError("Invalid feldart/datentyp: groups have neither; leave them out, or search fields.");
  }
  if (input.feldart !== undefined) assertValid("feldart", input.feldart, oneOfProblem(FeldartValues));
  if (input.datentyp !== undefined) assertValid("datentyp", input.datentyp, oneOfProblem(DatentypValues));
  const query = optionalText("query", input.query);
  const name = optionalText("name", input.name);
  const nummernkreis = optionalText("nummernkreis", input.nummernkreis);
  if (query === undefined && name === undefined && input.feldart === undefined && input.datentyp === undefined && nummernkreis === undefined) {
    throw new FimValidationError("Give at least one of query, name, feldart, datentyp or nummernkreis: the whole catalogue is tens of thousands of elements.");
  }
  return {
    fts_query: query,
    name,
    feldart: input.feldart,
    datentyp: input.datentyp,
    nummernkreis: nummernkreis === undefined ? undefined : [nummernkreis],
    freigabe_status: [...(input.includeUnreleased === true ? NOT_RETIRED : RELEASED)],
    is_latest: true,
    limit: RANK_AMONG,
  };
}

/**
 * Reusable FIM data fields (or groups), latest versions only, released ones only unless asked,
 * never the retired: ranked by how the name fits (the searched name itself, then names with its
 * words, then hits that matched only in other text), then by status (gold, silber, then the
 * unreleased), then the central Baukasten (00000) before domain copies (status wins: the released
 * field isn't always in 00000), then a `bezug` to a core component, then the portal's relevance.
 * One request of up to 200 hits.
 */
export async function findReusableFields(client: FimPortalClient, input: ReusableFieldsInput): Promise<ReusableFields> {
  const kind = input.kind ?? "field";
  const query = reusableFieldsQuery(input);
  const limit = bounded("limit", input.limit, 10, 1, 50);
  const searched = Object.fromEntries(
    Object.entries({ query: query["fts_query"], name: query["name"], feldart: query["feldart"], datentyp: query["datentyp"], nummernkreis: (query["nummernkreis"] as string[] | undefined)?.[0], released: input.includeUnreleased !== true }).filter(([, v]) => v !== undefined),
  );
  const params = query as unknown as FieldSearchParams;
  const page = kind === "field" ? await client.fields.search(params) : await client.groups.search(params);
  const items = page.items as unknown as JsonObject[];
  if (items.length === 0) {
    const reason =
      input.includeUnreleased === true
        ? `No ${kind} matches (latest versions, retired ones left out). Try a broader word, query instead of name, or fewer filters.`
        : `No released (silber or gold) ${kind} matches. includeUnreleased: true also shows drafts and ${kind}s in Bearbeitung (flag them as unreleased); or try a broader word.`;
    return { status: "empty", kind, searched, total: 0, reason };
  }
  const wanted = fold((query["name"] as string | undefined) ?? (query["fts_query"] as string | undefined));
  const words = wordsOf(wanted);
  const matchOf = (item: JsonObject): NameMatch => {
    const name = fold(str(item["name"]));
    if (wanted === "") return "name";
    const bare = wordsOf(name, false).join(" ");
    if (name === wanted || bare === wordsOf(wanted, false).join(" ")) return "exact";
    const found = words.filter((word) => name.includes(word)).length;
    // A name that is one of the words is that word's namesake: several words often name one
    // concept several ways ("Staatsangehörigkeit, Nationalität").
    return found === words.length || words.includes(bare) ? "name" : found > 0 ? "partial" : "text";
  };
  const MATCH_RANK: Readonly<Record<NameMatch, number>> = { exact: 0, name: 1, partial: 2, text: 3 };
  const ranked = items
    .map((item, index) => ({ item, index, match: matchOf(item) }))
    .sort((a, b) => {
      const match = MATCH_RANK[a.match] - MATCH_RANK[b.match];
      if (match !== 0) return match;
      const status = (STATUS_RANK[num(a.item["freigabe_status"]) ?? 0] ?? 9) - (STATUS_RANK[num(b.item["freigabe_status"]) ?? 0] ?? 9);
      if (status !== 0) return status;
      const central = Number(str(b.item["nummernkreis"]) === "00000") - Number(str(a.item["nummernkreis"]) === "00000");
      if (central !== 0) return central;
      const bezug = Number(strings(b.item["bezug"]).some((s) => s.trim() !== "")) - Number(strings(a.item["bezug"]).some((s) => s.trim() !== ""));
      return bezug !== 0 ? bezug : a.index - b.index;
    })
    .slice(0, limit)
    .map(({ item, match }, i): ReusableCandidate => {
      const status = num(item["freigabe_status"]) ?? 0;
      const nummernkreis = str(item["nummernkreis"]) ?? "";
      return {
        rank: i + 1,
        nameMatch: match,
        fimId: str(item["fim_id"]) ?? "",
        namespace: str(item["namespace"]) ?? "",
        version: str(item["fim_version"]) ?? "",
        name: (str(item["name"]) ?? "").trim(),
        definition: cut(str(item["definition"]), 300) ?? null,
        ...(kind === "field" ? { feldart: str(item["feldart"]) ?? "", datentyp: str(item["datentyp"]) ?? "", codeListId: num(item["code_list_id"]) ?? null } : {}),
        freigabeStatus: status,
        statusLabel: str(item["freigabe_status_label"]) ?? freigabeStatusLabel(status),
        released: status === 5 || status === 6,
        nummernkreis,
        central: nummernkreis === "00000",
        bezug: strings(item["bezug"]).map((b) => cut(b, 200) ?? "").filter((b) => b !== "").slice(0, 3),
        xdfVersion: str(item["xdf_version"]) ?? "",
      };
    });
  const top = ranked[0]!;
  const notes: string[] = [`To reuse a ${kind}, reference its fimId with its namespace: getElement needs both.`];
  if (page.total_count > items.length) notes.push(`Ranked among the first ${items.length} of ${page.total_count} matches in the portal's order; narrow with query or name rather than paging.`);
  if (page.total_count > 1000) notes.push(`${page.total_count} ${kind}s match: a broad filter. Add a query or a name.`);
  if (query["name"] !== undefined) notes.push(`name is a substring match ("Name" also matches Familienname, Vorname); query searches the concept.`);
  if (ranked.some((c) => c.nameMatch === "partial")) notes.push("Candidates with nameMatch partial hold only some of the searched words in their name: check that they are about it.");
  if (wanted !== "" && ranked.some((c) => c.nameMatch === "text")) notes.push("Candidates with nameMatch text matched only in their definition or references: likely not about it; say so rather than offering them as the field.");
  const second = ranked[1];
  if (second !== undefined && second.nameMatch === top.nameMatch && second.freigabeStatus === top.freigabeStatus && second.central === top.central) {
    notes.push(`The first candidates are alike by name, status and Baukasten: choose by the name's qualifier, or compare how widely each is used (getElement: usedIn).`);
  }
  if (!top.released) notes.push(`The best match is not released (${top.statusLabel}): say so, never present it as the ${kind} to use.`);
  if (!top.central && ranked.some((c) => c.central)) notes.push("The best match is not in the central Baukasten (00000): a central one has a lower status, and status wins.");
  if (kind === "field" && ranked.some((c) => c.feldart === "select")) notes.push("A select field's values are in its code list (codeListId); getElement gives the list's name and URL.");
  const best = `${top.fimId} ${top.name} (${top.statusLabel}, Nummernkreis ${top.nummernkreis}${kind === "field" ? `, ${top.feldart} · ${top.datentyp}` : ""}) is the most reusable of ${page.total_count} ${input.includeUnreleased === true ? "" : "released "}${kind}s.`;
  return { status: "ok", kind, searched, total: page.total_count, rankedAmong: items.length, best, candidates: ranked, notes };
}

// ---- auditSchemaQuality (fim-quality-audit) ----------------------------------------------------

/** The input of {@link auditSchemaQuality}. */
export interface SchemaAuditInput {
  /** A schema id (S…) or its name. */
  schema: string;
  /** A version (default latest). */
  version?: string | undefined;
  /** At most this many element ids per issue (1–20, default 5). */
  perIssue?: number | undefined;
}

/** One recurring finding: a check code of one severity, with the elements it flagged. */
export interface QualityIssue {
  severity: string;
  code: number | string;
  count: number;
  /** The first message of this code (German), as the portal words it. */
  message: string;
  elements: { id: string; version: string | null; type: string; name: string | null }[];
  /** Elements flagged beyond those listed. */
  more: number;
}

/** The answer of {@link auditSchemaQuality}. */
export type SchemaAudit =
  | {
      status: "ok";
      schema: SchemaFacts;
      verdict: string;
      totalChecks: number;
      bySeverity: Record<string, number>;
      findings: { schema: number; groups: number; fields: number; rules: number };
      checked: { groups: number; fields: number; rules: number };
      issues: QualityIssue[];
      notes: string[];
    }
  | Exclude<SchemaLookup, { status: "ok" }>
  | ReturnType<typeof schemaNotFound>;

/** The severities in the order an audit reports them; any other value follows. */
const SEVERITY_ORDER = ["critical", "warning", "method", "info"];

/**
 * A schema's quality report, aggregated: every failing check of the schema, its groups, fields and
 * rules, counted by severity (`error_type`: critical, warning, method, info — there is no
 * "error"; any other value is counted, never dropped) and grouped by check code, most frequent
 * first, critical first, each with the flagged elements named from the schema's catalogue.
 * total_checks counts every finding, mostly warnings: the verdict says critical first. Two
 * requests (the report, the schema for names), one more for a name to search.
 */
export async function auditSchemaQuality(client: FimPortalClient, input: SchemaAuditInput): Promise<SchemaAudit> {
  const version = versionOf(input.version);
  const perIssue = bounded("perIssue", input.perIssue, 5, 1, 20);
  const found = await resolveSchema(client, input.schema, version);
  if (found.status !== "ok") return found;
  let report: JsonObject;
  let schema: JsonObject;
  try {
    report = await client.schemas.qualityReport(found.fimId, version);
    schema = await client.schemas.get(found.fimId, version);
  } catch (err) {
    if (isNotFound(err)) return schemaNotFound(found.fimId, version);
    throw err;
  }
  const fields = catalogueOf(objects(schema["datenfelder"]));
  const groups = catalogueOf(objects(schema["datenfeldgruppen"]));
  type Finding = { severity: string; code: number | string; message: string; id: string; version: string | null; type: string };
  const all: Finding[] = [];
  const findings = { schema: 0, groups: 0, fields: 0, rules: 0 };
  const add = (check: JsonObject, id: string, elementVersion: string | null, type: string): void => {
    all.push({ severity: str(check["error_type"]) ?? "unknown", code: num(check["code"]) ?? str(check["code"]) ?? "?", message: str(check["message"]) ?? "", id, version: elementVersion, type });
  };
  for (const check of objects(report["schema_checks"])) {
    add(check, found.fimId, version, "schema");
    findings.schema++;
  }
  const buckets = [
    ["group_reports", "group", "groups"],
    ["field_reports", "field", "fields"],
    ["rule_reports", "rule", "rules"],
  ] as const;
  for (const [key, type, bucket] of buckets) {
    for (const entry of objects(report[key])) {
      const identifier = obj(entry["identifier"]) ?? {};
      for (const check of objects(entry["failing_checks"])) {
        add(check, str(identifier["id"]) ?? "?", str(identifier["version"]) ?? null, type);
        findings[bucket]++;
      }
    }
  }
  const rank = (severity: string): number => (SEVERITY_ORDER.includes(severity) ? SEVERITY_ORDER.indexOf(severity) : SEVERITY_ORDER.length);
  const bySeverity: Record<string, number> = {};
  for (const severity of [...new Set(all.map((f) => f.severity))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))) {
    bySeverity[severity] = all.filter((f) => f.severity === severity).length;
  }
  const groupsOfIssues = new Map<string, Finding[]>();
  for (const f of all) {
    const key = `${f.severity}\u0000${f.code}`;
    groupsOfIssues.set(key, [...(groupsOfIssues.get(key) ?? []), f]);
  }
  const nameOf = (f: Finding): string | null => {
    const entry = f.type === "field" ? lookup(fields, f.id, f.version ?? undefined) : f.type === "group" ? lookup(groups, f.id, f.version ?? undefined) : f.type === "schema" ? schema : undefined;
    return str(entry?.["name"])?.trim() ?? null;
  };
  const issues = [...groupsOfIssues.values()]
    .sort((a, b) => rank(a[0]!.severity) - rank(b[0]!.severity) || b.length - a.length)
    .map((list): QualityIssue => {
      const unique = [...new Map(list.map((f) => [`${f.type}:${f.id}@${f.version}`, f])).values()];
      return {
        severity: list[0]!.severity,
        code: list[0]!.code,
        count: list.length,
        message: cut(list[0]!.message, 300) ?? "",
        elements: unique.slice(0, perIssue).map((f) => ({ id: f.id, version: f.version, type: f.type, name: nameOf(f) })),
        more: Math.max(0, unique.length - perIssue),
      };
    });
  const facts = schemaFacts(schema, found.fimId, version);
  const total = num(report["total_checks"]) ?? all.length;
  const critical = bySeverity["critical"] ?? 0;
  const split = Object.entries(bySeverity).map(([severity, n]) => `${n} ${severity}`).join(", ");
  const judgement = all.length === 0 ? "passed, no findings: clean" : critical > 0 ? `needs fixes: ${critical} critical` : "reusable with caveats (no critical finding)";
  const notes: string[] = [];
  if (all.length > 0) notes.push("error_type is the severity: critical must be fixed; warning, method and info are advisory. Lead with critical, never count warnings as errors.");
  if (total !== all.length) notes.push(`total_checks says ${total}; the reports hold ${all.length} failing checks.`);
  const ruleReports = arr(report["rule_reports"]).length;
  if (ruleReports > facts.rules) notes.push(`The report checks ${ruleReports} rules, more than the schema's own ${facts.rules}: it covers the elements' rules too; don't cross-check the two.`);
  notes.push("The report covers this one version; to compare versions, list them with getElement (kind schema, versions true) and audit each.");
  return {
    status: "ok",
    schema: facts,
    verdict: `${facts.name} (${facts.fimId} v${facts.version}): ${total} findings${split === "" ? "" : ` (${split})`}: ${judgement}.`,
    totalChecks: total,
    bySeverity,
    findings,
    checked: { groups: arr(report["group_reports"]).length, fields: arr(report["field_reports"]).length, rules: ruleReports },
    issues,
    notes,
  };
}

// ---- getSchemaBlueprint (fim-schema-blueprint) ------------------------------------------------

/** The input of {@link getSchemaBlueprint}. */
export interface SchemaBlueprintInput {
  /** A schema id (S…) or its name. */
  schema: string;
  version?: string | undefined;
  /** Only this group's part of the form (a G… id from the outline), expanded from it. */
  group?: string | undefined;
  /** How many levels the outline shows (1–12, default 2); deeper groups are counted. */
  depth?: number | undefined;
}

/** One line of the form's outline. */
export interface BlueprintNode {
  depth: number;
  type: "group" | "field";
  id: string;
  version: string | null;
  name: string | null;
  /** The portal's anzahl: 1:1, 0:1, 0:n, 1:n. */
  cardinality: string | null;
  /** required, optional, repeatable, required+repeatable. */
  use: string;
  feldart?: string;
  datentyp?: string;
  /** A select field's code list. */
  codeListId?: number | null;
  /** Set for an element that is inaktiv or marked for deletion. */
  retired?: string;
  /** A group's direct children. */
  children?: number;
  /** Children below the outline's depth, not shown (ask with group to expand). */
  hidden?: number;
}

/** The answer of {@link getSchemaBlueprint}. */
export type SchemaBlueprint =
  | {
      status: "ok";
      schema: SchemaFacts & { steckbrief: { id: string; name: string | null } | null; definition: string | null; legalBases: string[]; topLevel: number };
      group?: { id: string; name: string | null };
      elementStatuses: { fields: Record<string, number>; groups: Record<string, number> };
      retired: { type: string; id: string; name: string | null; statusLabel: string }[];
      outline: BlueprintNode[];
      notes: string[];
    }
  | Exclude<SchemaLookup, { status: "ok" }>
  | ReturnType<typeof schemaNotFound>
  | { status: "empty"; searched: { schema: string; group: string }; reason: string; groups: { id: string; name: string | null }[] };

/** The most outline lines one answer builds (reused groups multiply them). */
const MAX_OUTLINE = 3000;

/** What a cardinality means for a form. */
function useOf(cardinality: string | null): string {
  if (cardinality === null) return "unknown";
  const [min, max] = cardinality.split(":");
  const repeatable = max === "n" || (max !== undefined && Number(max) > 1);
  const required = min !== undefined && min !== "0";
  return required ? (repeatable ? "required, repeatable" : "required") : repeatable ? "repeatable" : "optional";
}

/**
 * A schema as a form outline: the top level (`children`) in order, every group expanded through
 * its own entry in the schema's group catalogue (`datenfeldgruppen`, where the nesting lives:
 * `children` holds only the top level), each field with its type and code list from the field
 * catalogue (`datenfelder`), each node with its cardinality. A group reused in several places
 * appears each time; a group inside itself is not followed. Leads with the totals, the legal
 * bases and the elements' own statuses (a released schema can be built from unreleased elements),
 * naming the retired ones. One request (two for a name).
 */
export async function getSchemaBlueprint(client: FimPortalClient, input: SchemaBlueprintInput): Promise<SchemaBlueprint> {
  const version = versionOf(input.version);
  const depth = bounded("depth", input.depth, 2, 1, 12);
  const groupId = optionalText("group", input.group)?.toUpperCase();
  const found = await resolveSchema(client, input.schema, version);
  if (found.status !== "ok") return found;
  let schema: JsonObject;
  try {
    schema = await client.schemas.get(found.fimId, version);
  } catch (err) {
    if (isNotFound(err)) return schemaNotFound(found.fimId, version);
    throw err;
  }
  const fieldEntries = objects(schema["datenfelder"]);
  const groupEntries = objects(schema["datenfeldgruppen"]);
  const fields = catalogueOf(fieldEntries);
  const groups = catalogueOf(groupEntries);
  let roots = objects(schema["children"]);
  let rootGroup: { id: string; name: string | null } | undefined;
  if (groupId !== undefined) {
    const entry = groups.get(groupId);
    if (entry === undefined) {
      return {
        status: "empty",
        searched: { schema: found.fimId, group: groupId },
        reason: `Group ${groupId} is not part of ${found.fimId} v${str(schema["fim_version"]) ?? version}. Take a group id from this schema's outline.`,
        groups: groupEntries.slice(0, 30).map((g) => ({ id: str(g["fim_id"]) ?? "", name: str(g["name"])?.trim() ?? null })),
      };
    }
    roots = objects(entry["children"]);
    rootGroup = { id: groupId, name: str(entry["name"])?.trim() ?? null };
  }
  const outline: BlueprintNode[] = [];
  let cut_ = false;
  const walk = (nodes: JsonObject[], level: number, path: Set<string>): void => {
    for (const node of nodes) {
      if (outline.length >= MAX_OUTLINE) {
        cut_ = true;
        return;
      }
      const id = str(node["fim_id"]) ?? "?";
      const nodeVersion = str(node["fim_version"]) ?? null;
      const cardinality = str(node["anzahl"]) ?? null;
      if (str(node["type"]) === "Gruppe") {
        const entry = lookup(groups, id, nodeVersion ?? undefined);
        const children = objects(entry?.["children"]);
        const status = num(entry?.["freigabe_status"]);
        const line: BlueprintNode = { depth: level, type: "group", id, version: nodeVersion, name: str(entry?.["name"])?.trim() ?? null, cardinality, use: useOf(cardinality), children: children.length };
        if (status === 7 || status === 8) line.retired = freigabeStatusLabel(status);
        outline.push(line);
        if (path.has(id)) continue;
        if (level + 1 >= depth) {
          if (children.length > 0) line.hidden = children.length;
          continue;
        }
        walk(children, level + 1, new Set([...path, id]));
      } else {
        const entry = lookup(fields, id, nodeVersion ?? undefined);
        const status = num(entry?.["freigabe_status"]);
        const line: BlueprintNode = {
          depth: level,
          type: "field",
          id,
          version: nodeVersion,
          name: str(entry?.["name"])?.trim() ?? null,
          cardinality,
          use: useOf(cardinality),
          feldart: str(entry?.["feldart"]) ?? "",
          datentyp: str(entry?.["datentyp"]) ?? "",
          ...(num(entry?.["code_list_id"]) === undefined ? {} : { codeListId: num(entry?.["code_list_id"]) ?? null }),
        };
        if (status === 7 || status === 8) line.retired = freigabeStatusLabel(status);
        outline.push(line);
      }
    }
  };
  walk(roots, 0, new Set(groupId === undefined ? [] : [groupId]));
  const facts = schemaFacts(schema, found.fimId, version);
  const statusLabelOf = (e: JsonObject): string => str(e["freigabe_status_label"]) ?? freigabeStatusLabel(e["freigabe_status"]);
  const retired = [
    ...fieldEntries.filter((e) => [7, 8].includes(num(e["freigabe_status"]) ?? 0)).map((e) => ({ type: "field", e })),
    ...groupEntries.filter((e) => [7, 8].includes(num(e["freigabe_status"]) ?? 0)).map((e) => ({ type: "group", e })),
  ].map(({ type, e }) => ({ type, id: str(e["fim_id"]) ?? "", name: str(e["name"])?.trim() ?? null, statusLabel: statusLabelOf(e) }));
  const notes: string[] = [];
  if (outline.some((n) => n.hidden !== undefined)) notes.push(`Groups below depth ${depth} are counted (hidden), not shown: call again with group set to one of their ids, or a larger depth.`);
  if (cut_) notes.push(`The outline stops at ${MAX_OUTLINE} lines: expand one group at a time.`);
  if (/freigegeben/.test(facts.statusLabel) && [...fieldEntries, ...groupEntries].some((e) => (num(e["freigabe_status"]) ?? 0) < 5)) {
    notes.push(`The schema is ${facts.statusLabel}, but some of its elements are not released: the elements' statuses are their own (elementStatuses).`);
  }
  if (retired.length > 0) notes.push(`${retired.length} element(s) are retired (inaktiv or marked for deletion): name them.`);
  notes.push("A group used in several places appears each time. Fields with codeListId take their values from that code list (not fetched here). Rules (regeln) are counted only.");
  const steckbriefId = str(schema["steckbrief_id"]);
  return {
    status: "ok",
    schema: {
      ...facts,
      steckbrief: steckbriefId === undefined ? null : { id: steckbriefId, name: str(schema["steckbrief_name"]) ?? null },
      definition: cut(str(schema["definition"]), 500) ?? null,
      legalBases: strings(schema["bezug"]).map((b) => cut(b, 300) ?? "").filter((b) => b !== "").slice(0, 10),
      topLevel: arr(schema["children"]).length,
    },
    ...(rootGroup === undefined ? {} : { group: rootGroup }),
    elementStatuses: { fields: countBy(fieldEntries.map(statusLabelOf)), groups: countBy(groupEntries.map(statusLabelOf)) },
    retired,
    outline,
    notes,
  };
}

// ---- getServiceDossier (fim-service-dossier) --------------------------------------------------

/** The Leistungsadressat codes of XZuFi. */
const ADDRESSEES: Readonly<Record<string, string>> = { "001": "Bürger (citizens)", "002": "Unternehmen (businesses)", "003": "Verwaltung (public administration)" };
/** The LeiKa Leistungstyp: how fine-grained the entry is. */
const SERVICE_TYPES: Readonly<Record<string, string>> = { lo: "Leistungsobjekt", lov: "Leistungsobjekt mit Verrichtung", lovd: "Leistungsobjekt mit Verrichtung und Detail" };

/** The input of {@link getServiceDossier}. */
export interface ServiceDossierInput {
  /** A Leistungsschlüssel (14 digits) or words of the service's name. */
  service: string;
}

/** A service hit, as an ambiguous answer lists it. */
export interface ServiceCandidate {
  key: string;
  title: string;
  citizenName: string | null;
  themenfeld: string | null;
  statusLabel: string;
  changed: string | null;
}

/** One editorial office's text of a service. */
export interface ServiceTextRef {
  redaktionId: string;
  leistungId: string;
  /** leika, landesredaktion or pvog: what getServiceText needs; null when the search didn't list it. */
  source: string | null;
  title: string | null;
  /** federal (B…), state (L…), portal (S…), other. */
  level: string;
  statusLabel: string;
}

/** The answer of {@link getServiceDossier}. */
export type ServiceDossier =
  | {
      status: "ok";
      verdict: string;
      service: {
        key: string;
        title: string | null;
        citizenName: string | null;
        for: { code: string; label: string }[];
        type: { code: string; label: string } | null;
        statusCode: number | null;
        statusLabel: string;
        created: string | null;
        changed: string | null;
        ozg: { id: string | null; leistung: string | null; themenfeld: string | null } | null;
        sdg: string[];
        legalBases: string[];
        process: JsonValue;
        replacements: JsonValue[];
      };
      texts: ServiceTextRef[];
      byLevel: Record<string, number>;
      canonical: { redaktionId: string; leistungId: string; source: string | null; summary: string } | null;
      notes: string[];
    }
  | { status: "ambiguous"; searched: { service: string }; total: number; candidates: ServiceCandidate[]; reason: string }
  | { status: "empty"; searched: { service: string }; reason: string };

/** How many service hits a name is looked up among. */
const SERVICE_CANDIDATES = 10;

function levelOf(redaktionId: string): string {
  if (redaktionId.startsWith("B")) return "federal";
  if (redaktionId.startsWith("L")) return "state";
  if (redaktionId.startsWith("S")) return "portal";
  return "other";
}

/**
 * A public service (Leistung) as one dossier: the profile (citizen name, addressees, type, status
 * mapped to its label since the profile carries none, OZG and SDG, legal bases), the linked
 * process class or that there is none, and every editorial office's master text with the source
 * getServiceText needs (looked up: it can't be told from the Redaktion's prefix), federal first;
 * the federal text's summary as plain text. By key: two requests; by name: a search first, and
 * several hits are `ambiguous`.
 */
export async function getServiceDossier(client: FimPortalClient, input: ServiceDossierInput): Promise<ServiceDossier> {
  const given = normalizeText(assertValid("service", input.service, textProblem));
  const searched = { service: given };
  let key = given;
  if (!SERVICE_KEY.test(given)) {
    const page = await client.serviceProfiles.search({ fts_query: given, sprache: "Deutsch", limit: SERVICE_CANDIDATES });
    const items = objects(page["items"]);
    const total = num(page["total_count"]) ?? items.length;
    const wanted = fold(given);
    const names = (i: JsonObject): (string | undefined)[] => [str(i["title"]), str(i["leistungsbezeichnung"]), str(i["leistungsbezeichnung_2"])];
    const exact = items.filter((i) => names(i).some((t) => fold(t) === wanted));
    // The full-text search also matches a service's texts: a hit whose names hold every word is likelier.
    const named = items.filter((i) => namesAll(wanted, names(i)));
    const pick = items.length === 1 ? items[0] : exact.length === 1 ? exact[0] : exact.length === 0 && named.length === 1 ? named[0] : undefined;
    if (items.length === 0) return { status: "empty", searched, reason: `No service matches "${given}". Try fewer or other words (German: Personalausweis, Hundesteuer), or give the 14-digit Leistungsschlüssel.` };
    if (pick === undefined) {
      return {
        status: "ambiguous",
        searched,
        total,
        candidates: [...named, ...items.filter((i) => !named.includes(i))].map((i) => ({
          key: str(i["leistungsschluessel"]) ?? "",
          title: str(i["title"]) ?? "",
          citizenName: str(i["leistungsbezeichnung_2"]) ?? null,
          themenfeld: str(obj(i["ozg"])?.["themenfeld_label"]) ?? null,
          statusLabel: freigabeStatusLabel(i["freigabe_status"]),
          changed: str(i["geaendert_datum_zeit"]) ?? null,
        })),
        reason: `${total} services match "${given}"${total > items.length ? ` (the first ${items.length} listed)` : ""}${named.length > 1 ? `, ${named.length} of them named with every word (listed first)` : ""}: ask which one, or narrow the words, then call again with its key.`,
      };
    }
    key = str(pick["leistungsschluessel"]) ?? "";
  }
  let profile: JsonObject;
  try {
    profile = await client.serviceProfiles.get(key);
  } catch (err) {
    if (isNotFound(err)) return { status: "empty", searched, reason: `The portal has no service with the key ${key}. Search by name, or check the key (14 digits, from a search).` };
    throw err;
  }
  const textPage = await client.serviceTexts.search({ leistungsschluessel: key, limit: 200 });
  const found = new Map<string, ServiceTextRef & { kurztext: string | null; volltext: string | null }>();
  for (const t of textPage.items) {
    found.set(`${t.redaktion_id}/${t.leistung_id}`, {
      redaktionId: t.redaktion_id,
      leistungId: t.leistung_id,
      source: t.source,
      title: t.title?.trim() ?? null,
      level: levelOf(t.redaktion_id),
      statusLabel: freigabeStatusLabel(t.freigabe_status),
      kurztext: t.kurztext,
      volltext: t.volltext,
    });
  }
  // A text the profile lists that the search didn't return: listed, its source unknown.
  for (const ref of objects(profile["leistung_stammtexte"])) {
    const id = `${str(ref["redaktion_id"])}/${str(ref["id"])}`;
    if (found.has(id)) continue;
    found.set(id, { redaktionId: str(ref["redaktion_id"]) ?? "", leistungId: str(ref["id"]) ?? "", source: null, title: str(ref["title"])?.trim() ?? null, level: levelOf(str(ref["redaktion_id"]) ?? ""), statusLabel: "unset", kurztext: null, volltext: null });
  }
  const order = ["federal", "state", "portal", "other"];
  const all = [...found.values()].sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level) || a.redaktionId.localeCompare(b.redaktionId));
  const texts = all.map(({ kurztext: _k, volltext: _v, ...ref }) => ref);
  const byLevel = countBy(texts.map((t) => t.level));
  const federal = all.find((t) => t.redaktionId === "B100019") ?? all.find((t) => t.level === "federal");
  const summaryOf = (t: { kurztext: string | null; volltext: string | null }): string => {
    const short = plainText(t.kurztext);
    return short !== "" ? short : (cut(plainText(t.volltext), 800) ?? "");
  };
  const canonical = federal === undefined ? null : { redaktionId: federal.redaktionId, leistungId: federal.leistungId, source: federal.source, summary: summaryOf(federal) };
  const ozg = obj(profile["ozg"]);
  const status = num(profile["freigabe_status"]) ?? null;
  const sdg = strings(profile["sdg_informationsbereiche"]).filter((c) => !/^0+$/.test(c));
  const process = profile["prozessklasse"] ?? null;
  const replacements = arr(profile["replacements"]);
  const typeCode = str(profile["leistungstyp"]);
  const citizenName = str(profile["leistungsbezeichnung_2"])?.trim() ?? null;
  const notes: string[] = [];
  if (process === null) notes.push("No process class is linked (prozessklasse null), as for most services: say so, don't imply one.");
  else notes.push("A process class is linked: getElement with kind processClass and its id and version gives it.");
  if (sdg.length === 0) notes.push("No SDG information area (none or the placeholder 0000000).");
  if (replacements.length === 0) notes.push("No replacements: it neither supersedes nor is superseded.");
  notes.push("Statuses are mapped from the codes here: the portal sends no label for services and texts (unset: none given).");
  notes.push("To read one text in full: getServiceText with its redaktionId, leistungId and source from texts (never guess the source from the prefix).");
  if (texts.some((t) => t.source === null)) notes.push("Texts with source null are listed by the profile but not found by the text search: getServiceText can't fetch them without a source.");
  if (canonical !== null) notes.push("The summary is the federal text's short text, HTML dropped, not reworded.");
  const levels = Object.entries(byLevel).map(([level, n]) => `${n} ${level}`).join(", ");
  return {
    status: "ok",
    verdict: `${citizenName ?? str(profile["title"]) ?? key} (${key}): ${texts.length} editorial offices have a text${levels === "" ? "" : ` (${levels})`}; ${process === null ? "no process linked" : "a process class linked"}.`,
    service: {
      key,
      title: str(profile["title"])?.trim() ?? null,
      citizenName,
      for: strings(profile["leistungsadressat"]).map((code) => ({ code, label: ADDRESSEES[code] ?? code })),
      type: typeCode === undefined ? null : { code: typeCode, label: SERVICE_TYPES[typeCode] ?? typeCode },
      statusCode: status,
      statusLabel: freigabeStatusLabel(status),
      created: str(profile["erstellt_datum_zeit"]) ?? null,
      changed: str(profile["geaendert_datum_zeit"]) ?? null,
      ozg: ozg === undefined ? null : { id: str(ozg["id"]) ?? null, leistung: str(ozg["leistung"]) ?? null, themenfeld: str(ozg["themenfeld_label"]) ?? null },
      sdg,
      legalBases: linesOf(str(profile["rechtsgrundlagen"]), 25),
      process,
      replacements,
    },
    texts,
    byLevel,
    canonical,
    notes,
  };
}

// ---- searchCatalogue (generic) -------------------------------------------------------------

/** What searchCatalogue searches. */
export const CATALOGUE_RESOURCES = ["schemas", "fields", "groups", "documentProfiles", "serviceProfiles", "serviceTexts", "processClasses", "processes"] as const;
export type CatalogueResource = (typeof CATALOGUE_RESOURCES)[number];

/** The input of {@link searchCatalogue}. */
export interface CatalogueSearchInput {
  resource: CatalogueResource;
  /** Full-text search. */
  query?: string | undefined;
  /** A part of the name (schemas, fields, groups, document profiles) or title (services, texts). */
  name?: string | undefined;
  /** Freigabestatus codes 1–8 (not for service texts). */
  status?: number[] | undefined;
  /**
   * One row per element, its newest version (default true; schemas, fields, groups, document
   * profiles, process classes). The portal can't narrow processes, service profiles or texts so:
   * the answer's notes say so.
   */
  latestOnly?: boolean | undefined;
  /** A Leistungsschlüssel (service profiles and texts). */
  leistungsschluessel?: string | undefined;
  offset?: number | undefined;
  /** 1–50, default 20. */
  limit?: number | undefined;
}

/** The answer of {@link searchCatalogue}. */
export type CatalogueSearch =
  | { status: "ok"; resource: CatalogueResource; total: number; offset: number; items: JsonObject[]; nextOffset?: number; notes: string[] }
  | { status: "empty"; resource: CatalogueResource; searched: Record<string, unknown>; total: number; reason: string };

const HAS_LATEST: readonly CatalogueResource[] = ["schemas", "fields", "groups", "documentProfiles", "processClasses"];
const HAS_NAME: readonly CatalogueResource[] = ["schemas", "fields", "groups", "documentProfiles", "serviceProfiles", "serviceTexts"];

/** The query searchCatalogue sends for `input`; a filter the resource doesn't take is refused. */
export function catalogueQuery(input: CatalogueSearchInput): Record<string, string | number | boolean | (string | number)[] | undefined> {
  const resource = assertValid("resource", input.resource, oneOfProblem(CATALOGUE_RESOURCES));
  const query = optionalText("query", input.query);
  const name = optionalText("name", input.name);
  const key = optionalText("leistungsschluessel", input.leistungsschluessel);
  if (name !== undefined && !HAS_NAME.includes(resource)) throw new FimValidationError(`Invalid name: ${resource} have no name filter; use query.`);
  if (key !== undefined && resource !== "serviceProfiles" && resource !== "serviceTexts") throw new FimValidationError(`Invalid leistungsschluessel: only serviceProfiles and serviceTexts take it.`);
  if (input.status !== undefined && resource === "serviceTexts") throw new FimValidationError("Invalid status: service texts have no status filter.");
  const latest = input.latestOnly ?? true;
  const nameKey = resource === "serviceProfiles" || resource === "serviceTexts" ? "title" : "name";
  return {
    fts_query: query,
    [nameKey]: name,
    leistungsschluessel: key,
    freigabe_status: input.status === undefined ? undefined : [...new Set(input.status)],
    is_latest: HAS_LATEST.includes(resource) && latest ? true : undefined,
    offset: bounded("offset", input.offset, 0, 0, 100_000),
    limit: bounded("limit", input.limit, 20, 1, 50),
  };
}

/** A search row cut to what identifies it and what a model needs to pick it. */
function rowOf(resource: CatalogueResource, row: JsonObject): JsonObject {
  const pickDefined = (o: Record<string, JsonValue | undefined>): JsonObject =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as JsonObject;
  const status = str(row["freigabe_status_label"]) ?? freigabeStatusLabel(row["freigabe_status"]);
  const match = cut(str(row["fts_match"]), 200);
  switch (resource) {
    case "schemas":
    case "documentProfiles":
    case "fields":
    case "groups":
      return pickDefined({
        namespace: resource === "fields" || resource === "groups" ? str(row["namespace"]) : undefined,
        fimId: str(row["fim_id"]),
        version: str(row["fim_version"]),
        name: str(row["name"])?.trim(),
        title: resource === "schemas" || resource === "documentProfiles" ? (str(row["bezeichnung"])?.trim() ?? null) : undefined,
        feldart: str(row["feldart"]),
        datentyp: str(row["datentyp"]),
        codeListId: resource === "fields" ? (num(row["code_list_id"]) ?? null) : undefined,
        dokumentart: str(row["dokumentart"]),
        statusLabel: status,
        nummernkreis: str(row["nummernkreis"]),
        xdfVersion: str(row["xdf_version"]),
        steckbriefId: resource === "schemas" ? (str(row["steckbrief_id"]) ?? null) : undefined,
        isLatest: typeof row["is_latest"] === "boolean" ? row["is_latest"] : undefined,
        match,
      });
    case "serviceProfiles":
      return pickDefined({
        key: str(row["leistungsschluessel"]),
        title: str(row["title"])?.trim(),
        citizenName: str(row["leistungsbezeichnung_2"])?.trim() ?? null,
        statusLabel: status,
        themenfeld: str(obj(row["ozg"])?.["themenfeld_label"]) ?? null,
        changed: str(row["geaendert_datum_zeit"]) ?? null,
        match,
      });
    case "serviceTexts":
      return pickDefined({
        redaktionId: str(row["redaktion_id"]),
        leistungId: str(row["leistung_id"]),
        source: str(row["source"]),
        title: str(row["title"])?.trim(),
        keys: strings(row["leistungsschluessel"]),
        statusLabel: status,
        changed: str(row["geaendert_datum_zeit"]) ?? null,
        match,
      });
    case "processClasses":
    case "processes":
      return pickDefined({
        id: str(row["id"]),
        version: str(row["version"]),
        detaillierungsstufe: str(row["detaillierungsstufe"]),
        kodierung: str(row["verwaltungspolitische_kodierung"]),
        name: str(row["name"])?.trim(),
        statusLabel: status,
        changed: str(row["letzter_aenderungszeitpunkt"]) ?? null,
        isLatest: typeof row["is_latest"] === "boolean" ? row["is_latest"] : undefined,
        match,
      });
  }
}

/**
 * One page of a catalogue search: schemas, fields, groups, document profiles, service profiles,
 * service texts, process classes or processes, newest version only by default, each row cut to
 * its ids and what tells it apart. One request.
 */
export async function searchCatalogue(client: FimPortalClient, input: CatalogueSearchInput): Promise<CatalogueSearch> {
  const query = catalogueQuery(input);
  const params = query as never;
  const resource = input.resource;
  const page: JsonObject = await (async () => {
    switch (resource) {
      case "schemas":
        return (await client.schemas.search(params)) as unknown as JsonObject;
      case "fields":
        return (await client.fields.search(params)) as unknown as JsonObject;
      case "groups":
        return (await client.groups.search(params)) as unknown as JsonObject;
      case "documentProfiles":
        return (await client.documentProfiles.search(params)) as unknown as JsonObject;
      case "serviceProfiles":
        return client.serviceProfiles.search(params);
      case "serviceTexts":
        return (await client.serviceTexts.search(params)) as unknown as JsonObject;
      case "processClasses":
        return client.processClasses.search(params);
      case "processes":
        return client.processes.search(params);
    }
  })();
  const items = objects(page["items"]);
  const total = num(page["total_count"]) ?? items.length;
  const offset = query["offset"] as number;
  const searched = Object.fromEntries(Object.entries({ query: query["fts_query"], name: input.name, status: input.status, leistungsschluessel: query["leistungsschluessel"], offset: offset === 0 ? undefined : offset }).filter(([, v]) => v !== undefined));
  if (items.length === 0) {
    const reason = total > 0 ? `The search has ${total} hits; offset ${offset} is past them.` : `No ${resource} match. Try another word (the catalogue is German), fewer filters, or query instead of name.`;
    // total stays the number of hits (past the last page, there are some): the reason says so too.
    return { status: "empty", resource, searched, total, reason };
  }
  const notes: string[] = [];
  if (query["is_latest"] !== true && HAS_LATEST.includes(resource)) notes.push("Every version is listed (latestOnly false): an element appears once per version.");
  // The portal has no newest-version filter for these: latestOnly can't narrow them.
  if (resource === "processes") notes.push("Processes are listed in every version (the portal has no newest-only filter for them): an id can appear more than once, version tells them apart.");
  else if (!HAS_LATEST.includes(resource) && input.latestOnly !== undefined) notes.push(`latestOnly does nothing for ${resource}: the portal has no version filter for them.`);
  if (query["fts_query"] !== undefined && (resource === "schemas" || resource === "fields" || resource === "groups")) notes.push("The full-text search also matches text inside an element: check name and title, not only that it was found.");
  if (resource === "fields" || resource === "groups") notes.push("Fetch one with getElement: it needs the namespace and the fimId.");
  const next = offset + items.length;
  return { status: "ok", resource, total, offset, items: items.map((row) => rowOf(resource, row)), ...(next < total ? { nextOffset: next } : {}), notes };
}

// ---- getElement (generic) ----------------------------------------------------------------------

/** What getElement fetches. */
export const ELEMENT_KINDS = ["schema", "documentProfile", "field", "group", "processClass"] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

/** The input of {@link getElement}. */
export interface ElementInput {
  kind: ElementKind;
  id: string;
  /** A version (default latest; a process class needs one). */
  version?: string | undefined;
  /** Fields and groups: their namespace, from a search (default baukasten). */
  namespace?: string | undefined;
  /** List the element's versions instead (not for process classes). */
  versions?: boolean | undefined;
}

/** The answer of {@link getElement}. */
export type Element =
  | { status: "ok"; kind: ElementKind; element: JsonObject; notes: string[] }
  | { status: "ok"; kind: ElementKind; id: string; versions: JsonObject[]; notes: string[] }
  | { status: "empty"; searched: Record<string, unknown>; reason: string };

/** How many schemas that use an element are listed. */
const USED_IN = 25;

function usedIn(schemas: JsonObject[]): JsonObject {
  const ids = new Set(schemas.map((s) => str(s["fim_id"])));
  return {
    schemaVersions: schemas.length,
    schemas: ids.size,
    latest: schemas.filter((s) => s["is_latest"] === true).length,
    first: schemas.slice(0, USED_IN).map((s) => ({ fimId: str(s["fim_id"]) ?? "", version: str(s["fim_version"]) ?? "", name: str(s["name"])?.trim() ?? null, statusLabel: freigabeStatusLabel(s["freigabe_status"]) })),
  };
}

/** The fields every XDatenfelder element shares. */
function elementFacts(e: JsonObject): JsonObject {
  return {
    fimId: str(e["fim_id"]) ?? "",
    version: str(e["fim_version"]) ?? "",
    ...(str(e["namespace"]) === undefined ? {} : { namespace: str(e["namespace"]) as string }),
    name: str(e["name"])?.trim() ?? null,
    title: str(e["bezeichnung"])?.trim() ?? null,
    definition: cut(str(e["definition"]), 800) ?? null,
    description: cut(str(e["beschreibung"]), 800) ?? null,
    statusLabel: str(e["freigabe_status_label"]) ?? freigabeStatusLabel(e["freigabe_status"]),
    statusSetBy: str(e["status_gesetzt_durch"]) ?? null,
    xdfVersion: str(e["xdf_version"]) ?? null,
    nummernkreis: str(e["nummernkreis"]) ?? null,
    isLatest: e["is_latest"] === true,
    changed: str(e["letzte_aenderung"]) ?? null,
    versionNote: cut(str(e["versionshinweis"]), 300) ?? null,
    bezug: strings(e["bezug"]).map((b) => cut(b, 300) ?? "").filter((b) => b !== "").slice(0, 8),
  };
}

/**
 * One XDatenfelder element (a schema, document profile, field or group) or a process class, cut
 * to what tells it apart: a field with its code list (the full answer has `code_list_id: null`
 * and the list as an object) and how many schemas use it (a widely used field's answer runs past
 * 1 MB: only the count and the first 25 are kept); a group with its direct children named; a
 * document profile with its schemas; a process class with its processes. Or, with `versions`,
 * the element's versions. The portal's 404 is `empty`, with what to check. One request.
 */
export async function getElement(client: FimPortalClient, input: ElementInput): Promise<Element> {
  const kind = assertValid("kind", input.kind, oneOfProblem(ELEMENT_KINDS));
  const given = normalizeText(assertValid("id", input.id, textProblem));
  // The portal's ids are upper case and it matches them case-sensitively (s05000039 is a 404):
  // an XDatenfelder id typed in lower case is the element's, as for the use-case functions.
  const id = kind !== "processClass" && ELEMENT_ID.test(given) ? given.toUpperCase() : given;
  const version = versionOf(input.version);
  const namespace = optionalText("namespace", input.namespace) ?? "baukasten";
  if (kind === "processClass" && input.version === undefined) throw new FimValidationError("Invalid version: a process class needs its version (from a search, e.g. 01.01.00).");
  if (kind === "processClass" && input.versions === true) throw new FimValidationError("Invalid versions: the portal lists no versions of a process class; search processClasses with latestOnly false.");
  const searched = { kind, id, version, ...(kind === "field" || kind === "group" ? { namespace } : {}) };
  try {
    if (input.versions === true) {
      const list =
        kind === "schema" ? await client.schemas.versions(id)
        : kind === "documentProfile" ? await client.documentProfiles.versions(id)
        : kind === "field" ? await client.fields.versions(namespace, id)
        : await client.groups.versions(namespace, id);
      const versions = (list as unknown as JsonObject[]).map((v) => ({
        version: str(v["fim_version"]) ?? "",
        statusLabel: str(v["freigabe_status_label"]) ?? freigabeStatusLabel(v["freigabe_status"]),
        isLatest: v["is_latest"] === true,
        xdfVersion: str(v["xdf_version"]) ?? null,
        changed: str(v["letzte_aenderung"]) ?? null,
      }));
      if (versions.length === 0) return { status: "empty", searched, reason: `The portal lists no versions of ${id}.` };
      return { status: "ok", kind, id, versions, notes: ["Oldest first, as the portal lists them; isLatest marks the newest."] };
    }
    switch (kind) {
      case "field": {
        const e = await client.fields.get(namespace, id, version);
        const list = obj(e["code_list"]);
        return {
          status: "ok",
          kind,
          element: {
            ...elementFacts(e),
            feldart: str(e["feldart"]) ?? null,
            datentyp: str(e["datentyp"]) ?? null,
            codeList: list === undefined ? null : { id: num(list["id"]) ?? null, name: str(list["name"]) ?? null, version: str(list["version"]) ?? null, url: str(list["url"]) ?? null, uri: str(list["genericode_canonical_uri"]) ?? null },
            rules: arr(e["regeln"]).length,
            usedIn: usedIn(objects(e["schemas"])),
          },
          notes: ["usedIn counts the schema versions that use this field: a reuse signal.", ...(list === undefined && str(e["feldart"]) === "select" ? ["A select field without a code list: its values are not given here."] : [])],
        };
      }
      case "group": {
        const e = await client.groups.get(namespace, id, version);
        const fieldEntries = objects(e["datenfelder"]);
        const groupEntries = objects(e["datenfeldgruppen"]);
        const fields = catalogueOf(fieldEntries);
        const groups = catalogueOf(groupEntries);
        const describe = (c: JsonObject, group: boolean): JsonObject => {
          const entry = lookup(group ? groups : fields, str(c["fim_id"]) ?? "", str(c["fim_version"]));
          return { type: group ? "group" : "field", id: str(c["fim_id"]) ?? "", version: str(c["fim_version"]) ?? null, name: str(entry?.["name"])?.trim() ?? null, cardinality: str(c["anzahl"]) ?? null, ...(group ? {} : { feldart: str(entry?.["feldart"]) ?? null, datentyp: str(entry?.["datentyp"]) ?? null }) };
        };
        let children = objects(e["children"]).map((c) => describe(c, str(c["type"]) === "Gruppe"));
        const notes: string[] = [];
        let derived = false;
        if (children.length === 0 && fieldEntries.length + groupEntries.length > 0) {
          // The portal leaves a group's own children empty (seen 2026-11-19 with XDF2 and XDF3
          // groups) but lists everything inside it: its direct members are those no member contains.
          const inner = new Set(groupEntries.flatMap((g) => objects(g["children"]).map((c) => str(c["fim_id"]))));
          children = [
            ...groupEntries.filter((g) => !inner.has(str(g["fim_id"]))).map((g) => describe(g, true)),
            ...fieldEntries.filter((f) => !inner.has(str(f["fim_id"]))).map((f) => describe(f, false)),
          ];
          derived = true;
          notes.push(`The portal gives no direct children for this group, only the ${fieldEntries.length} fields and ${groupEntries.length} groups inside it: children are the ones no group inside contains, groups first; their order and cardinality are not given. getSchemaBlueprint of a schema that uses it (usedIn) shows them in order.`);
        }
        const catalogue = { fields: fieldEntries.length, groups: groupEntries.length };
        return { status: "ok", kind, element: { ...elementFacts(e), children, ...(derived ? { childrenDerived: true } : {}), inside: catalogue, rules: arr(e["regeln"]).length, usedIn: usedIn(objects(e["schemas"])) }, notes };
      }
      case "schema": {
        const e = await client.schemas.get(id, version);
        const steckbriefId = str(e["steckbrief_id"]);
        return {
          status: "ok",
          kind,
          element: {
            ...elementFacts(e),
            steckbrief: steckbriefId === undefined ? null : { id: steckbriefId, name: str(e["steckbrief_name"]) ?? null },
            topLevel: arr(e["children"]).length,
            fields: arr(e["datenfelder"]).length,
            groups: arr(e["datenfeldgruppen"]).length,
            rules: objects(e["regeln"]).map((r) => `${str(r["fim_id"]) ?? "?"} v${str(r["fim_version"]) ?? "?"}`).slice(0, 50),
          },
          notes: ["getSchemaBlueprint gives the form's structure; auditSchemaQuality its quality report."],
        };
      }
      case "documentProfile": {
        const e = await client.documentProfiles.get(id, version);
        return {
          status: "ok",
          kind,
          element: {
            ...elementFacts(e),
            dokumentart: str(e["dokumentart"]) ?? null,
            abstract: e["ist_abstrakt"] === true,
            helpText: cut(str(e["hilfetext"]), 800) ?? null,
            schemas: objects(e["datenschemata"]).map((s) => ({ fimId: str(s["fim_id"]) ?? "", version: str(s["fim_version"]) ?? "", name: str(s["name"])?.trim() ?? null, statusLabel: freigabeStatusLabel(s["freigabe_status"]) })),
            processes: arr(e["prozesse"]).length,
          },
          notes: ["schemas are the data schemas that implement this document profile, each with its own status."],
        };
      }
      case "processClass": {
        const e = await client.processClasses.get(id, version);
        const service = obj(e["leistungssteckbrief"]);
        return {
          status: "ok",
          kind,
          element: {
            id: str(e["id"]) ?? id,
            version: str(e["version"]) ?? version,
            name: str(e["name"])?.trim() ?? null,
            statusLabel: freigabeStatusLabel(e["freigabe_status"]),
            changed: str(e["letzter_aenderungszeitpunkt"]) ?? null,
            service: service === undefined ? null : { key: str(service["leistungsschluessel"]) ?? null, name: str(service["name"]) ?? null },
            processes: objects(e["prozesse"]).map((p) => ({ id: str(p["id"]) ?? "", version: str(p["version"]) ?? "", detaillierungsstufe: str(p["detaillierungsstufe"]) ?? null, kodierung: str(p["verwaltungspolitische_kodierung"]) ?? null, name: str(p["name"])?.trim() ?? null, statusLabel: freigabeStatusLabel(p["freigabe_status"]) })),
          },
          notes: ["Statuses are mapped from the codes here (the portal sends none for processes)."],
        };
      }
    }
  } catch (err) {
    if (isNotFound(err)) {
      const hint = kind === "field" || kind === "group" ? ` Fields and groups need the namespace from the search (${namespace} was used).` : "";
      return { status: "empty", searched, reason: `The portal has no ${kind} ${id}${input.versions === true ? "" : ` in version ${version}`}.${hint} Take ids and versions from searchCatalogue; they change as the catalogue is updated.` };
    }
    throw err;
  }
}

// ---- getServiceText (generic) ------------------------------------------------------------------

/** The input of {@link getServiceText}. */
export interface ServiceTextInput {
  redaktionId: string;
  leistungId: string;
  /** leika, landesredaktion or pvog, from getServiceDossier's texts; else looked up by the key. */
  source?: XzufiSource | undefined;
  /** The service's key, to look the source up when it isn't given. */
  leistungsschluessel?: string | undefined;
}

/** The answer of {@link getServiceText}. */
export type ServiceText =
  | {
      status: "ok";
      redaktionId: string;
      leistungId: string;
      source: string;
      sourceLookedUp: boolean;
      title: string | null;
      citizenName: string | null;
      statusLabel: string;
      changed: string | null;
      summary: string;
      paragraphs: string[];
      legalBases: string[];
      notes: string[];
    }
  | { status: "empty"; searched: Record<string, unknown>; reason: string };

/**
 * One editorial office's master text of a service, as plain text (HTML dropped, nothing
 * reworded): the short text, the full text as paragraphs, the legal bases. The path needs the
 * text's source, which the Redaktion's prefix doesn't tell (the federal B100019 text is under
 * leika for one service and pvog for another): without it, the text search by the key looks it
 * up (one more request).
 */
export async function getServiceText(client: FimPortalClient, input: ServiceTextInput): Promise<ServiceText> {
  const redaktionId = normalizeText(assertValid("redaktionId", input.redaktionId, textProblem));
  const leistungId = normalizeText(assertValid("leistungId", input.leistungId, textProblem));
  const key = optionalText("leistungsschluessel", input.leistungsschluessel);
  let source = input.source;
  if (source !== undefined) assertValid("source", source, oneOfProblem(XzufiSourceValues));
  const searched = { redaktionId, leistungId, ...(source === undefined ? {} : { source }), ...(key === undefined ? {} : { leistungsschluessel: key }) };
  let lookedUp = false;
  if (source === undefined) {
    if (key === undefined) throw new FimValidationError("Invalid source: give the source (leika, landesredaktion or pvog, from getServiceDossier's texts) or the leistungsschluessel to look it up; it can't be told from the redaktionId.");
    const page = await client.serviceTexts.search({ leistungsschluessel: key, redaktion_id: redaktionId, limit: 200 });
    const hit = page.items.find((t) => t.leistung_id === leistungId);
    if (hit === undefined) {
      return { status: "empty", searched, reason: `The text search for ${key} lists no text ${redaktionId}/${leistungId}. Take the ids from getServiceDossier's texts.` };
    }
    source = hit.source;
    lookedUp = true;
  }
  let text: JsonObject;
  try {
    text = await client.serviceTexts.get(redaktionId, leistungId, source);
  } catch (err) {
    if (isNotFound(err)) {
      return { status: "empty", searched: { ...searched, source }, reason: `The portal has no text ${redaktionId}/${leistungId} under source ${source}. The source must be the one the text search lists (getServiceDossier's texts); a wrong one is not found.` };
    }
    throw err;
  }
  const full = paragraphsOf(str(text["volltext"]));
  return {
    status: "ok",
    redaktionId,
    leistungId,
    source,
    sourceLookedUp: lookedUp,
    title: str(text["title"])?.trim() ?? null,
    citizenName: str(text["leistungsbezeichnung_2"])?.trim() ?? null,
    statusLabel: freigabeStatusLabel(text["freigabe_status"]),
    changed: str(text["geaendert_datum_zeit"]) ?? null,
    summary: plainText(str(text["kurztext"])),
    paragraphs: full,
    legalBases: linesOf(str(text["rechtsgrundlagen"]), 30),
    notes: ["The text is the editorial office's, in German, HTML dropped and nothing reworded: quote it as theirs."],
  };
}
