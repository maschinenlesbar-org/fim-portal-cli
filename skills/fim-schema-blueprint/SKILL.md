---
name: fim-schema-blueprint
description: >
  Turn a FIM data schema (XDatenfelder Datenschema) into a readable form / field
  blueprint, using the fim-portal CLI. Trigger when the user asks "what fields
  are in the Wohngeld schema?", "show the form structure for S00000000159", "list
  the groups and data fields of this schema with their types", "what does a birth
  registration form need?", or wants the data model behind a service laid out as a
  structured outline. Flattens the schema's group/field tree, surfaces each field's
  Feldart / Datentyp / cardinality / code list, and can emit the native XDF XML.
version: 1.0.0
userInvocable: true
---

# FIM Schema Blueprint

Turn a `schemas get` response — a top-level element list plus two flat catalogues
that together encode the nested group/field tree — into a **readable form
blueprint**: the groups, the fields, their
types, cardinalities and code lists, in the order a form would present them.

## Tooling

This skill drives the `fim-portal` command. **Before anything else, validate it is available** — run `command -v fim-portal` (or `fim-portal --version`). If it is not on your PATH, STOP and inform the user that the `fim-portal` CLI (`@maschinenlesbar.org/fim-portal-cli`) is not installed — installing it is their responsibility; never install it yourself, and do not fall back to `npx` or a local `node dist/...` build.

The API is read-only and needs **no key/account/config**. Pass `--compact`. A search with no hits returns `{"items":[],"total_count":0}` and exits `0`; a `get` on a missing id/version exits `4`.

## Step 1 — Resolve the schema id (and version)

A schema id looks like `S00000000159`. If the user gave a topic instead, search —
**always with `--is-latest`** unless they ask for an old version, so you get one row
per schema rather than every historical version:

```bash
fim-portal --compact schemas search --fts-query "Wohngeld" --is-latest --limit 10
```

`items[]` carry `fim_id`, `fim_version`, `name`, `bezeichnung` (often the better,
human title), `freigabe_status_label`, `xdf_version` (`2.0` = XDF2, `3.0.0` = XDF3),
and `steckbrief_id` (the linked document profile, can be `null`). Pick the id; if
several match, show id + name + status and let the user choose.

> **Full-text trap.** `--fts-query` matches text anywhere in the schema, including
> its elements' descriptions, so the top hits can be unrelated. `--fts-query
> "Elterngeld"` returns Wohngeld and Lebensunterhalt schemas that only mention
> Elterngeld as an income type, and no Elterngeld schema. Each hit's `fts_match`
> shows the matched snippet with the term in `[[[…]]]`. Check `name`/`bezeichnung`
> before calling a hit "the" schema, use `--name` (substring of the name) to pin a
> title, and tell the user when no hit is actually about their topic.

> **Version trap.** `get` defaults to `latest`. If the user names a version, pass it
> as a second arg (`schemas get S00000000159 1.0`). To enumerate published versions:
> `fim-portal --compact schemas versions S00000000159`.

## Step 2 — Fetch the full schema

```bash
fim-portal --compact schemas get S00000000159
```

The structure is split across these arrays — know which to use:

| Field | What it is | Use it for |
|---|---|---|
| `children[]` | the schema's **top level only**: ordered elements, each `{ namespace, fim_id, fim_version, type, anzahl, bezug }`. `type` is `"Gruppe"` or `"Feld"`; `anzahl` is the **cardinality** (`"1:1"`, `"0:n"`, …). These nodes have **no** `children` of their own. | the form's top-level *order* |
| `datenfelder[]` | a **flat catalogue** of every field used anywhere, with full detail (`name`, `feldart`, `datentyp`, `code_list_id`, `definition`, `freigabe_status_label`) | looking up a field's type by `fim_id` |
| `datenfeldgruppen[]` | flat catalogue of every group, each with its own ordered `children[]` (same node shape, with `anzahl`) | a group's name, and **the nesting below the top level** |
| `regeln[]` | validation rules `{ fim_id, fim_version }` (ids only — fetch detail separately if asked) | noting that constraints exist |

Top-level metadata to lead with: `name`/`bezeichnung`, `xdf_version`,
`freigabe_status_label`, `steckbrief_name` (can be `null`), `bezug` (legal bases),
`definition`.

> **The join you must do:** the tree isn't in one place. `children[]` holds only the
> top-level elements; the order, nesting and `anzahl` of everything below live in
> each group's `children[]` inside `datenfeldgruppen[]`. Build lookup maps from
> `datenfelder[]` and `datenfeldgruppen[]` keyed by `fim_id`, start at the top-level
> `children[]`, and for every `Gruppe` node recurse into **that group's catalogue
> entry's** `children[]`. Walking `children[]` alone gives only the few top-level
> lines. **Schemas are large** — 100–200 fields and 100+ groups is normal — so
> summarise, don't dump every leaf.

## Step 3 — Build the blueprint

Walk the tree depth-first as described above, indenting by nesting. This `jq`
program prints the whole outline (name, id, `feldart` · `datentyp`, `anzahl`):

```bash
fim-portal --compact schemas get S00000000159 | jq -r '
  (INDEX(.datenfelder[]; .fim_id)) as $f
  | (INDEX(.datenfeldgruppen[]; .fim_id)) as $g
  | def node($d):
      if .type == "Gruppe" then
        "\("   " * $d // "")▸ \($g[.fim_id].name) (\(.fim_id))  \(.anzahl)",
        ($g[.fim_id].children[] | node($d + 1))
      else
        "\("   " * $d // "")• \($f[.fim_id].name) (\(.fim_id))  \($f[.fim_id].feldart) · \($f[.fim_id].datentyp)  \(.anzahl)"
      end;
    .children[] | node(0)'
```

A group reused in several places is printed each time, so the outline is longer
than the field count (about 700 lines for S00000000159). Use it as working data and
present a trimmed version. For each node:

- **Group** (`type: "Gruppe"`): show `name`, `anzahl`, and recurse into its entry in
  `datenfeldgruppen[]`.
- **Field** (`type: "Feld"`): show `name`, `anzahl`, **`feldart`** (`input`,
  `select`, `label`, `hidden`, `locked`), **`datentyp`** (`text`, `date`, `bool`,
  `num`, `num_currency`, `file`, `obj`, …), and `code_list_id` if present (a
  `select` field usually references a code list — note it; resolve the list itself
  with `fim-portal code-lists` only if the user wants the allowed values).

Annotate cardinality plainly: `1:1` required-single, `0:1` optional, `0:n`/`1:n`
repeatable. Element statuses are separate from the schema's own status, so count
them rather than flagging every element (`jq '[.datenfelder[].freigabe_status_label]
| group_by(.) | map({(.[0]): length}) | add'`). A released schema can be built from
unreleased elements: on 2026-09-15 the gold XDF2 schema S05000039 had 28 fields
`in Bearbeitung` and one `inaktiv` (F60000240 Telefon). Name `inaktiv` elements
explicitly.

## Step 4 — Present

A nested outline, structure first, with a header summary:

```
Schema: Erstantrag Wohngeld Mietzuschuss  (S00000000159 v2.0.0, XDF3, Entwurf)
  Steckbrief: D99000000001 · 170 fields in 106 groups · 3 rules
  Legal basis: WoGG, WoGV, § 60 SGB I, …

▸ Antragsteller (G60000000220)            1:1
   • Familienname            (F00000000013)  input · text          1:1
   • Vorname                 (F00000000014)  input · text          1:1
   • Geburtsdatum            (F00000000056)  input · date          1:1
   • Staatsangehörigkeit     (F60000000xxx)  select · text  [→ codelist L…]  0:1
▸ Anschrift (G…)                           1:1
   • …
```

Rules:
- **Lead with totals** (field count, group count, XDF version, status) — that's the
  size/maturity at a glance.
- Resolve every `fim_id` to a name; an outline of bare ids is useless.
- Cap depth/breadth for huge schemas: show the top two levels and the field count
  per group, offering to expand a named group. Don't paste 170 leaves inline.
- Mark cardinality and `select`+codelist fields — those drive form behaviour.
- **Native XML on request:** the official XDatenfelder XML (for a validator or an
  editor) is a *download* — send it to a file:

  ```bash
  fim-portal -o schema.xml schemas xdf S00000000159 2.0.0
  ```

  The same `xdf` download exists for `document-profiles`, `fields` and `groups` —
  but **`fields` and `groups` take a `<namespace>` argument before the id**
  (`fim-portal -o f.xml fields xdf baukasten F00000000013`).
- Don't invent constraints; if a `regel` matters, fetch it rather than guessing.
