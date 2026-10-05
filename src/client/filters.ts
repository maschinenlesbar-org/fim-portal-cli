// The query parameters each search, list and CSV endpoint accepts, from openapi.json, and
// the check that holds a call to them.
//
// The FIM Portal ignores a query parameter it does not know: `schemas.search({ fts_querry:
// "x" })`, or the pre-0.1.0 spelling `versionshinweis`, answers with the whole catalogue
// (1890 schemas instead of 0) and HTTP 200. The CSV export goes further and also ignores a
// filter that doesn't apply to the chosen resource, or a value it doesn't know: `feldart:
// "SELECT"` or `detaillierungsstufe: "999"` export the unfiltered result. So every call
// checks its parameters against these tables before the request (assertParams), and a
// key, type or value the table doesn't allow is a FimValidationError. A parameter the
// portal adds after this table was written can still be sent with
// `{ allowUnknownFilters: true }` as the call's second argument.

import { FimValidationError } from "./errors.js";
import { assertValid, oneOfProblem, type Problem } from "./validate.js";
import {
  AnwendungsgebietValues,
  BehoerdeValues,
  DatenfelderSearchOrderValues,
  DatentypValues,
  DetaillierungsstufeValues,
  DokumentartValues,
  FeldartValues,
  FeldSucheInValues,
  FreigabeStatusValues,
  GruppeSucheInValues,
  HandlungsformValues,
  LeistungStammtextSearchOrderValues,
  LeistungSteckbriefSearchOrderValues,
  LeistungSucheInValues,
  OperativesZielValues,
  SchemaSucheInValues,
  SpracheValues,
  SteckbriefSucheInValues,
  VerfahrensartValues,
  XdfVersionValues,
  XzufiSourceValues,
} from "./enums.js";
import { SearchCsvResourceValues, type SearchCsvResource } from "./params.js";

/** Options of a search, list or CSV call. */
export interface FilterOptions {
  /**
   * Send parameters the tables in `filters.ts` don't know: a parameter the portal added
   * after they were written. Default `false`: an unknown key is rejected, because the
   * portal ignores it and answers with the unfiltered result. For
   * `tools.searchCsvDownload` it also lets through a filter for another resource and a
   * value outside the known domain, which the CSV export ignores in the same way.
   */
  allowUnknownFilters?: boolean;
}

/**
 * What one query parameter takes: a string, a date (an ISO string or a valid `Date`), an
 * integer, a boolean, or one of a fixed set of values; `list` when the API takes it more
 * than once (a repeated key, `?nummernkreis=01&nummernkreis=02`). A list parameter also
 * takes a single value.
 */
export type ParamKind =
  | { readonly type: "string" | "date" | "int" | "bool"; readonly list?: boolean }
  | { readonly type: "enum"; readonly values: readonly unknown[]; readonly list?: boolean };

/** The parameters of one endpoint, by name. */
export type ParamSpec = Readonly<Record<string, ParamKind>>;

const STRING: ParamKind = { type: "string" };
const STRINGS: ParamKind = { type: "string", list: true };
const DATE: ParamKind = { type: "date" };
const INT: ParamKind = { type: "int" };
const BOOL: ParamKind = { type: "bool" };
const oneOf = (values: readonly unknown[]): ParamKind => ({ type: "enum", values });
const someOf = (values: readonly unknown[]): ParamKind => ({ type: "enum", values, list: true });

const PAGE: ParamSpec = { offset: INT, limit: INT };

/** Filters shared by the four XDatenfelder v1 searches. */
const DATENFELDER: ParamSpec = {
  ...PAGE,
  name: STRING,
  nummernkreis: STRINGS,
  freigabe_status: someOf(FreigabeStatusValues),
  status_gesetzt_durch: STRING,
  status_gesetzt_seit: DATE,
  status_gesetzt_bis: DATE,
  bezug: STRING,
  Versionshinweis: STRING,
  updated_since: DATE,
  xdf_version: oneOf(XdfVersionValues),
  fts_query: STRING,
  is_latest: BOOL,
  order_by: oneOf(DatenfelderSearchOrderValues),
};

/** `schemas.search` — GET /api/v1/schemas. */
export const SCHEMA_SEARCH_PARAMS: ParamSpec = {
  ...DATENFELDER,
  gueltig_am: DATE,
  bezug_unterelemente: STRING,
  bezeichnung: STRING,
  stichwort: STRING,
  suche_nur_in: oneOf(SchemaSucheInValues),
};

/** `documentProfiles.search` — GET /api/v1/document-profiles (no `gueltig_am`). */
export const DOCUMENT_PROFILE_SEARCH_PARAMS: ParamSpec = {
  ...DATENFELDER,
  bezeichnung: STRING,
  dokumentart: oneOf(DokumentartValues),
  stichwort: STRING,
  suche_nur_in: oneOf(SteckbriefSucheInValues),
};

/** `fields.search` — GET /api/v1/fields. */
export const FIELD_SEARCH_PARAMS: ParamSpec = {
  ...DATENFELDER,
  gueltig_am: DATE,
  suche_nur_in: oneOf(FeldSucheInValues),
  feldart: oneOf(FeldartValues),
  datentyp: oneOf(DatentypValues),
};

/** `groups.search` — GET /api/v1/groups. */
export const GROUP_SEARCH_PARAMS: ParamSpec = {
  ...DATENFELDER,
  gueltig_am: DATE,
  suche_nur_in: oneOf(GruppeSucheInValues),
};

/**
 * Filters shared by the two XZuFi service searches. The value lists of `leistungstyp`,
 * `typisierung`, `leistungsadressat` and `ozg_themenfeld` are left to the API, which
 * answers an unknown one with a 422 naming the allowed values.
 */
const SERVICES: ParamSpec = {
  ...PAGE,
  leistungstyp: STRINGS,
  typisierung: STRINGS,
  fts_query: STRING,
  suche_nur_in: oneOf(LeistungSucheInValues),
  title: STRING,
  leistungsbezeichnung: STRING,
  leistungsbezeichnung2: STRING,
  leistungsschluessel: STRING,
  rechtsgrundlagen: STRING,
  einheitlicher_ansprechpartner: BOOL,
  updated_since: DATE,
  lagen_portalverbund: STRING,
  leistungsadressat: STRINGS,
  ozg_themenfeld: STRINGS,
  ozg_id: STRING,
  vollzugsbehoerde: oneOf(BehoerdeValues),
};

/** `serviceProfiles.search` — GET /api/v0/leistung-steckbriefe (`sdg`, like the lists above, is left to the API). */
export const SERVICE_PROFILE_SEARCH_PARAMS: ParamSpec = {
  ...SERVICES,
  freigabe_status: someOf(FreigabeStatusValues),
  sdg: STRINGS,
  sdg_relevant: BOOL,
  sprache: oneOf(SpracheValues),
  order_by: oneOf(LeistungSteckbriefSearchOrderValues),
};

/** `serviceTexts.search` — GET /api/v0/leistung-stammtexte. */
export const SERVICE_TEXT_SEARCH_PARAMS: ParamSpec = {
  ...SERVICES,
  redaktion_id: STRING,
  source: oneOf(XzufiSourceValues),
  order_by: oneOf(LeistungStammtextSearchOrderValues),
};

/** `organizationalUnits.list` and `onlineServices.list` — cursor pages with full-text search. */
export const XZUFI_FTS_LIST_PARAMS: ParamSpec = { cursor: INT, limit: INT, fts_query: STRING };

/** `specializations.list` — GET /api/v0/specialization takes no `fts_query` (it was ignored). */
export const XZUFI_LIST_PARAMS: ParamSpec = { cursor: INT, limit: INT };

/** `processClasses.search` — GET /api/v0/processclasses. */
export const PROCESS_CLASS_SEARCH_PARAMS: ParamSpec = {
  ...PAGE,
  fts_query: STRING,
  freigabe_status: someOf(FreigabeStatusValues),
  operatives_ziel: oneOf(OperativesZielValues),
  verfahrensart: oneOf(VerfahrensartValues),
  handlungsform: oneOf(HandlungsformValues),
  is_latest: BOOL,
};

/** `processes.search` — GET /api/v0/processes. */
export const PROCESS_SEARCH_PARAMS: ParamSpec = {
  ...PAGE,
  freigabe_status: someOf(FreigabeStatusValues),
  detaillierungsstufe: oneOf(DetaillierungsstufeValues),
  anwendungsgebiet: oneOf(AnwendungsgebietValues),
  is_musterprozess: BOOL,
  fts_query: STRING,
};

/** `codeLists.list` — GET /api/v0/code-lists. */
export const CODE_LIST_PARAMS: ParamSpec = PAGE;

const DATENFELDER_RESOURCES = ["schema", "document-profile", "field", "group"] as const;
const SERVICE_RESOURCES = ["leistung-steckbriefe"] as const;

/**
 * A `tools.searchCsvDownload` filter: what it takes and the resources it applies to
 * (`undefined`: every resource). The spec types every parameter as a free string; the
 * value domains are those of the matching JSON search, and the resources follow the
 * parameter's prefix or the JSON search that has it (`feldart` only on fields).
 */
export interface CsvFilter {
  readonly values?: readonly string[];
  readonly resources?: readonly SearchCsvResource[];
}

/**
 * The parameters of GET /tools/search-csv-download besides `resource`. `order_by` takes
 * the sort orders of the resource's JSON search (CSV_ORDER_VALUES); `abstraktionsstufe`,
 * `leistung_quelle`, `leistung_redaktion_id`, `leistung_einheitlicher_ansprechpartner`
 * and `sdg_relevant` have no documented domain and pass as non-blank strings.
 */
export const SEARCH_CSV_FILTERS: Readonly<Record<string, CsvFilter>> = {
  term: {},
  order_by: {},
  abstraktionsstufe: {},
  xdf_version: { values: XdfVersionValues, resources: DATENFELDER_RESOURCES },
  schema_suche_in: { values: SchemaSucheInValues, resources: ["schema"] },
  steckbrief_suche_in: { values: SteckbriefSucheInValues, resources: ["document-profile"] },
  dokumentart: { values: DokumentartValues, resources: ["document-profile"] },
  gruppe_suche_in: { values: GruppeSucheInValues, resources: ["group"] },
  feld_suche_in: { values: FeldSucheInValues, resources: ["field"] },
  feldart: { values: FeldartValues, resources: ["field"] },
  datentyp: { values: DatentypValues, resources: ["field"] },
  leistung_redaktion_id: { resources: SERVICE_RESOURCES },
  leistung_einheitlicher_ansprechpartner: { resources: SERVICE_RESOURCES },
  leistung_suche_in: { values: LeistungSucheInValues, resources: SERVICE_RESOURCES },
  leistung_geaendert_seit: { resources: SERVICE_RESOURCES },
  leistung_quelle: { resources: SERVICE_RESOURCES },
  sdg_relevant: { resources: SERVICE_RESOURCES },
  vollzugsbehoerde: { values: BehoerdeValues, resources: SERVICE_RESOURCES },
  sprache: { values: SpracheValues, resources: SERVICE_RESOURCES },
  operatives_ziel: { values: OperativesZielValues, resources: ["processclass"] },
  verfahrensart: { values: VerfahrensartValues, resources: ["processclass"] },
  handlungsform: { values: HandlungsformValues, resources: ["processclass"] },
  detaillierungsstufe: { values: DetaillierungsstufeValues, resources: ["process"] },
  anwendungsgebiet: { values: AnwendungsgebietValues, resources: ["process"] },
};

/** The `order_by` values of the CSV export per resource, where its JSON search documents them. */
export const CSV_ORDER_VALUES: Readonly<Partial<Record<SearchCsvResource, readonly string[]>>> = {
  schema: DatenfelderSearchOrderValues,
  "document-profile": DatenfelderSearchOrderValues,
  field: DatenfelderSearchOrderValues,
  group: DatenfelderSearchOrderValues,
  "leistung-steckbriefe": LeistungSteckbriefSearchOrderValues,
};

/** Why `value` is not what `kind` takes, or undefined. `undefined`/`null` never get here. */
function kindProblem(kind: ParamKind): Problem<unknown> {
  const one: Problem<unknown> = (value) => {
    switch (kind.type) {
      case "string":
        return typeof value === "string" ? undefined : "Expected a string.";
      case "date":
        if (typeof value === "string") return undefined;
        return value instanceof Date ? undefined : "Expected a date string or a Date.";
      case "int":
        return typeof value === "number" && Number.isSafeInteger(value) ? undefined : "Expected an integer.";
      case "bool":
        return typeof value === "boolean" ? undefined : "Expected true or false.";
      case "enum":
        return oneOfProblem(kind.values)(value);
    }
  };
  if (!kind.list) {
    return (value) => (Array.isArray(value) ? "Expected a single value, not a list: the API reads only one." : one(value));
  }
  return (value) => {
    if (!Array.isArray(value)) return one(value);
    for (const element of value) {
      const reason = one(element);
      if (reason !== undefined) return reason;
    }
    return undefined;
  };
}

/** A value of a parameter the tables don't know, sent with allowUnknownFilters: a scalar or a list of them. */
const anyScalarProblem: Problem<unknown> = (value) => {
  const scalar = (v: unknown): boolean =>
    typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || v instanceof Date;
  if (Array.isArray(value) ? value.every(scalar) : scalar(value)) return undefined;
  return "Expected a string, number, boolean or Date, or a list of them.";
};

/** Edit distance of two short strings (for "did you mean"). */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length]!;
}

/** The known name `key` most likely means (`ftsQuery`, `fts_querry`, `versionshinweis`), if any. */
function suggest(key: string, known: readonly string[]): string | undefined {
  const norm = (s: string): string => s.toLowerCase().replace(/[_-]/g, "");
  const exact = known.find((k) => norm(k) === norm(key));
  if (exact !== undefined) return exact;
  let best: string | undefined;
  let bestDistance = 3;
  for (const k of known) {
    const d = distance(norm(key), norm(k));
    if (d < bestDistance) [best, bestDistance] = [k, d];
  }
  return best;
}

/** A parameter name as an error message shows it: quoted and escaped, cut at 100 characters. */
function quoteKey(key: string): string {
  return JSON.stringify(key.length > 100 ? `${key.slice(0, 100)}…` : key);
}

/** The parameters as a record, or a FimValidationError for anything but an object (a bare string, a list). */
function paramRecord(params: unknown, call: string): Record<string, unknown> {
  if (params === undefined || params === null) return {};
  if (typeof params !== "object" || Array.isArray(params)) {
    throw new FimValidationError(
      `Invalid parameters of ${call}: Expected an object of query parameters, got ${Array.isArray(params) ? "an array" : `a ${typeof params}`}.`,
    );
  }
  return params as Record<string, unknown>;
}

/** The FimValidationError for a key `known` doesn't list. */
function unknownKey(key: string, call: string, known: readonly string[]): FimValidationError {
  const hint = suggest(key, known);
  return new FimValidationError(
    `Invalid parameter ${quoteKey(key)}: ${call} has no such parameter` +
      (hint === undefined ? "" : ` (did you mean ${hint}?)`) +
      "; the portal would ignore it and answer with the unfiltered result. " +
      "Pass { allowUnknownFilters: true } to send it anyway.",
  );
}

/**
 * Check the parameters of a search or list call against its table (`spec`): the call
 * takes an object; every key with a value must be one of the table's (own keys only, so
 * `__proto__` and `constructor` are unknown too) unless `options.allowUnknownFilters`;
 * and every value must be what its parameter takes — a string, a date, an integer, a
 * boolean, one of the listed values, and a list only where the API takes one (a second
 * value of a single-value parameter would be dropped by the server). `undefined` and
 * `null` mean omitted. Throws FimValidationError (`Invalid <key>: <reason>`) before any
 * request. Blank values are refused separately (assertNonBlankParams, in the engine).
 */
export function assertParams(params: unknown, spec: ParamSpec, call: string, options: FilterOptions = {}): void {
  const record = paramRecord(params, call);
  const known = Object.keys(spec);
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || value === null) continue;
    if (!Object.hasOwn(spec, key)) {
      if (options.allowUnknownFilters !== true) throw unknownKey(key, call, known);
      assertValid(key, value, anyScalarProblem);
      continue;
    }
    assertValid(key, value, kindProblem(spec[key]!));
  }
}

/**
 * Check the parameters of `tools.searchCsvDownload`, whose server ignores what it doesn't
 * know rather than rejecting it: `resource` is required and one of
 * SearchCsvResourceValues; every other key must be one of SEARCH_CSV_FILTERS, take a
 * non-list string, apply to the chosen resource and, where a domain is known, be one of its
 * values (`order_by` per resource, CSV_ORDER_VALUES). With `options.allowUnknownFilters`
 * only `resource` and the value types are checked.
 */
export function assertSearchCsvParams(params: unknown, options: FilterOptions = {}): SearchCsvResource {
  const call = "tools.searchCsvDownload";
  const record = paramRecord(params, call);
  const resource = assertValid("resource", record["resource"], oneOfProblem(SearchCsvResourceValues)) as SearchCsvResource;
  const known = ["resource", ...Object.keys(SEARCH_CSV_FILTERS)];
  for (const [key, value] of Object.entries(record)) {
    if (key === "resource" || value === undefined || value === null) continue;
    assertValid(key, value, kindProblem(STRING));
    if (options.allowUnknownFilters === true) continue;
    if (!Object.hasOwn(SEARCH_CSV_FILTERS, key)) throw unknownKey(key, call, known);
    const filter = SEARCH_CSV_FILTERS[key]!;
    if (filter.resources !== undefined && !filter.resources.includes(resource)) {
      throw new FimValidationError(
        `Invalid ${key}: it filters resource ${filter.resources.join(", ")} only, not ${resource}; ` +
          "the CSV export would ignore it and export the unfiltered result.",
      );
    }
    const values = key === "order_by" ? CSV_ORDER_VALUES[resource] : filter.values;
    if (values !== undefined) assertValid(key, value, oneOfProblem(values));
  }
  return resource;
}
