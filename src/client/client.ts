// FimPortalClient — a typed, use-case-tailored client over the open (no-auth)
// endpoints of the FIM Portal API. Authenticated endpoints (uploads, converters,
// quality-check tools, token introspection) are intentionally not implemented.
//
// The surface is grouped by resource so usage reads naturally, e.g.
//   client.schemas.search({ name: "Geburt" })
//   client.processes.downloadVisualization(id, version, stufe, kodierung)

import { RequestEngine, type EngineOptions, type RawResponse } from "./engine.js";
import type { QueryParams } from "./query.js";
import {
  assertEnumParams,
  assertValid,
  detaillierungsstufeProblem,
  pathSegment,
  searchCsvResourceProblem,
  xzufiSourceProblem,
  type EnumSpec,
} from "./validate.js";
import type {
  PaginatedResult,
  CursorPaginationResult,
  SchemaOut,
  SteckbriefOut,
  DatenfeldOut,
  DatenfeldgruppeOut,
  LeistungStammtextOut,
  FullSchemaOut,
  FullSteckbriefOut,
  FullDatenfeldOut,
  FullDatenfeldgruppeOut,
  QualityReport,
  FullLeistungStammtextOut,
  LeistungSteckbrief,
  OrganisationseinheitOut,
  SpezialisierungOut,
  OnlinedienstOut,
  ProcessClass,
  Process,
  CodeList,
  JsonObject,
} from "./types.js";
import type {
  SchemaSearchParams,
  DocumentProfileSearchParams,
  FieldSearchParams,
  GroupSearchParams,
  LeistungSteckbriefSearchParams,
  LeistungStammtextSearchParams,
  ProcessClassSearchParams,
  ProcessSearchParams,
  XzufiEntityListParams,
  Pagination,
  SearchCsvParams,
} from "./params.js";
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
  type Detaillierungsstufe,
  type XzufiSource,
} from "./enums.js";

const ACCEPT_XML = "application/xml";
const ACCEPT_PDF = "application/pdf";

// The enumerated query parameters of each search endpoint, checked with
// assertEnumParams before the request. These are the parameters the CLI offers as
// fixed choices; the remaining TypeScript-typed lists (leistungstyp, typisierung,
// sdg, leistungsadressat, ozg_themenfeld) are forwarded as given, as in the CLI.
const DATENFELDER_ENUMS = {
  freigabe_status: FreigabeStatusValues,
  xdf_version: XdfVersionValues,
  order_by: DatenfelderSearchOrderValues,
} as const satisfies EnumSpec;
const SCHEMA_SEARCH_ENUMS: EnumSpec = { ...DATENFELDER_ENUMS, suche_nur_in: SchemaSucheInValues };
const DOCUMENT_PROFILE_SEARCH_ENUMS: EnumSpec = {
  ...DATENFELDER_ENUMS,
  dokumentart: DokumentartValues,
  suche_nur_in: SteckbriefSucheInValues,
};
const FIELD_SEARCH_ENUMS: EnumSpec = {
  ...DATENFELDER_ENUMS,
  suche_nur_in: FeldSucheInValues,
  feldart: FeldartValues,
  datentyp: DatentypValues,
};
const GROUP_SEARCH_ENUMS: EnumSpec = { ...DATENFELDER_ENUMS, suche_nur_in: GruppeSucheInValues };
const SERVICE_PROFILE_SEARCH_ENUMS: EnumSpec = {
  freigabe_status: FreigabeStatusValues,
  suche_nur_in: LeistungSucheInValues,
  sprache: SpracheValues,
  vollzugsbehoerde: BehoerdeValues,
  order_by: LeistungSteckbriefSearchOrderValues,
};
const SERVICE_TEXT_SEARCH_ENUMS: EnumSpec = {
  vollzugsbehoerde: BehoerdeValues,
  source: XzufiSourceValues,
  suche_nur_in: LeistungSucheInValues,
  order_by: LeistungStammtextSearchOrderValues,
};
const PROCESS_CLASS_SEARCH_ENUMS: EnumSpec = {
  freigabe_status: FreigabeStatusValues,
  operatives_ziel: OperativesZielValues,
  verfahrensart: VerfahrensartValues,
  handlungsform: HandlungsformValues,
};
const PROCESS_SEARCH_ENUMS: EnumSpec = {
  freigabe_status: FreigabeStatusValues,
  detaillierungsstufe: DetaillierungsstufeValues,
  anwendungsgebiet: AnwendungsgebietValues,
};

/** The XZuFi `source` path segment of a service text, checked against XzufiSourceValues. */
function sourceSegment(source: XzufiSource): string {
  assertValid("source", source, xzufiSourceProblem);
  return pathSegment("source", source);
}

/** The `stufe` path segment of a process, checked against DetaillierungsstufeValues. */
function stufeSegment(stufe: Detaillierungsstufe): string {
  assertValid("stufe", stufe, detaillierungsstufeProblem);
  return pathSegment("stufe", stufe);
}

// Every path id goes through pathSegment(name, value): it rejects a blank id with
// FimValidationError (an empty segment would re-target the request to a collection
// or a versions list) and percent-encodes the rest. "." and ".." pass encoding
// unchanged; the engine rejects those (see RequestEngine.buildUrl).

/** Search/filter and retrieve XDatenfelder Datenschemata. */
class SchemasResource {
  constructor(private readonly e: RequestEngine) {}

  async search(params: SchemaSearchParams = {}): Promise<PaginatedResult<SchemaOut>> {
    assertEnumParams(params ?? {}, SCHEMA_SEARCH_ENUMS);
    return this.e.getJson("/api/v1/schemas", params as QueryParams);
  }

  /** All versions of a schema, ascending. */
  async versions(fimId: string): Promise<SchemaOut[]> {
    return this.e.getJson(`/api/v1/schemas/${pathSegment("fimId", fimId)}`);
  }

  /** A full schema. Pass version `"latest"` for the newest. */
  async get(fimId: string, fimVersion = "latest"): Promise<FullSchemaOut> {
    return this.e.getJson(`/api/v1/schemas/${pathSegment("fimId", fimId)}/${pathSegment("fimVersion", fimVersion)}`);
  }

  async downloadXdf(fimId: string, fimVersion = "latest"): Promise<RawResponse> {
    return this.e.getRaw(`/api/v1/schemas/${pathSegment("fimId", fimId)}/${pathSegment("fimVersion", fimVersion)}/xdf`, ACCEPT_XML);
  }

  async qualityReport(fimId: string, fimVersion = "latest"): Promise<QualityReport> {
    return this.e.getJson(`/api/v1/schemas/${pathSegment("fimId", fimId)}/${pathSegment("fimVersion", fimVersion)}/quality-report`);
  }
}

/** Search/filter and retrieve Dokumentsteckbriefe (document profiles). */
class DocumentProfilesResource {
  constructor(private readonly e: RequestEngine) {}

  async search(params: DocumentProfileSearchParams = {}): Promise<PaginatedResult<SteckbriefOut>> {
    assertEnumParams(params ?? {}, DOCUMENT_PROFILE_SEARCH_ENUMS);
    return this.e.getJson("/api/v1/document-profiles", params as QueryParams);
  }

  async versions(fimId: string): Promise<SteckbriefOut[]> {
    return this.e.getJson(`/api/v1/document-profiles/${pathSegment("fimId", fimId)}`);
  }

  async get(fimId: string, fimVersion = "latest"): Promise<FullSteckbriefOut> {
    return this.e.getJson(`/api/v1/document-profiles/${pathSegment("fimId", fimId)}/${pathSegment("fimVersion", fimVersion)}`);
  }

  async downloadXdf(fimId: string, fimVersion = "latest"): Promise<RawResponse> {
    return this.e.getRaw(
      `/api/v1/document-profiles/${pathSegment("fimId", fimId)}/${pathSegment("fimVersion", fimVersion)}/xdf`,
      ACCEPT_XML,
    );
  }
}

/** Search/filter and retrieve Datenfelder (data fields). */
class FieldsResource {
  constructor(private readonly e: RequestEngine) {}

  async search(params: FieldSearchParams = {}): Promise<PaginatedResult<DatenfeldOut>> {
    assertEnumParams(params ?? {}, FIELD_SEARCH_ENUMS);
    return this.e.getJson("/api/v1/fields", params as QueryParams);
  }

  async versions(namespace: string, fimId: string): Promise<DatenfeldOut[]> {
    return this.e.getJson(`/api/v1/fields/${pathSegment("namespace", namespace)}/${pathSegment("fimId", fimId)}`);
  }

  async get(namespace: string, fimId: string, fimVersion = "latest"): Promise<FullDatenfeldOut> {
    return this.e.getJson(`/api/v1/fields/${pathSegment("namespace", namespace)}/${pathSegment("fimId", fimId)}/${pathSegment("fimVersion", fimVersion)}`);
  }

  async downloadXdf(namespace: string, fimId: string, fimVersion = "latest"): Promise<RawResponse> {
    return this.e.getRaw(
      `/api/v1/fields/${pathSegment("namespace", namespace)}/${pathSegment("fimId", fimId)}/${pathSegment("fimVersion", fimVersion)}/xdf`,
      ACCEPT_XML,
    );
  }
}

/** Search/filter and retrieve Datenfeldgruppen (data groups). */
class GroupsResource {
  constructor(private readonly e: RequestEngine) {}

  async search(params: GroupSearchParams = {}): Promise<PaginatedResult<DatenfeldgruppeOut>> {
    assertEnumParams(params ?? {}, GROUP_SEARCH_ENUMS);
    return this.e.getJson("/api/v1/groups", params as QueryParams);
  }

  async versions(namespace: string, fimId: string): Promise<DatenfeldgruppeOut[]> {
    return this.e.getJson(`/api/v1/groups/${pathSegment("namespace", namespace)}/${pathSegment("fimId", fimId)}`);
  }

  async get(namespace: string, fimId: string, fimVersion = "latest"): Promise<FullDatenfeldgruppeOut> {
    return this.e.getJson(`/api/v1/groups/${pathSegment("namespace", namespace)}/${pathSegment("fimId", fimId)}/${pathSegment("fimVersion", fimVersion)}`);
  }

  async downloadXdf(namespace: string, fimId: string, fimVersion = "latest"): Promise<RawResponse> {
    return this.e.getRaw(
      `/api/v1/groups/${pathSegment("namespace", namespace)}/${pathSegment("fimId", fimId)}/${pathSegment("fimVersion", fimVersion)}/xdf`,
      ACCEPT_XML,
    );
  }
}

/** Leistungsteckbriefe (XZuFi service descriptions). */
class ServiceProfilesResource {
  constructor(private readonly e: RequestEngine) {}

  async search(params: LeistungSteckbriefSearchParams = {}): Promise<JsonObject> {
    assertEnumParams(params ?? {}, SERVICE_PROFILE_SEARCH_ENUMS);
    return this.e.getJson("/api/v0/leistung-steckbriefe", params as QueryParams);
  }

  async get(leistungsschluessel: string): Promise<LeistungSteckbrief> {
    return this.e.getJson(`/api/v0/leistung-steckbriefe/${pathSegment("leistungsschluessel", leistungsschluessel)}`);
  }

  async downloadXzufi(leistungsschluessel: string): Promise<RawResponse> {
    return this.e.getRaw(`/api/v0/leistung-steckbriefe/${pathSegment("leistungsschluessel", leistungsschluessel)}/xzufi`, ACCEPT_XML);
  }

  async exportPdf(leistungsschluessel: string, languageCode: string): Promise<RawResponse> {
    return this.e.getRaw(
      `/api/v0/leistung-steckbriefe/${pathSegment("leistungsschluessel", leistungsschluessel)}/${pathSegment("languageCode", languageCode)}/pdf`,
      ACCEPT_PDF,
    );
  }
}

/** Leistungsstammtexte (XZuFi service master texts). */
class ServiceTextsResource {
  constructor(private readonly e: RequestEngine) {}

  async search(
    params: LeistungStammtextSearchParams = {},
  ): Promise<PaginatedResult<LeistungStammtextOut>> {
    assertEnumParams(params ?? {}, SERVICE_TEXT_SEARCH_ENUMS);
    return this.e.getJson("/api/v0/leistung-stammtexte", params as QueryParams);
  }

  async get(redaktionId: string, leistungId: string, source: XzufiSource): Promise<FullLeistungStammtextOut> {
    return this.e.getJson(
      `/api/v0/leistung-stammtexte/${pathSegment("redaktionId", redaktionId)}/${pathSegment("leistungId", leistungId)}/${sourceSegment(source)}`,
    );
  }

  async downloadXzufi(redaktionId: string, leistungId: string, source: XzufiSource): Promise<RawResponse> {
    return this.e.getRaw(
      `/api/v0/leistung-stammtexte/${pathSegment("redaktionId", redaktionId)}/${pathSegment("leistungId", leistungId)}/${sourceSegment(source)}/xzufi`,
      ACCEPT_XML,
    );
  }

  async exportPdf(
    redaktionId: string,
    leistungId: string,
    source: XzufiSource,
    languageCode: string,
  ): Promise<RawResponse> {
    return this.e.getRaw(
      `/api/v0/leistung-stammtexte/${pathSegment("redaktionId", redaktionId)}/${pathSegment("leistungId", leistungId)}/${sourceSegment(source)}/${pathSegment("languageCode", languageCode)}/pdf`,
      ACCEPT_PDF,
    );
  }

  /** INSTABLE per the API docs — the parsed XZuFi JSON representation. */
  async parsedXzufi(redaktionId: string, leistungId: string, source: XzufiSource): Promise<JsonObject> {
    return this.e.getJson(
      `/api/v0/leistung-stammtexte/${pathSegment("redaktionId", redaktionId)}/${pathSegment("leistungId", leistungId)}/${sourceSegment(source)}/parsed-xzufi`,
    );
  }
}

/** Generic cursor-paginated XZuFi entity resource (org units, specializations, ...). */
class XzufiEntityResource<T> {
  constructor(
    private readonly e: RequestEngine,
    private readonly listPath: string,
    private readonly itemPath: (redaktionId: string, id: string) => string,
  ) {}

  async list(params: XzufiEntityListParams = {}): Promise<CursorPaginationResult<T>> {
    return this.e.getJson(this.listPath, params as QueryParams);
  }

  async downloadXzufi(redaktionId: string, id: string): Promise<RawResponse> {
    return this.e.getRaw(this.itemPath(redaktionId, id), ACCEPT_XML);
  }
}

/** XProzess process classes. */
class ProcessClassesResource {
  constructor(private readonly e: RequestEngine) {}

  async search(params: ProcessClassSearchParams = {}): Promise<JsonObject> {
    assertEnumParams(params ?? {}, PROCESS_CLASS_SEARCH_ENUMS);
    return this.e.getJson("/api/v0/processclasses", params as QueryParams);
  }

  async get(id: string, version: string): Promise<ProcessClass> {
    return this.e.getJson(`/api/v0/processclasses/${pathSegment("id", id)}/${pathSegment("version", version)}`);
  }

  /**
   * The XProzess XML of a process class. The OpenAPI spec says JSON, but the server
   * sends `application/xml` (an XProzess export) whatever the Accept header says.
   */
  async downloadXprozess(id: string, version: string): Promise<RawResponse> {
    return this.e.getRaw(`/api/v0/processclasses/${pathSegment("id", id)}/${pathSegment("version", version)}/xprozess`, ACCEPT_XML);
  }
}

/**
 * XProzess processes. A process is addressed by id, version, Detaillierungsstufe
 * and its verwaltungspolitische Kodierung — the `verwaltungspolitische_kodierung`
 * value every `search` result item carries (e.g. `"17"`).
 */
class ProcessesResource {
  constructor(private readonly e: RequestEngine) {}

  async search(params: ProcessSearchParams = {}): Promise<JsonObject> {
    assertEnumParams(params ?? {}, PROCESS_SEARCH_ENUMS);
    return this.e.getJson("/api/v0/processes", params as QueryParams);
  }

  async get(id: string, version: string, stufe: Detaillierungsstufe, kodierung: string): Promise<Process> {
    return this.e.getJson(processPath(id, version, stufe, kodierung));
  }

  async downloadXprozess(
    id: string,
    version: string,
    stufe: Detaillierungsstufe,
    kodierung: string,
  ): Promise<RawResponse> {
    return this.e.getRaw(`${processPath(id, version, stufe, kodierung)}/xprozess`, ACCEPT_XML);
  }

  // The report and visualization endpoints serve PDF, not XML, so we negotiate
  // application/pdf to match what the server actually returns.
  async downloadReport(
    id: string,
    version: string,
    stufe: Detaillierungsstufe,
    kodierung: string,
  ): Promise<RawResponse> {
    return this.e.getRaw(`${processPath(id, version, stufe, kodierung)}/report`, ACCEPT_PDF);
  }

  async downloadVisualization(
    id: string,
    version: string,
    stufe: Detaillierungsstufe,
    kodierung: string,
  ): Promise<RawResponse> {
    return this.e.getRaw(`${processPath(id, version, stufe, kodierung)}/visualization`, ACCEPT_PDF);
  }

  async downloadVisualizationDisplay(
    id: string,
    version: string,
    stufe: Detaillierungsstufe,
    kodierung: string,
  ): Promise<RawResponse> {
    return this.e.getRaw(
      `${processPath(id, version, stufe, kodierung)}/visualization_display`,
      ACCEPT_PDF,
    );
  }
}

/** Path of one process: `/api/v0/processes/{id}/{version}/{stufe}/{kodierung}`. */
function processPath(
  id: string,
  version: string,
  stufe: Detaillierungsstufe,
  kodierung: string,
): string {
  return `/api/v0/processes/${pathSegment("id", id)}/${pathSegment("version", version)}/${stufeSegment(stufe)}/${pathSegment("kodierung", kodierung)}`;
}

/** Code lists referenced by data fields. */
class CodeListsResource {
  constructor(private readonly e: RequestEngine) {}

  async list(params: Pagination = {}): Promise<PaginatedResult<CodeList>> {
    return this.e.getJson("/api/v0/code-lists", params as QueryParams);
  }
}

/** Public tools that need no authentication. */
class ToolsResource {
  constructor(private readonly e: RequestEngine) {}

  /**
   * Streamed CSV export of a search. Returns the raw response.
   *
   * Rejects with `FimValidationError`, before any request, when `resource` is
   * missing or not one of SearchCsvResourceValues: the server would answer it with a
   * CSV of Leistungen and status 200.
   */
  async searchCsvDownload(params: SearchCsvParams): Promise<RawResponse> {
    assertValid("resource", (params ?? {}).resource, searchCsvResourceProblem);
    return this.e.getRaw("/tools/search-csv-download", "text/csv", params as QueryParams);
  }
}

export class FimPortalClient {
  private readonly engine: RequestEngine;

  readonly schemas: SchemasResource;
  readonly documentProfiles: DocumentProfilesResource;
  readonly fields: FieldsResource;
  readonly groups: GroupsResource;
  readonly serviceProfiles: ServiceProfilesResource;
  readonly serviceTexts: ServiceTextsResource;
  readonly organizationalUnits: XzufiEntityResource<OrganisationseinheitOut>;
  readonly specializations: XzufiEntityResource<SpezialisierungOut>;
  readonly onlineServices: XzufiEntityResource<OnlinedienstOut>;
  readonly processClasses: ProcessClassesResource;
  readonly processes: ProcessesResource;
  readonly codeLists: CodeListsResource;
  readonly tools: ToolsResource;

  constructor(options: EngineOptions = {}) {
    this.engine = new RequestEngine(options);

    this.schemas = new SchemasResource(this.engine);
    this.documentProfiles = new DocumentProfilesResource(this.engine);
    this.fields = new FieldsResource(this.engine);
    this.groups = new GroupsResource(this.engine);
    this.serviceProfiles = new ServiceProfilesResource(this.engine);
    this.serviceTexts = new ServiceTextsResource(this.engine);
    this.organizationalUnits = new XzufiEntityResource<OrganisationseinheitOut>(
      this.engine,
      "/api/v0/organizational-unit",
      (redaktionId, id) => `/api/v0/organizational-unit/${pathSegment("redaktionId", redaktionId)}/${pathSegment("id", id)}/xzufi`,
    );
    this.specializations = new XzufiEntityResource<SpezialisierungOut>(
      this.engine,
      "/api/v0/specialization",
      (redaktionId, id) => `/api/v0/specialization/${pathSegment("redaktionId", redaktionId)}/${pathSegment("id", id)}/xzufi`,
    );
    this.onlineServices = new XzufiEntityResource<OnlinedienstOut>(
      this.engine,
      "/api/v0/online-service",
      (redaktionId, id) => `/api/v0/online-service/${pathSegment("redaktionId", redaktionId)}/${pathSegment("id", id)}/xzufi`,
    );
    this.processClasses = new ProcessClassesResource(this.engine);
    this.processes = new ProcessesResource(this.engine);
    this.codeLists = new CodeListsResource(this.engine);
    this.tools = new ToolsResource(this.engine);
  }
}
