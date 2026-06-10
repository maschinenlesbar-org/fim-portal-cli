---
name: fim-service-dossier
description: >
  Assemble a complete dossier for a German public administrative service
  (Leistung) from the FIM Portal, using the fim-portal CLI. Trigger when the
  user asks "tell me everything about the Personalausweis service", "what's the
  FIM record for applying for a passport?", "show the legal bases and regional
  texts for service 99008001012012", "which Redaktionen have a text for this
  Leistung?", or wants the profile + its master texts + linked process pulled
  together. Resolves the service profile's cross-references (leistung_stammtexte,
  prozessklasse, OZG) that the bare CLI returns only as raw id lists.
version: 1.0.0
userInvocable: true
---

# FIM Service Dossier

Turn a public service (XZuFi *Leistung*) into one readable briefing — the
profile, its **regional master texts**, legal bases, OZG/SDG classification and
the **linked process** — instead of the raw `service-profiles get` JSON whose
cross-references are just arrays of ids the user can't read.

## Tooling

This skill drives the `fim-portal` command. **Before anything else, validate it is available** — run `command -v fim-portal` (or `fim-portal --version`). If it is not on your PATH, STOP and inform the user that the `fim-portal` CLI (`@maschinenlesbar.org/fim-portal-cli`) is not installed — installing it is their responsibility; never install it yourself, and do not fall back to `npx` or a local `node dist/...` build.

The API is read-only and needs **no API key, no account, no config**. Pass `--compact` so each result is one line, easy to pipe into `jq`. A search that matches nothing returns a valid envelope `{"items":[],"total_count":0,…}` and exits `0` — that is **not** an error, it means "no such service". A `get` on a missing id exits `4` ("not found") with the message on stderr; re-fetch the id from a fresh `search`, ids/versions drift as the catalogue updates.

## Step 1 — Find the service

If the user gave a `Leistungsschlüssel` (a 14-digit LeiKa key like `99008001012012`),
skip to Step 2. Otherwise search by keyword:

```bash
fim-portal --compact service-profiles search --fts-query "Personalausweis" --sprache Deutsch --limit 10
```

Each `items[]` entry carries: `leistungsschluessel`, `title`,
`leistungsbezeichnung` / `leistungsbezeichnung_2` (the citizen-facing name),
`freigabe_status` (+ no label here — see Step 5), `geaendert_datum_zeit`,
`ozg.themenfeld_label`, `rechtsgrundlagen`, and `leistung_stammtexte` (a list of
`[redaktion_id, leistung_id]` pairs). `total_count` is the full match count; the
page is capped by `--limit` (1–200, default 200).

If several match, show the user the candidates (key + name + Themenfeld + status)
and let them pick, or pick the best `--fts-query` hit if intent is clear.

## Step 2 — Pull the full profile

```bash
fim-portal --compact service-profiles get 99008001012012
```

The fields that matter for a dossier:

| Field | Meaning |
|---|---|
| `title` / `leistungsbezeichnung_2` | technical title / citizen-facing name |
| `rechtsgrundlagen` | the legal bases — newline-separated text, often with `gesetze-im-internet.de` links |
| `leistungsadressat` | who it's for (coded: `001` citizen, `002` business, …) |
| `leistungstyp` | `lo` (Leistungsobjekt) / `lov` / `lovd` — granularity of the entry |
| `ozg` | `{ id, leistung, themenfeld, themenfeld_label, vollzugsbehoerden }` |
| `sdg_informationsbereiche` | SDG information areas (`0000000` = none/placeholder) |
| `klassifizierung` | code-list tags (e.g. `pvlagen` life-situation codes) |
| `leistung_stammtexte` | **the regional texts** — array of `{ redaktion_id, id, title, leistungsschluessel }`. This is the cross-reference to resolve in Step 3. |
| `prozessklasse` | linked process class — **often `null`** (most profiles have no process attached); say so rather than implying a process exists |
| `replacements` | superseded-by / supersedes links — surface if non-empty |

## Step 3 — Resolve the master texts (the cross-command join)

`leistung_stammtexte` lists every editorial office (`Redaktion`) that maintains a
descriptive text for this service — one entry per `redaktion_id` (`B100019` is the
federal LeiKa source; `L1000xx` are the Bundesländer; `S1000xx`/`pvog` portal
sources). This is the dossier's real value: **the same service described by many
authorities.**

Don't fetch all of them — there can be 10–20+. Instead:

- **Summarise**: report how many Redaktionen have a text and list them (id +
  `title`), grouping by `redaktion_id` prefix (federal `B…` vs state `L…`).
- **Resolve on demand**: fetch the full text only for the one(s) the user wants
  (default to the federal `B100019`/`leika` entry, which is the canonical one):

  ```bash
  fim-portal --compact service-texts get B100019 110885418 leika
  ```

  The third arg is the **source** — `leika`, `landesredaktion`, or `pvog`. Pick it
  from the `redaktion_id`: `B…` → `leika`; state `L…` editorial offices are
  `landesredaktion`; portal entries are `pvog`. If a `get` 404s with one source,
  the entry belongs to a different source — try `landesredaktion`.

  A master text carries `kurztext` and `volltext` (HTML — strip tags for a plain
  summary), `rechtsgrundlagen`, `leistungsbezeichnung_2`, and its own `ozg` block.

## Step 4 — (Optional) follow the process and PDF

- If `prozessklasse` is non-null, that's the linked higher-level process; fetch it
  with `fim-portal --compact process-classes get <id> <version>` for the procedure.
  Most profiles have no process — don't invent one.
- The portal can render the service as a **citizen-facing PDF**. Offer it as a
  follow-up; it's a *download* command, so it must go to a file:

  ```bash
  fim-portal -o leistung.pdf service-profiles pdf 99008001012012 de-DE
  ```

  The last arg is a **language code** (`de-DE`, `en-GB`, …), distinct from the
  `--sprache` *search* filter (`Deutsch`, `Englisch`). Don't pipe a PDF to stdout.

## Step 5 — Brief the user

Lead with the citizen-facing name and key, then the structured facts, then the
regional-coverage summary. Example shape:

```
Personalausweis — neu wegen falscher Eintragungen   (key 99008001012012)
  Citizen name: „Personalausweis aufgrund veralteter Eintragungen neu beantragen"
  For:          citizens (001)        Status: 6 (technically released)
  OZG:          Querschnittsleistungen (#10119)   SDG: none
  Legal basis:  § 27 Abs. 1 Nr. 1 PAuswG; Personalausweis-Gebührenverordnung
  Process:      none linked
  Regional texts: 6 Redaktionen
    • federal  B100019 (leika)  — canonical
    • states   L100002, L100008, L100039, L100041, L100042
  → fetch any with: service-texts get <redaktion_id> <leistung_id> <source>
```

Rules:
- **Resolve, don't dump.** Translate id-only cross-references into names/counts; a
  raw `leistung_stammtexte` array is unreadable.
- Map `freigabe_status` to its label (`3` Entwurf, `6` technisch freigegeben — the
  profile `get` omits the label; use the value, or the `freigabe_status_label`
  present on master-text records). `freigabe_status: null` means unset.
- Note when `prozessklasse` / `replacements` / `sdg_informationsbereiche` are
  empty rather than silently omitting them.
- Strip HTML from `kurztext`/`volltext` before quoting; never paste raw `<p>` markup.
- Offer the PDF export and the per-Redaktion `service-texts get` as next steps; do
  not fetch every regional text unless asked.
