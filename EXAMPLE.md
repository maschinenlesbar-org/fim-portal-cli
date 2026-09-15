# Examples

Real examples for the Claude Code skills of the `fim-portal` plugin, one per skill: a request,
the `fim-portal` commands the skill ran, and the answer Claude gave.

Every example ran against the live API on 15 September 2026 with `fim-portal` 0.0.9.
The data changes, so your results will differ; the ids and keys shown work for trying the
requests yourself. Long lists are shortened.

To try them, install the CLI and the plugin — see [SKILLS.md](SKILLS.md).

Skills: [fim-field-finder](#fim-field-finder) · [fim-quality-audit](#fim-quality-audit) · [fim-schema-blueprint](#fim-schema-blueprint) · [fim-service-dossier](#fim-service-dossier)

## fim-field-finder

> Is there a released, reusable FIM select field for nationality (Staatsangehörigkeit) with a code list behind it?

```bash
fim-portal --compact fields search --fts-query "Staatsangehörigkeit" --feldart select --freigabe-status 5 --freigabe-status 6 --freigabe-status 7 --is-latest --limit 50
fim-portal --compact fields search --name "Staatsangehörigkeit" --is-latest --limit 50   # 86 hits
fim-portal --compact fields search --freigabe-status 7 --is-latest --limit 1            # label: "inaktiv"
fim-portal --compact fields get baukasten F60000236
fim-portal --compact fields get baukasten F00000001839
fim-portal --compact fields get baukasten F00000000039
```

The released filter left 4 fields, two of them unrelated. Status 7 turned out to be labelled
"inaktiv", so only 5 (silber) and 6 (gold) count as released. The name search matched 86 latest
fields. Its first page was mostly XDF2 copies "in Bearbeitung", and the central-Baukasten
`Staatsangehörigkeit` (F00000000039) turned up there as a draft. So the canonical hit is the
gold field from number range 60000, not the 00000 one. `fields get` lists every schema that uses
a field, which the skill used as a reuse signal.

```
Reusable select fields for „Staatsangehörigkeit" (select · text, released, latest)

 1. F60000236  v1.4    Staatsangehörigkeit            baukasten · nk 60000 · select · text · status 6 (gold) · XDF 2.0
    „Die Staatsangehörigkeit beschreibt den/die Staat(en), dem/denen ein Bürger juristisch zugehörig ist (Wahlrecht etc.)."
    ref: XOEV.Kernkomponente.NatuerlichePerson.staatsangehoerigkeit · code list 12451 (Destatis
    Staatsangehörigkeit, version 2023-02-24) · used in 140 schemas
 2. F00000001839  v1.0.0  Frühere Staatsangehörigkeit  baukasten · nk 00000 · select · text · status 6 (gold) · XDF 3.0.0
    code list 15830 (same Destatis list, 2023-02-24) · used in 7 schemas · no bezug
 ⚠ F00000000039  v2.1.0  Staatsangehörigkeit          baukasten · nk 00000 · XDF 3.0.0 · status 3 Entwurf
    the central XDF3 field with the same definition, still a draft, on the older code list 15917 (2020-05-11), 8 schemas

 Other released select hits are not about nationality: F00000003381 Zweck des Aufenthalts (Schweiz),
 F00000003398 Status des Antragstellers gemäß Assoziationsabkommen EWG/Türkei.
```

Next steps offered: `fim-portal -o staatsangehoerigkeit.xml fields xdf baukasten F60000236`, or `groups search` if a whole person block fits better.

## fim-quality-audit

> We want to reuse the FIM schema for the Daueraufenthaltsbescheinigung. Run a quality check first.

```bash
fim-portal --compact schemas search --fts-query "Daueraufenthaltsbescheinigung" --is-latest --limit 10
fim-portal --compact schemas versions S00000000239
fim-portal --compact schemas quality-report S00000000239 latest
fim-portal --compact schemas get S00000000239                      # to name the flagged ids
```

Three schemas matched. The XDF3 one, S00000000239, is the only released application form for
the Bescheinigung; the other two are the XDF2 Daueraufenthaltskarte (S00000235) and an XDF2 draft
(S00000239). It has one version (1.1.0). The report gives only ids, so the skill joined them
against the schema's field and group catalogue to show names.

```
Quality audit: Antrag auf Ausstellung einer Daueraufenthaltsbescheinigung
               (S00000000239 v1.1.0, XDF3, fachlich freigegeben (gold))
  14 findings: 0 errors, 14 warnings → reusable with caveats
  (59 fields, 19 groups; 13 field findings, 1 group finding)

  Top issues:
   • 9× warning 1101  empty Bezug on a harmonised field ("Leerer Bezug bei Feld … mit Typ `harmonisiert`")
        F00000001839 Frühere Staatsangehörigkeit, F60000000231/232/233 Tag/Monat/Jahr,
        F60000000263 Abfrage Anschrift Inland oder Ausland, F60000000350 Betreuungsurkunde … (+3 more)
   • 3× warning 1103  no value range ("Kein Wertebereich … angegeben")
        F00000003244 Einreisedatum, F60000000048 Anfang, F60000000049 Ende
   • 1× warning 1102  no min/max length: F00000003247 Grund (Sonstiges)
   • 1× warning 1106  group with a single child: G60000000092 Anschriftzone
  Rules: 22 checked, all clear.   Schema-level: all clear.
```

Next steps offered: `fim-portal fields get baukasten F00000003244` to see why the entry date has no range. This is the only version, so there is no alternative to compare.

## fim-schema-blueprint

> What does the FIM form for registering a dog for Hundesteuer ask for?

```bash
fim-portal --compact schemas search --fts-query "Hundesteuer" --is-latest --limit 10
fim-portal --compact schemas get S05000039
```

The search found 7 dog-related schemas. `S05000039 Anmeldung zur Hundesteuer` is the
registration (gold). In this response the `children[]` tree has only the 4 top-level nodes with
no nesting, so the skill walked each group's own `children` in `datenfeldgruppen[]` to rebuild
the outline.

```
Schema: Anmeldung zur Hundesteuer  (S05000039 v1.1, XDF2, fachlich freigegeben (gold))
  No Steckbrief linked · 29 fields in 15 groups · 1 rule (R05000237)
  Legal basis: Hundesteuergesetze bzw. Kommunalabgabengesetze der Länder (a municipal tax)
  ⚠ Inside the gold schema, 28 fields and all 15 groups are "in Bearbeitung"; Telefon (F60000240) is "inaktiv"

• Einwilligungserklärungstext Verarbeitung personenbezogener Daten (F05000698)  select · text [→ codelist 777]  1:1
▸ Antragstellende Person (G05000276)  1:1
   ▸ Persönliche Angaben (Familienname & Vorname) (G05000366): Familienname, Vorname   input · text  1:1
   ▸ Anschrift Inland Straßenanschrift (G05000527): Straße, Hausnummer, Hausnummerzusatz 0:1,
     Postleitzahl, Ort, Anschrift Zusatzangaben 0:1                         input · text
   ▸ Kommunikation (Telefon/E-Mail) (G05000528): Telefon (F60000240) 0:1 ⚠ inaktiv, E-Mail (F05001109) 0:1
▸ Anzahl (Hund) (G05000434)  1:1
   • Weiterleitung der Daten (F05000728)          select · text [→ codelist 1443]  1:1
   • Anzahl Hunde (Antragsstellung) (F05000977)   input · num_int  1:1
   • Anzahl gehaltener Hunde (F05000791)          input · num      1:1
▸ Angaben (Hund Steueranmeldung) (G05000442)  1:1
   ▸ Steuer-ID (Hund) (G05000436): Akten- / Kassenzeichen, Name des Hundes,
     Mikrochipkennzeichnung des Hundes                                      input · text  0:1 each
   ▸ Angaben zum Hund (Mittel) (G05000319): Geburtsdatum des Hundes (date, 0:1), Hunderasse (text, 1:1)
   ▸ Abweichende Anschrift des Hundes (G05000337): Abweichender Haltungsort (bool, 1:1)
     + optional address group G05000529 (0:1, its own 05000 copies of Straße/Ort)
   ▸ Grund für die Ermäßigung oder Befreiung von der Hundesteuer (G05000340)  1:1
      • Auswahl des Grundes … (F05000802)          select · text [→ codelist 1844]  1:1
      • Weiterer Grund … (F05000803)               input · text  0:1
      • Unterlagen … (F05000804)                   input · file  1:1
```

Next steps offered: `fim-portal -o hundesteuer.xml schemas xdf S05000039 1.1`, or expanding any group to field level.

## fim-service-dossier

> Tell me everything about the FIM service for Germans living abroad who need a Personalausweis.

```bash
fim-portal --compact service-profiles search --fts-query "Personalausweis" --sprache Deutsch --limit 10
fim-portal --compact service-profiles get 99008001012011
fim-portal --compact service-texts get B100019 102241587 leika     # exit 4: not under this source
fim-portal --compact service-texts search --leistungsschluessel 99008001012011 --limit 50
fim-portal --compact service-texts get B100019 102241587 pvog
```

The search matched 52 services; `99008001012011` was the one for residents abroad. The
federal text wasn't under `leika`, so the skill looked up which source each text belongs to
before fetching it.

```
Personalausweis für Deutsche mit Wohnsitz im Ausland   (key 99008001012011)
  Citizen name: „Personalausweis für deutsche Staatsangehörige mit ständigem Wohnsitz
                beziehungsweise gewöhnlichem Aufenthalt im Ausland beantragen"
  For:          citizens (001)     Type: lovd     Status: 6 (technically released), changed 2026-04-20
  OZG:          Personalausweis (#10119), Querschnittsleistungen     SDG: 1010100
  Legal basis:  PAuswG §§ 1(4) Nr. 2, 5(2) Nr. 9, 7(2), 8(2)(4), 23(4), 35; KonsG § 2;
                PAuswVwV G.5.2.1/G.5.2.2; Personalausweis- und eID-Karten-Gebührenverordnung
  Process:      none linked        Replacements: none
  Regional texts: 9 Redaktionen
    • federal  B100019 (pvog) — canonical
    • states   L100002, L100008, L100010, L100012, L100038, L100039, L100040 (landesredaktion)
    • Berlin   L100108 (pvog) — also covers people not registered in Berlin and tourists
  Federal summary: apply in person at the German mission abroad responsible for your place
    of residence; with an important reason you can also apply at any Bürgeramt in Germany,
    but agree that reason with the office by phone first.
  → fetch any text with: service-texts get <redaktion_id> <leistung_id> <source>
```

Next steps offered: the citizen PDF (`fim-portal -o leistung.pdf service-profiles pdf 99008001012011 de-DE`)
or a state's own text.
