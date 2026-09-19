---
name: fim-field-finder
description: >
  Find reusable, released FIM data fields and groups (XDatenfelder Bausteine) for
  form modelling, using the fim-portal CLI. Trigger when the user asks "is there a
  standard field for a German tax number?", "find released text-input fields named
  Familienname", "which reusable date fields exist?", "show me data-field groups
  for an address", "what's the FIM field for IBAN?", or wants to reuse catalogue
  building blocks instead of inventing form fields. Filters by Feldart / Datentyp /
  Freigabestatus, ranks by reusability, and handles the namespace + status traps
  the bare search exposes.
compatibility: >
  Requires the `fim-portal` CLI (npm package
  @maschinenlesbar.org/fim-portal-cli) on PATH, installed by the user; the skill
  never installs it. Uses jq for JSON filtering. Network access to fimportal.de.
---

# FIM Field & Group Finder

Help the user **reuse** existing FIM building blocks — data fields and data-field
groups — rather than modelling new ones. The whole job is filtering the large
catalogue down to *released, type-appropriate* candidates and ranking them by how
reusable they are.

## Tooling

This skill drives the `fim-portal` command. **Before anything else, validate it is available** — run `command -v fim-portal` (or `fim-portal --version`). If it is not on your PATH, STOP and inform the user that the `fim-portal` CLI (`@maschinenlesbar.org/fim-portal-cli`) is not installed — installing it is their responsibility; never install it yourself, and do not fall back to `npx` or a local `node dist/...` build.

This skill also filters JSON with `jq`. **Validate it too** — run `command -v jq`. If it is missing, inform the user that `jq` is not installed — installing it is their responsibility; never install it yourself — and carry on without it: filter the CLI output with `node -e` instead (Node is already on your PATH, since the CLI runs on it).

The API is read-only and needs **no key/account/config**. Pass `--compact`. A search with no hits returns `{"items":[],"total_count":0}` and exits `0` — that's "no matching field", a valid answer.

## Step 1 — Translate the need into filters

Map the user's request onto the field filters before searching:

- **Topic** → `--fts-query "<text>"` and/or `--name "<text>"` (`--name` is a
  contains-match on the field name; `--fts-query` is broader full-text).
- **Kind** → `--feldart`: `input` (free entry), `select` (choose from a code list),
  `label`, `hidden`, `locked`.
- **Data type** → `--datentyp`: `text`, `text_latin`, `date`, `time`, `datetime`,
  `bool`, `num`, `num_int`, `num_currency`, `file`, `obj`.
- **Only reusable/released** → `--freigabe-status` (repeatable). The codes, with the
  `freigabe_status_label` the API returns:

  | Code | Label | Reusable? |
  |---|---|---|
  | `1` | in Planung | no |
  | `2` | in Bearbeitung | no (most XDF2 fields sit here) |
  | `3` | Entwurf | no, a draft |
  | `4` | methodisch freigegeben | methodically checked, not yet fachlich released |
  | `5` | fachlich freigegeben (silber) | yes |
  | `6` | fachlich freigegeben (gold) | yes, the highest release |
  | `7` | inaktiv | **no**, retired |
  | `8` | vorgesehen zum Löschen | no, marked for deletion |

  For "released only", pass `--freigabe-status 5 --freigabe-status 6`. Never treat
  `7` as usable.
- **Latest only** → `--is-latest` (one row per field id, newest version) — almost
  always wanted; without it you get every historical version of each field.
- **Owning domain** → `--nummernkreis <prefix>` (prefix match, repeatable;
  `00000` is the central reusable Baukasten).

```bash
fim-portal --compact fields search \
  --fts-query "Familienname" --feldart input --datentyp text \
  --freigabe-status 5 --freigabe-status 6 --is-latest --limit 20
```

## Step 2 — Read the results

`items[]` each carry the fields that matter for reuse:

| Field | Meaning |
|---|---|
| `fim_id` | the field id (`F…`) — what you reference to reuse it |
| `namespace` | the namespace (in practice `baukasten`, for domain fields too) — **required** to fetch this field later |
| `fim_version` | version; `is_latest` flags the newest |
| `name` / `definition` | label and what it captures |
| `feldart` / `datentyp` | kind and type (confirm they match the need) |
| `freigabe_status` / `freigabe_status_label` | release state — prefer released |
| `code_list_id` | for `select` fields, the referenced code list's id (search results only — see the trap below) |
| `nummernkreis` | owning number range (`00000` = central Baukasten) |
| `bezug` | references to XÖV core components / legal bases — a reuse signal |

`total_count` is the full match count; only `--limit` items (1–200) come back per page.
Page with `--offset` if needed.

> **Traps.**
> - `fields` (and `groups`) `get`/`versions`/`xdf` take a **`<namespace>` argument
>   *before* the id** — e.g. `fim-portal fields get baukasten F00000000013`. Carry
>   the `namespace` from the search result; omitting it is the most common mistake.
> - `--name` is a substring match, not exact — "Name" matches "Familienname",
>   "Vorname", etc. Use `--fts-query` for concept search, `--name` to pin a label.
> - Without `--is-latest` the same field appears many times (one per version);
>   always dedupe to latest unless the user wants version history.
> - `fields get` differs from the search row. It returns `code_list_id: null` and
>   carries the list as a `code_list` object (`id`, `name`, `version`, `url`), and it
>   embeds `schemas[]`, every schema version that uses the field. For a widely used
>   field that runs past 1 MB (F60000236 Staatsangehörigkeit: 148 schema versions,
>   about 1.2 MB on 2026-09-15). Read the code list with `jq '.code_list'` and count usage
>   with `jq '.schemas | length'` rather than printing the whole response.

## Step 3 — Groups too, when a single field won't do

If the user needs a *bundle* (a full address, a person's name), search
**data-field groups** — same shared filters, no `--feldart`/`--datentyp`:

```bash
fim-portal --compact groups search --fts-query "Anschrift" --is-latest --freigabe-status 6 --limit 10
```

A group `get` returns its `children` (the fields/sub-groups it bundles) — fetch it
(`fim-portal groups get <namespace> G…`) to show what reusing the group brings in.

## Step 4 — Rank and present

Rank candidates by reusability, most reusable first:

1. **Released** (`freigabe_status` `6` gold, then `5` silber) over everything else;
   `4` methodisch freigegeben next; drop `7` inaktiv and `8` unless asked.
2. **Central Baukasten** (`nummernkreis` `00000`) over domain-specific copies, but
   only between fields of the same status. Status wins: the released field isn't
   always in `00000`. For Staatsangehörigkeit the released `select` field is
   F60000236 (`nummernkreis` `60000`, gold), while the `00000` field F00000000039
   is an `Entwurf`. `namespace` doesn't tell them apart (both are `baukasten`).
3. **Type match** to the stated need (`feldart` + `datentyp` exactly as asked).
4. Carrying a `bezug` to an XÖV core component (well-grounded, widely reused).

```
Reusable fields for „Familienname" (input · text, released, latest)

 1. F00000000013  Familienname        baukasten · input · text · status 6
    „Familienname einer natürlichen Person…"  ref: XÖV NameNatuerlichePerson
 2. F60000000xxx  Geburtsname         baukasten · input · text · status 6
 …
 (6920 fields match the broad type filter — narrow with --fts-query/--name)
```

Rules:
- **Lead with the canonical hit** (released, Baukasten, exact type) and give its
  `fim_id` + `namespace` — that pair is what the user needs to reuse it.
- Show `feldart`/`datentyp`/status and a one-line `definition` per candidate; flag
  `select` fields' `code_list_id`.
- State `total_count` and warn when a bare type filter returns thousands — push the
  user to add `--fts-query`/`--name` rather than paging blindly.
- Offer next steps: `fields get <namespace> <id>` for full detail, `fields xdf
  <namespace> <id> -o f.xml` for the XML, or `groups …` if a field bundle fits better.
- Don't recommend a field below status `5` (e.g. `3` Entwurf) as "the" field without
  flagging it's unreleased, and never recommend an `inaktiv` (`7`) one.
