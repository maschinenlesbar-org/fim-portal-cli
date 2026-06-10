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

Turn a `schemas get` response — a deep tree of nested groups and fields plus two
flat catalogues — into a **readable form blueprint**: the groups, the fields, their
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
and `steckbrief_id` (the linked document profile). Pick the id; if several match,
show id + name + status and let the user choose.

> **Version trap.** `get` defaults to `latest`. If the user names a version, pass it
> as a second arg (`schemas get S00000000159 1.0`). To enumerate published versions:
> `fim-portal --compact schemas versions S00000000159`.

## Step 2 — Fetch the full schema

```bash
fim-portal --compact schemas get S00000000159
```

The response has three views of the same content — know which to use:

| Field | What it is | Use it for |
|---|---|---|
| `children[]` | the **hierarchical tree**: ordered top-level elements, each `{ fim_id, fim_version, type, anzahl, children? }`. `type` is `"Gruppe"` or `"Feld"`; `anzahl` is the **cardinality** (`"1:1"`, `"0:n"`, …). | the form's *structure & order* |
| `datenfelder[]` | a **flat catalogue** of every field used anywhere, with full detail (`name`, `feldart`, `datentyp`, `code_list_id`, `definition`, `freigabe_status_label`) | looking up a field's type by `fim_id` |
| `datenfeldgruppen[]` | flat catalogue of every group, with its own `children` | looking up a group's name/contents |
| `regeln[]` | validation rules `{ fim_id, fim_version }` (ids only — fetch detail separately if asked) | noting that constraints exist |

Top-level metadata to lead with: `name`/`bezeichnung`, `xdf_version`,
`freigabe_status_label`, `steckbrief_name`, `bezug` (legal bases), `definition`.

> **The join you must do:** `children[]` gives *structure + cardinality* but only
> `fim_id`s; `datenfelder[]`/`datenfeldgruppen[]` give the *names and types*. Build a
> lookup map from the two flat lists keyed by `fim_id`, then walk `children[]`
> recursively, resolving each node's name/type from the map. The tree alone has no
> names; the flat lists alone have no order or cardinality. **Schemas are large** —
> 100–200 fields and 100+ groups is normal — so summarise, don't dump every leaf.

## Step 3 — Build the blueprint

Walk `children[]` depth-first, indenting by nesting. For each node resolve from the
flat catalogues:

- **Group** (`type: "Gruppe"`): show `name`, `anzahl`, and recurse into its fields.
- **Field** (`type: "Feld"`): show `name`, `anzahl`, **`feldart`** (`input`,
  `select`, `label`, `hidden`, `locked`), **`datentyp`** (`text`, `date`, `bool`,
  `num`, `num_currency`, `file`, `obj`, …), and `code_list_id` if present (a
  `select` field usually references a code list — note it; resolve the list itself
  with `fim-portal code-lists` only if the user wants the allowed values).

Annotate cardinality plainly: `1:1` required-single, `0:1` optional, `0:n`/`1:n`
repeatable. Flag fields whose `freigabe_status_label` is not released (e.g.
`Entwurf`) — they're drafts inside the schema.

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
