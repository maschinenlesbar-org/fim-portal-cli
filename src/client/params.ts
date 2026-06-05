// Strongly-typed parameter objects for each search endpoint. These mirror the
// query parameters documented in openapi.json. Every field is optional; omitted
// fields are simply not sent.

import type {
  FreigabeStatus,
  XdfVersion,
  DatenfelderSearchOrder,
  SchemaSucheIn,
  SteckbriefSucheIn,
  FeldSucheIn,
  GruppeSucheIn,
  Dokumentart,
  Feldart,
  Datentyp,
  LeistungsTyp,
  LeistungsTypisierung,
  LeistungSucheIn,
  LeistungSteckbriefSearchOrder,
  LeistungStammtextSearchOrder,
  Sprache,
  Leistungsadressat,
  OzgThemenfeld,
  Behoerde,
  SDG,
  XzufiSource,
  OperativesZiel,
  Verfahrensart,
  Handlungsform,
  Detaillierungsstufe,
  Anwendungsgebiet,
} from "./enums.js";

/** Offset/limit pagination shared by the v1 search endpoints. */
export interface Pagination {
  offset?: number;
  /** 1..200, defaults to 200 server-side. */
  limit?: number;
}

/** Cursor pagination shared by the v0 XZuFi entity listings. */
export interface CursorPagination {
  cursor?: number;
  limit?: number;
}

/** Fields common to the four XDatenfelder v1 search endpoints. */
interface DatenfelderCommonSearch extends Pagination {
  name?: string;
  nummernkreis?: string[];
  freigabe_status?: FreigabeStatus[];
  gueltig_am?: string;
  status_gesetzt_durch?: string;
  status_gesetzt_seit?: string;
  status_gesetzt_bis?: string;
  bezug?: string;
  versionshinweis?: string;
  updated_since?: string;
  xdf_version?: XdfVersion;
  fts_query?: string;
  is_latest?: boolean;
  order_by?: DatenfelderSearchOrder;
}

export interface SchemaSearchParams extends DatenfelderCommonSearch {
  bezug_unterelemente?: string;
  bezeichnung?: string;
  stichwort?: string;
  suche_nur_in?: SchemaSucheIn;
}

export interface DocumentProfileSearchParams extends Pagination {
  name?: string;
  freigabe_status?: FreigabeStatus[];
  status_gesetzt_durch?: string;
  status_gesetzt_seit?: string;
  status_gesetzt_bis?: string;
  bezeichnung?: string;
  dokumentart?: Dokumentart;
  nummernkreis?: string[];
  bezug?: string;
  fts_query?: string;
  suche_nur_in?: SteckbriefSucheIn;
  versionshinweis?: string;
  updated_since?: string;
  xdf_version?: XdfVersion;
  stichwort?: string;
  is_latest?: boolean;
  order_by?: DatenfelderSearchOrder;
}

export interface FieldSearchParams extends DatenfelderCommonSearch {
  suche_nur_in?: FeldSucheIn;
  feldart?: Feldart;
  datentyp?: Datentyp;
}

export interface GroupSearchParams extends DatenfelderCommonSearch {
  suche_nur_in?: GruppeSucheIn;
}

export interface LeistungSteckbriefSearchParams extends Pagination {
  leistungstyp?: LeistungsTyp[];
  typisierung?: LeistungsTypisierung[];
  fts_query?: string;
  suche_nur_in?: LeistungSucheIn;
  title?: string;
  leistungsbezeichnung?: string;
  leistungsbezeichnung2?: string;
  leistungsschluessel?: string;
  rechtsgrundlagen?: string;
  freigabe_status?: FreigabeStatus[];
  einheitlicher_ansprechpartner?: boolean;
  updated_since?: string;
  lagen_portalverbund?: string;
  sdg?: SDG[];
  sdg_relevant?: boolean;
  sprache?: Sprache;
  leistungsadressat?: Leistungsadressat[];
  ozg_themenfeld?: OzgThemenfeld[];
  ozg_id?: string;
  vollzugsbehoerde?: Behoerde;
  order_by?: LeistungSteckbriefSearchOrder;
}

export interface LeistungStammtextSearchParams extends Pagination {
  leistungsschluessel?: string;
  redaktion_id?: string;
  title?: string;
  leistungsbezeichnung?: string;
  leistungsbezeichnung2?: string;
  rechtsgrundlagen?: string;
  leistungstyp?: LeistungsTyp[];
  typisierung?: LeistungsTypisierung[];
  updated_since?: string;
  lagen_portalverbund?: string;
  leistungsadressat?: Leistungsadressat[];
  ozg_themenfeld?: OzgThemenfeld[];
  ozg_id?: string;
  vollzugsbehoerde?: Behoerde;
  einheitlicher_ansprechpartner?: boolean;
  source?: XzufiSource;
  fts_query?: string;
  suche_nur_in?: LeistungSucheIn;
  order_by?: LeistungStammtextSearchOrder;
}

export interface ProcessClassSearchParams extends Pagination {
  fts_query?: string;
  freigabe_status?: FreigabeStatus[];
  operatives_ziel?: OperativesZiel;
  verfahrensart?: Verfahrensart;
  handlungsform?: Handlungsform;
}

export interface ProcessSearchParams extends Pagination {
  freigabe_status?: FreigabeStatus[];
  detaillierungsstufe?: Detaillierungsstufe;
  anwendungsgebiet?: Anwendungsgebiet;
  is_musterprozess?: boolean;
  fts_query?: string;
}
