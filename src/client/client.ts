// FimPortalClient — a typed, use-case-tailored client over the open (no-auth)
// endpoints of the FIM Portal API. Authenticated endpoints (uploads, converters,
// quality-check tools, token introspection) are intentionally not implemented.
//
// The surface is grouped by resource so usage reads naturally, e.g.
//   client.schemas.search({ name: "Geburt" })
//   client.processes.downloadVisualization(id, version, stufe)

import { RequestEngine, type EngineOptions, type RawResponse } from "./engine.js";
import type { QueryParams } from "./query.js";
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
  CursorPagination,
  Pagination,
} from "./params.js";
import type { XzufiSource, Detaillierungsstufe } from "./enums.js";

const ACCEPT_XML = "application/xml";
const ACCEPT_PDF = "application/pdf";

const enc = encodeURIComponent;

/** Search/filter and retrieve XDatenfelder Datenschemata. */
class SchemasResource {
  constructor(private readonly e: RequestEngine) {}

  search(params: SchemaSearchParams = {}): Promise<PaginatedResult<SchemaOut>> {
    return this.e.getJson("/api/v1/schemas", params as QueryParams);
  }

  /** All versions of a schema, ascending. */
  versions(fimId: string): Promise<SchemaOut[]> {
    return this.e.getJson(`/api/v1/schemas/${enc(fimId)}`);
  }

  /** A full schema. Pass version `"latest"` for the newest. */
  get(fimId: string, fimVersion = "latest"): Promise<FullSchemaOut> {
    return this.e.getJson(`/api/v1/schemas/${enc(fimId)}/${enc(fimVersion)}`);
  }

  downloadXdf(fimId: string, fimVersion = "latest"): Promise<RawResponse> {
    return this.e.getRaw(`/api/v1/schemas/${enc(fimId)}/${enc(fimVersion)}/xdf`, ACCEPT_XML);
  }

  qualityReport(fimId: string, fimVersion = "latest"): Promise<QualityReport> {
    return this.e.getJson(`/api/v1/schemas/${enc(fimId)}/${enc(fimVersion)}/quality-report`);
  }
}

/** Search/filter and retrieve Dokumentsteckbriefe (document profiles). */
class DocumentProfilesResource {
  constructor(private readonly e: RequestEngine) {}

  search(params: DocumentProfileSearchParams = {}): Promise<PaginatedResult<SteckbriefOut>> {
    return this.e.getJson("/api/v1/document-profiles", params as QueryParams);
  }

  versions(fimId: string): Promise<SteckbriefOut[]> {
    return this.e.getJson(`/api/v1/document-profiles/${enc(fimId)}`);
  }

  get(fimId: string, fimVersion = "latest"): Promise<FullSteckbriefOut> {
    return this.e.getJson(`/api/v1/document-profiles/${enc(fimId)}/${enc(fimVersion)}`);
  }

  downloadXdf(fimId: string, fimVersion = "latest"): Promise<RawResponse> {
    return this.e.getRaw(
      `/api/v1/document-profiles/${enc(fimId)}/${enc(fimVersion)}/xdf`,
      ACCEPT_XML,
    );
  }
}

/** Search/filter and retrieve Datenfelder (data fields). */
class FieldsResource {
  constructor(private readonly e: RequestEngine) {}

  search(params: FieldSearchParams = {}): Promise<PaginatedResult<DatenfeldOut>> {
    return this.e.getJson("/api/v1/fields", params as QueryParams);
  }

  versions(namespace: string, fimId: string): Promise<DatenfeldOut[]> {
    return this.e.getJson(`/api/v1/fields/${enc(namespace)}/${enc(fimId)}`);
  }

  get(namespace: string, fimId: string, fimVersion = "latest"): Promise<FullDatenfeldOut> {
    return this.e.getJson(`/api/v1/fields/${enc(namespace)}/${enc(fimId)}/${enc(fimVersion)}`);
  }

  downloadXdf(namespace: string, fimId: string, fimVersion = "latest"): Promise<RawResponse> {
    return this.e.getRaw(
      `/api/v1/fields/${enc(namespace)}/${enc(fimId)}/${enc(fimVersion)}/xdf`,
      ACCEPT_XML,
    );
  }
}

/** Search/filter and retrieve Datenfeldgruppen (data groups). */
class GroupsResource {
  constructor(private readonly e: RequestEngine) {}

  search(params: GroupSearchParams = {}): Promise<PaginatedResult<DatenfeldgruppeOut>> {
    return this.e.getJson("/api/v1/groups", params as QueryParams);
  }

  versions(namespace: string, fimId: string): Promise<DatenfeldgruppeOut[]> {
    return this.e.getJson(`/api/v1/groups/${enc(namespace)}/${enc(fimId)}`);
  }

  get(namespace: string, fimId: string, fimVersion = "latest"): Promise<FullDatenfeldgruppeOut> {
    return this.e.getJson(`/api/v1/groups/${enc(namespace)}/${enc(fimId)}/${enc(fimVersion)}`);
  }

  downloadXdf(namespace: string, fimId: string, fimVersion = "latest"): Promise<RawResponse> {
    return this.e.getRaw(
      `/api/v1/groups/${enc(namespace)}/${enc(fimId)}/${enc(fimVersion)}/xdf`,
      ACCEPT_XML,
    );
  }
}

/** Leistungsteckbriefe (XZuFi service descriptions). */
class ServiceProfilesResource {
  constructor(private readonly e: RequestEngine) {}

  search(params: LeistungSteckbriefSearchParams = {}): Promise<JsonObject> {
    return this.e.getJson("/api/v0/leistung-steckbriefe", params as QueryParams);
  }

  get(leistungsschluessel: string): Promise<LeistungSteckbrief> {
    return this.e.getJson(`/api/v0/leistung-steckbriefe/${enc(leistungsschluessel)}`);
  }

  downloadXzufi(leistungsschluessel: string): Promise<RawResponse> {
    return this.e.getRaw(`/api/v0/leistung-steckbriefe/${enc(leistungsschluessel)}/xzufi`, ACCEPT_XML);
  }

  exportPdf(leistungsschluessel: string, languageCode: string): Promise<RawResponse> {
    return this.e.getRaw(
      `/api/v0/leistung-steckbriefe/${enc(leistungsschluessel)}/${enc(languageCode)}/pdf`,
      ACCEPT_PDF,
    );
  }
}

/** Leistungsstammtexte (XZuFi service master texts). */
class ServiceTextsResource {
  constructor(private readonly e: RequestEngine) {}

  search(
    params: LeistungStammtextSearchParams = {},
  ): Promise<PaginatedResult<LeistungStammtextOut>> {
    return this.e.getJson("/api/v0/leistung-stammtexte", params as QueryParams);
  }

  get(redaktionId: string, leistungId: string, source: XzufiSource): Promise<FullLeistungStammtextOut> {
    return this.e.getJson(
      `/api/v0/leistung-stammtexte/${enc(redaktionId)}/${enc(leistungId)}/${enc(source)}`,
    );
  }

  downloadXzufi(redaktionId: string, leistungId: string, source: XzufiSource): Promise<RawResponse> {
    return this.e.getRaw(
      `/api/v0/leistung-stammtexte/${enc(redaktionId)}/${enc(leistungId)}/${enc(source)}/xzufi`,
      ACCEPT_XML,
    );
  }

  exportPdf(
    redaktionId: string,
    leistungId: string,
    source: XzufiSource,
    languageCode: string,
  ): Promise<RawResponse> {
    return this.e.getRaw(
      `/api/v0/leistung-stammtexte/${enc(redaktionId)}/${enc(leistungId)}/${enc(source)}/${enc(languageCode)}/pdf`,
      ACCEPT_PDF,
    );
  }

  /** INSTABLE per the API docs — the parsed XZuFi JSON representation. */
  parsedXzufi(redaktionId: string, leistungId: string, source: XzufiSource): Promise<JsonObject> {
    return this.e.getJson(
      `/api/v0/leistung-stammtexte/${enc(redaktionId)}/${enc(leistungId)}/${enc(source)}/parsed-xzufi`,
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

  list(params: CursorPagination = {}): Promise<CursorPaginationResult<T>> {
    return this.e.getJson(this.listPath, params as QueryParams);
  }

  downloadXzufi(redaktionId: string, id: string): Promise<RawResponse> {
    return this.e.getRaw(this.itemPath(redaktionId, id), ACCEPT_XML);
  }
}

/** XProzess process classes. */
class ProcessClassesResource {
  constructor(private readonly e: RequestEngine) {}

  search(params: ProcessClassSearchParams = {}): Promise<JsonObject> {
    return this.e.getJson("/api/v0/processclasses", params as QueryParams);
  }

  get(id: string, version: string): Promise<ProcessClass> {
    return this.e.getJson(`/api/v0/processclasses/${enc(id)}/${enc(version)}`);
  }

  /** The XProzess representation (served as JSON by this endpoint). */
  getXprozess(id: string, version: string): Promise<JsonObject> {
    return this.e.getJson(`/api/v0/processclasses/${enc(id)}/${enc(version)}/xprozess`);
  }
}

/** XProzess processes. */
class ProcessesResource {
  constructor(private readonly e: RequestEngine) {}

  search(params: ProcessSearchParams = {}): Promise<JsonObject> {
    return this.e.getJson("/api/v0/processes", params as QueryParams);
  }

  get(id: string, version: string, stufe: Detaillierungsstufe): Promise<Process> {
    return this.e.getJson(`/api/v0/processes/${enc(id)}/${enc(version)}/${enc(stufe)}`);
  }

  downloadXprozess(id: string, version: string, stufe: Detaillierungsstufe): Promise<RawResponse> {
    return this.e.getRaw(`/api/v0/processes/${enc(id)}/${enc(version)}/${enc(stufe)}/xprozess`, ACCEPT_XML);
  }

  // The report and visualization endpoints serve PDF, not XML, so we negotiate
  // application/pdf to match what the server actually returns.
  downloadReport(id: string, version: string, stufe: Detaillierungsstufe): Promise<RawResponse> {
    return this.e.getRaw(`/api/v0/processes/${enc(id)}/${enc(version)}/${enc(stufe)}/report`, ACCEPT_PDF);
  }

  downloadVisualization(id: string, version: string, stufe: Detaillierungsstufe): Promise<RawResponse> {
    return this.e.getRaw(
      `/api/v0/processes/${enc(id)}/${enc(version)}/${enc(stufe)}/visualization`,
      ACCEPT_PDF,
    );
  }

  downloadVisualizationDisplay(
    id: string,
    version: string,
    stufe: Detaillierungsstufe,
  ): Promise<RawResponse> {
    return this.e.getRaw(
      `/api/v0/processes/${enc(id)}/${enc(version)}/${enc(stufe)}/visualization_display`,
      ACCEPT_PDF,
    );
  }
}

/** Code lists referenced by data fields. */
class CodeListsResource {
  constructor(private readonly e: RequestEngine) {}

  list(params: Pagination = {}): Promise<PaginatedResult<CodeList>> {
    return this.e.getJson("/api/v0/code-lists", params as QueryParams);
  }
}

/** Public tools that need no authentication. */
class ToolsResource {
  constructor(private readonly e: RequestEngine) {}

  /** Streamed CSV export of a search. Returns the raw response. */
  searchCsvDownload(params: Record<string, string | undefined>): Promise<RawResponse> {
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
      (r, id) => `/api/v0/organizational-unit/${enc(r)}/${enc(id)}/xzufi`,
    );
    this.specializations = new XzufiEntityResource<SpezialisierungOut>(
      this.engine,
      "/api/v0/specialization",
      (r, id) => `/api/v0/specialization/${enc(r)}/${enc(id)}/xzufi`,
    );
    this.onlineServices = new XzufiEntityResource<OnlinedienstOut>(
      this.engine,
      "/api/v0/online-service",
      (r, id) => `/api/v0/online-service/${enc(r)}/${enc(id)}/xzufi`,
    );
    this.processClasses = new ProcessClassesResource(this.engine);
    this.processes = new ProcessesResource(this.engine);
    this.codeLists = new CodeListsResource(this.engine);
    this.tools = new ToolsResource(this.engine);
  }
}
