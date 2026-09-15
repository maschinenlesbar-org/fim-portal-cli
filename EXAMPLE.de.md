# Beispiele

Echte Beispiele für die Claude-Code-Skills des Plugins `fim-portal`, eines pro Skill: eine
Anfrage, die `fim-portal`-Befehle, die der Skill ausgeführt hat, und Claudes Antwort.

Jedes Beispiel lief am 15. September 2026 mit `fim-portal` 0.0.9 gegen die Live-API.
Die Daten ändern sich, Ihre Ergebnisse werden also abweichen; mit den gezeigten IDs und
Schlüsseln können Sie die Anfragen selbst ausprobieren. Lange Listen sind gekürzt.

Zum Ausprobieren installieren Sie die CLI und das Plugin – siehe [SKILLS.md](SKILLS.md) (englisch).

Skills: [fim-field-finder](#fim-field-finder) · [fim-quality-audit](#fim-quality-audit) · [fim-schema-blueprint](#fim-schema-blueprint) · [fim-service-dossier](#fim-service-dossier)

## fim-field-finder

> Gibt es ein freigegebenes, wiederverwendbares FIM-Auswahlfeld für die Staatsangehörigkeit mit hinterlegter Codeliste?

```bash
fim-portal --compact fields search --fts-query "Staatsangehörigkeit" --feldart select --freigabe-status 5 --freigabe-status 6 --freigabe-status 7 --is-latest --limit 50
fim-portal --compact fields search --name "Staatsangehörigkeit" --is-latest --limit 50   # 86 Treffer
fim-portal --compact fields search --freigabe-status 7 --is-latest --limit 1            # Label: „inaktiv"
fim-portal --compact fields get baukasten F60000236
fim-portal --compact fields get baukasten F00000001839
fim-portal --compact fields get baukasten F00000000039
```

Der Freigabe-Filter ließ 4 Felder übrig, zwei davon ohne Bezug zum Thema. Status 7 heißt
„inaktiv", also zählen nur 5 (silber) und 6 (gold) als freigegeben. Die Namenssuche fand 86
aktuelle Felder. Die erste Seite bestand überwiegend aus XDF2-Kopien „in Bearbeitung", und das
zentrale Baukasten-Feld `Staatsangehörigkeit` (F00000000039) tauchte dort als Entwurf auf. Der
maßgebliche Treffer ist daher das Gold-Feld aus dem Nummernkreis 60000, nicht das aus 00000.
`fields get` listet alle Schemata, die ein Feld verwenden – das hat der Skill als
Wiederverwendungssignal genutzt.

```
Wiederverwendbare Auswahlfelder für „Staatsangehörigkeit" (select · text, freigegeben, aktuell)

 1. F60000236  v1.4    Staatsangehörigkeit            baukasten · NK 60000 · select · text · Status 6 (gold) · XDF 2.0
    „Die Staatsangehörigkeit beschreibt den/die Staat(en), dem/denen ein Bürger juristisch zugehörig ist (Wahlrecht etc.)."
    Bezug: XOEV.Kernkomponente.NatuerlichePerson.staatsangehoerigkeit · Codeliste 12451 (Destatis
    Staatsangehörigkeit, Version 2023-02-24) · in 140 Schemata verwendet
 2. F00000001839  v1.0.0  Frühere Staatsangehörigkeit  baukasten · NK 00000 · select · text · Status 6 (gold) · XDF 3.0.0
    Codeliste 15830 (dieselbe Destatis-Liste, 2023-02-24) · in 7 Schemata verwendet · kein Bezug
 ⚠ F00000000039  v2.1.0  Staatsangehörigkeit          baukasten · NK 00000 · XDF 3.0.0 · Status 3 Entwurf
    zentrales XDF3-Feld mit derselben Definition, noch Entwurf, ältere Codeliste 15917 (2020-05-11), 8 Schemata

 Weitere freigegebene Auswahlfelder betreffen nicht die Staatsangehörigkeit: F00000003381 Zweck des
 Aufenthalts (Schweiz), F00000003398 Status des Antragstellers gemäß Assoziationsabkommen EWG/Türkei.
```

Als Nächstes angeboten: `fim-portal -o staatsangehoerigkeit.xml fields xdf baukasten F60000236` oder `groups search`, falls ein ganzer Personenblock besser passt.

## fim-quality-audit

> Wir möchten das FIM-Schema für die Daueraufenthaltsbescheinigung nachnutzen. Bitte vorher eine Qualitätsprüfung.

```bash
fim-portal --compact schemas search --fts-query "Daueraufenthaltsbescheinigung" --is-latest --limit 10
fim-portal --compact schemas versions S00000000239
fim-portal --compact schemas quality-report S00000000239 latest
fim-portal --compact schemas get S00000000239                      # um die gemeldeten IDs zu benennen
```

Drei Schemata passten. Das XDF3-Schema S00000000239 ist das einzige freigegebene Antragsformular
für die Bescheinigung; die anderen beiden sind die XDF2-Daueraufenthaltskarte (S00000235) und ein
XDF2-Entwurf (S00000239). Es gibt nur eine Version (1.1.0). Der Bericht enthält nur IDs, deshalb
hat der Skill sie mit dem Feld- und Gruppenkatalog des Schemas verknüpft, um Namen anzuzeigen.

```
Qualitätsprüfung: Antrag auf Ausstellung einer Daueraufenthaltsbescheinigung
                  (S00000000239 v1.1.0, XDF3, fachlich freigegeben (gold))
  14 Befunde: 0 Fehler, 14 Warnungen → nachnutzbar mit Hinweisen
  (59 Felder, 19 Gruppen; 13 Feld-Befunde, 1 Gruppen-Befund)

  Häufigste Probleme:
   • 9× Warnung 1101  leerer Bezug bei harmonisiertem Feld („Leerer Bezug bei Feld … mit Typ `harmonisiert`")
        F00000001839 Frühere Staatsangehörigkeit, F60000000231/232/233 Tag/Monat/Jahr,
        F60000000263 Abfrage Anschrift Inland oder Ausland, F60000000350 Betreuungsurkunde … (+3 weitere)
   • 3× Warnung 1103  kein Wertebereich („Kein Wertebereich … angegeben")
        F00000003244 Einreisedatum, F60000000048 Anfang, F60000000049 Ende
   • 1× Warnung 1102  keine Mindest-/Höchstlänge: F00000003247 Grund (Sonstiges)
   • 1× Warnung 1106  Gruppe mit nur einem Unterelement: G60000000092 Anschriftzone
  Regeln: 22 geprüft, alle ohne Befund.   Schema-Ebene: ohne Befund.
```

Als Nächstes angeboten: `fim-portal fields get baukasten F00000003244`, um zu sehen, warum das Einreisedatum keinen Wertebereich hat. Da es nur diese Version gibt, fehlt eine Alternative zum Vergleich.

## fim-schema-blueprint

> Was fragt das FIM-Formular zur Anmeldung eines Hundes zur Hundesteuer ab?

```bash
fim-portal --compact schemas search --fts-query "Hundesteuer" --is-latest --limit 10
fim-portal --compact schemas get S05000039
```

Die Suche fand 7 Schemata rund um Hunde. `S05000039 Anmeldung zur Hundesteuer` ist die Anmeldung
(gold). In dieser Antwort enthält der `children[]`-Baum nur die 4 obersten Knoten ohne
Verschachtelung. Deshalb hat der Skill die eigenen `children` jeder Gruppe in
`datenfeldgruppen[]` durchlaufen, um die Gliederung aufzubauen.

```
Schema: Anmeldung zur Hundesteuer  (S05000039 v1.1, XDF2, fachlich freigegeben (gold))
  Kein Steckbrief verknüpft · 29 Felder in 15 Gruppen · 1 Regel (R05000237)
  Rechtsgrundlage: Hundesteuergesetze bzw. Kommunalabgabengesetze der Länder (kommunale Steuer)
  ⚠ Im Gold-Schema sind 28 Felder und alle 15 Gruppen „in Bearbeitung"; Telefon (F60000240) ist „inaktiv"

• Einwilligungserklärungstext Verarbeitung personenbezogener Daten (F05000698)  select · text [→ Codeliste 777]  1:1
▸ Antragstellende Person (G05000276)  1:1
   ▸ Persönliche Angaben (Familienname & Vorname) (G05000366): Familienname, Vorname   input · text  1:1
   ▸ Anschrift Inland Straßenanschrift (G05000527): Straße, Hausnummer, Hausnummerzusatz 0:1,
     Postleitzahl, Ort, Anschrift Zusatzangaben 0:1                         input · text
   ▸ Kommunikation (Telefon/E-Mail) (G05000528): Telefon (F60000240) 0:1 ⚠ inaktiv, E-Mail (F05001109) 0:1
▸ Anzahl (Hund) (G05000434)  1:1
   • Weiterleitung der Daten (F05000728)          select · text [→ Codeliste 1443]  1:1
   • Anzahl Hunde (Antragsstellung) (F05000977)   input · num_int  1:1
   • Anzahl gehaltener Hunde (F05000791)          input · num      1:1
▸ Angaben (Hund Steueranmeldung) (G05000442)  1:1
   ▸ Steuer-ID (Hund) (G05000436): Akten- / Kassenzeichen, Name des Hundes,
     Mikrochipkennzeichnung des Hundes                                      input · text  je 0:1
   ▸ Angaben zum Hund (Mittel) (G05000319): Geburtsdatum des Hundes (date, 0:1), Hunderasse (text, 1:1)
   ▸ Abweichende Anschrift des Hundes (G05000337): Abweichender Haltungsort (bool, 1:1)
     + optionale Anschriftsgruppe G05000529 (0:1, eigene 05000-Kopien von Straße/Ort)
   ▸ Grund für die Ermäßigung oder Befreiung von der Hundesteuer (G05000340)  1:1
      • Auswahl des Grundes … (F05000802)          select · text [→ Codeliste 1844]  1:1
      • Weiterer Grund … (F05000803)               input · text  0:1
      • Unterlagen … (F05000804)                   input · file  1:1
```

Als Nächstes angeboten: `fim-portal -o hundesteuer.xml schemas xdf S05000039 1.1` oder eine beliebige Gruppe bis auf Feldebene aufklappen.

## fim-service-dossier

> Alles zur FIM-Leistung, mit der Deutsche mit Wohnsitz im Ausland einen Personalausweis beantragen.

```bash
fim-portal --compact service-profiles search --fts-query "Personalausweis" --sprache Deutsch --limit 10
fim-portal --compact service-profiles get 99008001012011
fim-portal --compact service-texts get B100019 102241587 leika     # Exit 4: nicht unter dieser Quelle
fim-portal --compact service-texts search --leistungsschluessel 99008001012011 --limit 50
fim-portal --compact service-texts get B100019 102241587 pvog
```

Die Suche fand 52 Leistungen; `99008001012011` ist die für Menschen mit Wohnsitz im Ausland.
Der Bundestext lag nicht unter `leika`. Deshalb hat der Skill zuerst nachgesehen, zu welcher
Quelle jeder Text gehört, und ihn dann abgerufen.

```
Personalausweis für Deutsche mit Wohnsitz im Ausland   (Schlüssel 99008001012011)
  Bezeichnung:  „Personalausweis für deutsche Staatsangehörige mit ständigem Wohnsitz
                beziehungsweise gewöhnlichem Aufenthalt im Ausland beantragen"
  Für:          Bürgerinnen und Bürger (001)   Typ: lovd   Status: 6 (technisch freigegeben), geändert 2026-04-20
  OZG:          Personalausweis (#10119), Querschnittsleistungen     SDG: 1010100
  Rechtsgrundlagen: PAuswG §§ 1(4) Nr. 2, 5(2) Nr. 9, 7(2), 8(2)(4), 23(4), 35; KonsG § 2;
                PAuswVwV G.5.2.1/G.5.2.2; Personalausweis- und eID-Karten-Gebührenverordnung
  Prozess:      keiner verknüpft   Ersetzungen: keine
  Regionale Texte: 9 Redaktionen
    • Bund     B100019 (pvog) – maßgeblich
    • Länder   L100002, L100008, L100010, L100012, L100038, L100039, L100040 (landesredaktion)
    • Berlin   L100108 (pvog) – gilt auch für in Berlin nicht gemeldete Personen und Touristen
  Kurzfassung (Bund): Antrag persönlich bei der deutschen Auslandsvertretung, die für den
    Wohnort zuständig ist; aus wichtigem Grund auch in jedem Bürgeramt in Deutschland – den
    Grund vorher telefonisch mit dem Amt klären.
  → jeden Text abrufen mit: service-texts get <redaktion_id> <leistung_id> <source>
```

Als Nächstes angeboten: das PDF für Bürgerinnen und Bürger
(`fim-portal -o leistung.pdf service-profiles pdf 99008001012011 de-DE`) oder der eigene Text eines Landes.
