// Response fixtures shaped after the schemas in openapi.json (FIM Portal v0.24.0).
// These stand in for real API responses in the mocked unit tests.

import type {
  PaginatedResult,
  SchemaOut,
  SteckbriefOut,
  DatenfeldOut,
  DatenfeldgruppeOut,
  LeistungStammtextOut,
  CursorPaginationResult,
} from "../src/client/types.js";

export const schemaOut: SchemaOut = {
  fim_id: "S07000009",
  fim_version: "1.0",
  nummernkreis: "07",
  name: "Geburt",
  beschreibung: null,
  definition: null,
  freigabe_status: 6,
  freigabe_status_label: "Fachlich freigegeben",
  status_gesetzt_am: "2022-01-01",
  gueltig_ab: null,
  gueltig_bis: null,
  status_gesetzt_durch: "FITKO",
  steckbrief_id: "D07000001",
  xdf_version: "2.0",
  bezug: [],
  versionshinweis: null,
  stichwort: [],
  letzte_aenderung: "2023-10-17T16:50:40.859986",
  last_update: "2023-10-17T16:50:40.859986",
  bezeichnung: null,
  bezug_components: [],
  veroeffentlichungsdatum: null,
  is_latest: true,
  fts_match: null,
};

export const schemaSearchResult: PaginatedResult<SchemaOut> = {
  items: [schemaOut],
  offset: 0,
  limit: 200,
  count: 1,
  total_count: 1,
};

export const fullSchema = {
  fim_id: "S07000009",
  fim_version: "1.0",
  name: "Geburt",
  data_groups: [],
  data_fields: [],
};

export const steckbriefOut: SteckbriefOut = {
  fim_id: "D07000001",
  fim_version: "1.0",
  nummernkreis: "07",
  name: "Geburtsurkunde",
  definition: null,
  bezeichnung: null,
  beschreibung: null,
  freigabe_status: 6,
  freigabe_status_label: "Fachlich freigegeben",
  status_gesetzt_durch: "FITKO",
  status_gesetzt_am: "2022-01-01",
  gueltig_ab: null,
  gueltig_bis: null,
  bezug: [],
  versionshinweis: null,
  veroeffentlichungsdatum: null,
  letzte_aenderung: "2023-10-17T16:50:40.859986",
  last_update: "2023-10-17T16:50:40.859986",
  ist_abstrakt: false,
  dokumentart: "001",
  hilfetext: null,
  stichwort: [],
  xdf_version: "2.0",
  is_latest: true,
  fts_match: null,
};

export const steckbriefSearchResult: PaginatedResult<SteckbriefOut> = {
  items: [steckbriefOut],
  offset: 0,
  limit: 200,
  count: 1,
  total_count: 1,
};

export const datenfeldOut: DatenfeldOut = {
  namespace: "urn:xoev-de:fim:standard:xdatenfelder",
  fim_id: "F60000227",
  fim_version: "1.1",
  nummernkreis: "60",
  name: "Familienname",
  beschreibung: null,
  definition: null,
  bezug: [],
  freigabe_status: 6,
  freigabe_status_label: "Fachlich freigegeben",
  status_gesetzt_am: null,
  status_gesetzt_durch: null,
  gueltig_ab: null,
  gueltig_bis: null,
  versionshinweis: null,
  veroeffentlichungsdatum: null,
  letzte_aenderung: "2023-10-17T16:50:40.859986",
  last_update: "2023-10-17T16:50:40.859986",
  feldart: "input",
  datentyp: "text",
  xdf_version: "2.0",
  is_latest: true,
  code_list_id: null,
  fts_match: null,
};

export const fieldSearchResult: PaginatedResult<DatenfeldOut> = {
  items: [datenfeldOut],
  offset: 0,
  limit: 200,
  count: 1,
  total_count: 1,
};

export const gruppeOut: DatenfeldgruppeOut = {
  namespace: "urn:xoev-de:fim:standard:xdatenfelder",
  fim_id: "G60000019",
  fim_version: "1.1",
  nummernkreis: "60",
  xdf_version: "2.0",
  name: "Name natürliche Person",
  beschreibung: null,
  definition: null,
  freigabe_status: 6,
  freigabe_status_label: "Fachlich freigegeben",
  status_gesetzt_durch: null,
  bezug: [],
  status_gesetzt_am: null,
  gueltig_ab: null,
  gueltig_bis: null,
  versionshinweis: null,
  veroeffentlichungsdatum: null,
  letzte_aenderung: "2023-10-17T16:50:40.859986",
  last_update: "2023-10-17T16:50:40.859986",
  is_latest: true,
  fts_match: null,
};

export const groupSearchResult: PaginatedResult<DatenfeldgruppeOut> = {
  items: [gruppeOut],
  offset: 0,
  limit: 200,
  count: 1,
  total_count: 1,
};

export const stammtextOut: LeistungStammtextOut = {
  redaktion_id: "L100001",
  leistung_id: "L1",
  source: "leika",
  title: "Personalausweis beantragen",
  leistungsschluessel: ["99050048262000"],
  leistungstyp: "lo",
  leistungsadressat: ["001"],
  typisierung: ["2"],
  freigabe_status: 6,
  leistungsbezeichnung: null,
  leistungsbezeichnung_2: null,
  kurztext: null,
  volltext: null,
  rechtsgrundlagen: null,
  erstellt_datum_zeit: null,
  geaendert_datum_zeit: null,
  klassifizierung: [],
  ozg: [],
  fts_match: null,
};

export const stammtextSearchResult: PaginatedResult<LeistungStammtextOut> = {
  items: [stammtextOut],
  offset: 0,
  limit: 200,
  count: 1,
  total_count: 1,
};

export const orgUnitListResult: CursorPaginationResult<{ id: string }> = {
  items: [{ id: "OU1" }],
  limit: 100,
  count: 1,
  next_cursor: null,
};

export const xmlBody = '<?xml version="1.0" encoding="UTF-8"?><xdf:schema/>';
