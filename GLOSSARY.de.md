# Glossar

Ein Nachschlagewerk für die Fachbegriffe und projektspezifischen Begriffe, die in
`fim-portal-cli` verwendet werden. Die FIM-Fachdomäne ist deutsch; dieses Glossar nennt
neben dem deutschen Originalbegriff den englischen Begriff, den CLI und API verwenden
(sofern es einen gibt).

> **Übersetzungstabelle** (aus der API-Beschreibung). Die CLI hält sich daran:
>
> | Deutsch | Englisch / API-Begriff |
> | --- | --- |
> | Datenschema | schema |
> | Datenfeldgruppe | data group / group |
> | Datenfeld | data field / field |
> | Dokumentsteckbrief | document profile |
> | Leistung | service |
> | Leistungsbeschreibung | xzufi-service |
> | Prozess | process |
> | Codelisten | code lists |

---

## Das FIM-Programm

**FIM – Föderales Informationsmanagement.**
Ein Programm der öffentlichen Verwaltung in Deutschland, das die Informationen hinter
Verwaltungsleistungen standardisiert, damit sie einmal beschrieben und überall nachgenutzt
werden können (Formulare, Prozesse, Onlinedienste). FIM gliedert sich in drei *Bausteine*,
von denen jeder auf einem XÖV-Standard für den Datenaustausch beruht.

**FIM-Portal.** Der zentrale Katalog (`fimportal.de`), der alle FIM-Bausteine bündelt und
über die REST-API bereitstellt, auf der dieses Tool aufsetzt. Früher unter
`schema.fim.fitko.net` erreichbar; die Adresse führt weiterhin zur selben API.

**FITKO – Föderale IT-Kooperation.** Die öffentliche Einrichtung, die das FIM-Portal
betreibt. Der Quellcode liegt auf [OpenCoDE](https://gitlab.opencode.de/fitko/fim).

**XÖV.** Die Familie XML-basierter Standards für den Datenaustausch in der deutschen
öffentlichen Verwaltung. XDatenfelder, XZuFi und XProzess sind XÖV-Standards.

---

## Die drei Standards (Bausteine)

**XDatenfelder.** Der Standard für *Datendefinitionen* – Datenschemata, Datenfeldgruppen,
Datenfelder und Dokumentsteckbriefe. Es gibt zwei relevante Versionen: **XDF2** (`2.0`)
und **XDF3** (`3.0.0`); siehe `xdf_version`. CLI-Befehlsgruppen: `schemas`,
`groups`, `fields`, `document-profiles`.

**XZuFi – XML für Zuständigkeitsfinder.** Der Standard für *Leistungen*: was eine
Leistung ist, wer zuständig ist, Stammtexte, Onlinedienste und die Organisationen, die sie
anbieten. CLI-Befehlsgruppen: `service-profiles`, `service-texts`,
`organizational-units`, `specializations`, `online-services`.

**XProzess.** Der Standard für *Prozesse* – wie ein Verwaltungsverfahren abläuft, in
unterschiedlichen Detaillierungsgraden. CLI-Befehlsgruppen: `processes`,
`process-classes`.

---

## Elemente von XDatenfelder

**Datenschema (schema).** Der oberste Container, der die für eine Leistung benötigten
Daten beschreibt. Verweist auf Datenfeldgruppen und Datenfelder. Über `steckbrief_id` ist
es mit einem Dokumentsteckbrief verknüpft. CLI: `schemas`.

**Datenfeldgruppe (data group / group).** Eine wiederverwendbare, benannte Zusammenfassung
von Datenfeldern (und verschachtelten Gruppen) – z. B. „Name einer natürlichen Person“,
die die Felder Vorname, Familienname usw. bündelt. CLI: `groups`.

**Datenfeld (data field / field).** Die kleinste Einheit der Datenerfassung – eine
einzelne Eingabe, z. B. „Familienname“. Hat eine **Feldart** und einen **Datentyp**
(siehe unten) und kann auf eine **Codeliste** verweisen. CLI: `fields`.

**Dokumentsteckbrief (document profile).** Ein Steckbrief, der ein *Dokument* in einem
Prozess beschreibt – welche Rolle es spielt (Auslöser, Ergebnis, eingehende/ausgehende
Daten) und welches Datenschema es umsetzt. Hat eine **Dokumentart**. Kann *abstrakt* sein
(`ist_abstrakt`). CLI: `document-profiles`.

**Feldart.** Die *Art* eines Datenfelds: `input`, `select`, `label`, `hidden`,
`locked`. (Filter: `fields search --feldart`.)

**Datentyp.** Der *Datentyp* eines Felds: `text`, `text_latin`, `date`, `time`,
`datetime`, `bool`, `num`, `num_int`, `num_currency`, `file`, `obj`. (Filter:
`fields search --datentyp`.)

**Dokumentart.** Die Einordnung eines Dokumentsteckbriefs (eine numerische Codeliste
`001`…`014`, `999`). Siehe die
[Codeliste](https://www.xrepository.de/details/urn:xoev-de:fim-datenfelder:codeliste:dokumentart).

**Codeliste (code list).** Eine abgeschlossene Menge zulässiger Werte, auf die ein
Datenfeld verweist (z. B. Ländercodes). Das Portal stellt sie unter unveränderlichen URLs
bereit. CLI: `code-lists`.

---

## Elemente von XZuFi

**Leistung (service).** Eine Verwaltungsleistung für Bürgerinnen und Bürger oder
Unternehmen (z. B. „Reisepass beantragen“).

**Leistungsteckbrief (service profile).** Der beschreibende Steckbrief einer Leistung –
die durchsuchbare, strukturierte Zusammenfassung. Wird über einen **Leistungsschlüssel**
identifiziert. CLI: `service-profiles`.

**Leistungsstammtext (service master text / xzufi-service).** Die wiederverwendbaren
Texte einer Leistung (Kurztext, Volltext, Rechtsgrundlagen), gepflegt von einer Redaktion.
Wird über `redaktion_id` + `leistung_id` + **source** identifiziert.
CLI: `service-texts`.

**Leistungsschlüssel.** Der Schlüssel, der eine Leistung identifiziert (oft ein
LeiKa-Schlüssel wie `99050048262000`).

**LeiKa – Leistungskatalog.** Der bundesweite Katalog der Verwaltungsleistungen; aus ihm
stammen viele Leistungsschlüssel und Klassifikationen.

**source (XzufiSource).** Die Herkunft eines Leistungsstammtexts: `leika`,
`landesredaktion` (die Redaktion eines Bundeslandes) oder `pvog` (das
Portalverbund Online-Gateway).

**Redaktion / redaktion_id.** Die Redaktion, die einen Datensatz pflegt, und ihre
Kennung.

**Organisationseinheit (organizational unit).** Eine Verwaltungsorganisation
(Behörde/Amt) in XZuFi. CLI: `organizational-units`.

**Spezialisierung (specialization).** Ein Spezialisierungsdatensatz in XZuFi.
CLI: `specializations`.

**Onlinedienst (online service).** Ein digitales Leistungsangebot in XZuFi.
CLI: `online-services`.

**Einheitlicher Ansprechpartner (EA).** Ein auf EU-Recht zurückgehendes Konzept; manche
Leistungen sind als EA-relevant gekennzeichnet
(`--einheitlicher-ansprechpartner`).

**SDG – Single Digital Gateway.** EU-Verordnung; Leistungen können als SDG-relevant
gekennzeichnet und einem SDG-Informationsbereich zugeordnet werden (`--sdg`, `--sdg-relevant`).

**OZG – Onlinezugangsgesetz.** Das Gesetz zur Verbesserung des Onlinezugangs zu
Verwaltungsleistungen. Leistungen haben eine `ozg_id` und ein **OZG-Themenfeld**
(z. B. `familie_kind`).

**Lagen / Portalverbund.** Lebens- und Geschäftslagen, nach denen Leistungen im
Portalverbund gegliedert sind (`--lagen-portalverbund`).

**Vollzugsbehörde.** Die Behörde, die eine Leistung vollzieht (`BAMF`, `BLE`, `DRV`).

---

## Elemente von XProzess

**Prozess (process).** Ein modelliertes Verwaltungsverfahren. Wird über
`process_id` + `process_version` + **Detaillierungsstufe** + **verwaltungspolitische
Kodierung** identifiziert. CLI: `processes`.

**Prozessklasse (process class).** Eine übergeordnete, wiederverwendbare Prozessvorlage,
identifiziert über ID + Version. CLI: `process-classes`.

**Detaillierungsstufe.** Der Detaillierungsgrad eines Prozessmodells: `101`–`105`
(grob → fein). Erforderlich, um einen bestimmten Prozess abzurufen.

**Verwaltungspolitische Kodierung.** Der vierte Teil einer Prozessadresse, neben ID,
Version und Detaillierungsstufe (z. B. `17`). Jeder Treffer von `processes search`
enthält sie als `verwaltungspolitische_kodierung`; diesen Wert übergeben Sie als
Argument `<kodierung>` an `processes get` und die Prozess-Downloads.

**Anwendungsgebiet.** Der fachliche Bereich, in dem ein Prozess angewendet wird (`01`–`17`).

**Musterprozess.** Ein Referenz- bzw. Vorlageprozess (`--is-musterprozess`).

**Operatives Ziel, Verfahrensart, Handlungsform.** Klassifikationsmerkmale in XProzess,
nach denen sich Prozessklassen filtern lassen.

**Visualisierung / Report.** Für einen Prozess erzeugte Artefakte: ein grafisches Modell
(BPMN-ähnlich) und ein Bericht zu Qualität und Struktur. CLI: `processes visualization`,
`processes visualization-display`, `processes report`.

---

## Kennungen, Versionierung und Metadaten

**FIM-ID (`fim_id`).** Die stabile Kennung eines Elements, mit einem Präfix für den Typ:
`S…` Datenschema, `D…` Dokumentsteckbrief, `F…` Datenfeld, `G…` Datenfeldgruppe.
Beispiel: `S07000009`.

**FIM-Version (`fim_version`).** Die Version einer bestimmten FIM-ID, z. B. `1.0`,
`3.0.0`. Der Sonderwert **`latest`** verweist auf die neueste Version – er gilt in jedem
`get`-/`xdf`-Befehl der CLI, wenn Sie keine Version angeben.

**namespace.** Bei Datenfeldern und Datenfeldgruppen ein URN-Namensraum, der zusammen mit
der FIM-ID das Element identifiziert (z. B. `urn:xoev-de:fim:standard:xdatenfelder`).
Pflichtargument im Pfad für `fields`/`groups` `get`/`versions`/`xdf`.

**Nummernkreis.** Der numerische Bereich, zu dem ein Element gehört – grob die
verantwortliche Organisation bzw. der Fachbereich. Gefiltert wird per **Präfixvergleich**:
`01` erfasst den gesamten Bereich `01000`. Wiederholbar (`--nummernkreis`).

**Freigabestatus (`freigabe_status`).** Der Freigabestatus als Ganzzahl
`1`–`8`: `1` in Planung, `2` in Bearbeitung, `3` Entwurf, `4` methodisch freigegeben,
`5` fachlich freigegeben (silber), `6` fachlich freigegeben (gold), `7` inaktiv,
`8` vorgesehen zum Löschen. `5` und `6` sind die freigegebenen Status. Siehe die
[Status-Codeliste](https://www.xrepository.de/details/urn:xoev-de:xprozess:codeliste:status).
Wiederholbarer Filter (`--freigabe-status`). `freigabe_status_label` enthält die
lesbare Bezeichnung und steht bei Datenschemata, Datenfeldgruppen, Datenfeldern und
Dokumentsteckbriefen; Leistungsteckbriefe, Leistungsstammtexte und Prozesse liefern nur
die Zahl.

**status_gesetzt_durch / _am / _seit / _bis.** Wer den aktuellen Status gesetzt hat und
wann; die Varianten `seit`/`bis` sind Filter für einen Datumsbereich.

**gültig ab / bis (`gueltig_ab` / `gueltig_bis`).** Gültigkeitszeitraum eines Datensatzes;
`--gueltig-am <date>` liefert die Datensätze, die an diesem Datum gültig sind.

**Bezug.** Ein Freitextfeld für Bezüge (z. B. eine Rechtsgrundlage);
`bezug_unterelemente` durchsucht die Bezüge der Unterelemente eines Datenschemas.

**Versionshinweis.** Ein Hinweis, der beschreibt, was sich in einer Version geändert hat.

**Stichwort.** Schlagwort (nur XDF3), z. B. `Anwendungsgebiet::Bundesrepublik`.

**is_latest.** Gibt an, ob ein Datensatz die neueste Version seiner Art ist
(`--is-latest`).

**fts_match.** Bei einem Treffer der Volltextsuche der Ausschnitt bzw. das Feld, das
getroffen wurde.

---

## Such- und API-Konzepte

**Volltextsuche (`fts_query`).** Freitextsuche über eine Ressource;
`suche_nur_in` (`--suche-nur-in`) beschränkt sie auf ein Modul (z. B.
`Rechtsgrundlagen`). Welche Module zulässig sind, hängt von der Ressource ab (Datenschemata
erlauben zusätzlich `Stichwort`).

**order_by.** Sortierung der Ergebnisse. Die zulässigen Werte hängen von der Ressource ab –
die Datenfelder-Ressourcen teilen sich einen Satz (`relevance`, `id_asc`, `name_asc`, …);
Leistungen haben eigene Sätze (u. a. `relevance`, `titel_asc`). `relevance` ordnet die
Treffer einer Suche mit `--fts-query`.

**Offset-Paginierung.** Die v1-/XDatenfelder-Endpoints und die meisten v0-Such-Endpoints
blättern mit `offset` + `limit` (limit `1`–`200`, Standard `200`) und liefern eine
**PaginatedResult**-Hülle (`items`, `offset`, `limit`, `count`,
`total_count`).

**Cursor-Paginierung.** Die XZuFi-Entitätslisten (`organizational-units`,
`specializations`, `online-services`) blättern mit `cursor` + `limit` und liefern eine
**CursorPaginationResult**-Hülle (`items`, `limit`, `count`, `next_cursor`).
Übergeben Sie den zurückgegebenen `next_cursor` beim nächsten Aufruf als `--cursor`.

**Unveränderliche URLs.** Das Portal stellt Codelisten, JSON-Schema- und XSD-Dateien unter
festen URLs bereit, die für den stabilen Produktivbetrieb gedacht sind; die vollständigen
URLs sind in den API-Antworten enthalten.

**Rate-Limiting.** Die API begrenzt Anfragen pro IP-Adresse und antwortet bei
Überschreitung mit **429**; der Client wiederholt 429/503 automatisch mit linearem Backoff
(`--max-retries`).

**Authentifizierte Endpoints (nicht abgedeckt).** Uploads, die Konverter und
Qualitätsprüfungen unter `/tools/*` sowie die Token-Introspection erfordern ein
`Access-Token`. Dieses Tool unterstützt **nur** die offenen Endpoints ohne
Authentifizierung (lesend, `GET`) sowie den öffentlichen CSV-Export.

---

## Download-Formate

**XDF-/XML-Download (`xdf`).** Das native XDatenfelder-XML eines Datenschemas, einer
Datenfeldgruppe, eines Datenfelds oder eines Dokumentsteckbriefs.

**XZuFi-Download (`xzufi`).** Das native XZuFi-XML eines Leistungsstammtexts oder einer
XZuFi-Entität.

**XProzess-Download (`xprozess`).** Das native XProzess-XML eines Prozesses oder einer
Prozessklasse. Laut OpenAPI-Dokument der API antwortet eine Prozessklasse mit JSON, der
Server liefert aber XML; `process-classes xprozess` ist deshalb ein Download wie die anderen.

**PDF-Export (`pdf`).** Ein erzeugtes PDF eines Leistungsteckbriefs oder
Leistungsstammtexts für einen angegebenen **Sprachcode** (z. B. `de-DE`). Das ist nicht
der Wert des Suchfilters `--sprache`: `Deutsch` als Sprachcode endet mit Exit-Code `4`
(„Could not find language“).

**search-csv.** Ein Tools-Endpoint, der ein Suchergebnis als CSV streamt. Sein
`--resource` erwartet die Ressourcennamen des Portals im Singular (`schema`, `field`,
`processclass`, …); auf jeden unbekannten Namen antwortet der Server mit einer CSV der
Leistungen, deshalb weist die CLI solche Namen zurück.

---

> **Bibliothek und Interna.** Begriffe zum TypeScript-Client und seinen Interna –
> `FimPortalClient`, Ressourcengruppen, Request-Engine, Transport, Retry/Backoff,
> Fehlertypen, Query-Builder – stehen jetzt in **[DEVELOPING.md](DEVELOPING.md)** (englisch).
