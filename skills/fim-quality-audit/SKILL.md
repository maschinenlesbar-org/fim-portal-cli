---
name: fim-quality-audit
description: >
  Audit the data quality of a FIM data schema and produce a ranked findings
  report, using the fim-portal CLI. Trigger when the user asks "is this schema
  clean?", "run a quality check on S00000000159", "what's wrong with the Wohngeld
  schema?", "which fields are missing a Wertebereich?", "any errors in this
  schema before we reuse it?", or wants FITKO's completeness/consistency findings
  summarised. Aggregates the quality-report's per-group / per-field / per-rule
  failing checks into counts by severity and the most common problems, instead of
  the flat blob the bare CLI prints.
compatibility: >
  Requires the `fim-portal` CLI (npm package
  @maschinenlesbar.org/fim-portal-cli) on PATH, installed by the user; the skill
  never installs it. Uses jq for JSON filtering. Network access to fimportal.de.
---

# FIM Schema Quality Audit

Run a schema through the FIM Portal's quality report and turn the long, flat list
of per-element findings into a **ranked, deduplicated audit**: how many problems,
how severe, which elements, and which issue types dominate.

## Tooling

This skill drives the `fim-portal` command. **Before anything else, validate it is available** — run `command -v fim-portal` (or `fim-portal --version`). If it is not on your PATH, STOP and inform the user that the `fim-portal` CLI (`@maschinenlesbar.org/fim-portal-cli`) is not installed — installing it is their responsibility; never install it yourself, and do not fall back to `npx` or a local `node dist/...` build.

This skill also filters JSON with `jq`. **Validate it too** — run `command -v jq`. If it is missing, inform the user that `jq` is not installed — installing it is their responsibility; never install it yourself — and carry on without it: filter the CLI output with `node -e` instead (Node is already on your PATH, since the CLI runs on it).

The API is read-only and needs **no key/account/config**. Pass `--compact`. A `get`/report on a missing id or version exits `4`; a search with no hits returns `{"items":[],"total_count":0}` and exits `0`.

## Step 1 — Resolve the schema (latest unless told otherwise)

If given an id (`S00000000159`), skip ahead. Otherwise:

```bash
fim-portal --compact schemas search --fts-query "Wohngeld" --is-latest --limit 10
```

Pick `fim_id` from `items[]` (each has `name`/`bezeichnung`, `fim_version`,
`freigabe_status_label`, `xdf_version`). If several match, list and let the user
choose. `--fts-query` also matches text inside a schema's elements, so hits can be
unrelated (`"Elterngeld"` returns only Wohngeld and Lebensunterhalt schemas that
mention it). Check `name`/`bezeichnung` and the `fts_match` snippet before auditing
a hit, or pin the title with `--name`. The audit runs against a **version**; default `latest`, or take a specific
one from `schemas versions <id>`.

## Step 2 — Pull the quality report

```bash
fim-portal --compact schemas quality-report S00000000159 latest
```

The response shape:

| Field | Meaning |
|---|---|
| `total_checks` | total findings across all buckets |
| `total_group_checks` / `total_field_checks` / `total_rule_checks` | per-bucket totals |
| `schema_checks[]` | findings on the schema itself (often `[]`) |
| `group_reports[]` | `{ identifier:{id,version}, failing_checks[] }` per group |
| `field_reports[]` | same shape, per field |
| `rule_reports[]` | same shape, per validation rule |

Each entry in a `failing_checks[]` array is `{ code, error_type, message }`:

- `code` — a numeric check id (e.g. `1103`, `1106`).
- `error_type` — **the severity**, the field to rank on. The API spec allows
  `"critical"` (must-fix, e.g. code `1005` "Ungültige URN"), `"warning"` (advisory),
  `"method"` and `"info"`. There is **no `"error"` value**. Count whatever values
  occur instead of testing for fixed ones.
- `message` — German text, e.g. *"Kein Wertebereich bei Feld F… angegeben."*
  (no value range / code list on a field) or *"Gruppe G… hat 1 Unterelement(e).
  Es sollten mehr als 1 sein."* (a group with a single child).

> **Trap: the report buries severity.** `total_checks` counts *all* findings, most
> of which are usually `warning`s. Don't report "77 problems" as if the schema is
> broken — split by `error_type` first. A schema with 0 critical and 77 warnings
> is reusable-with-notes, not failing. The reverse also happens: S05000039 has
> `total_checks: 1`, and that one finding is `critical` — an audit that only counts
> `"error"`/`"warning"` would call it clean. A report can also be **all-clean**
> (`failing_checks: []` everywhere, `total_checks: 0`, even with dozens of
> `*_reports[]` entries) — say "passed, no findings".
>
> `rule_reports[]` isn't limited to the schema's own `regeln[]` from `schemas get`:
> S00000000239 has `regeln: []` but 22 rule reports. Don't cross-check the two.

## Step 3 — Aggregate and rank

Flatten every `failing_checks` across `schema_checks`, `group_reports`,
`field_reports`, `rule_reports`, tagging each with the element id it came from. This
`jq` program does it and groups the result by severity, then by code:

```bash
fim-portal --compact schemas quality-report S00000000159 latest | jq '
  [ (.schema_checks[] | {id: "schema", check: .}),
    ((.group_reports[], .field_reports[], .rule_reports[])
       | .identifier.id as $id | .failing_checks[] | {id: $id, check: .}) ]
  | group_by(.check.error_type)
  | map({error_type: .[0].check.error_type, count: length,
         issues: (group_by(.check.code)
                  | map({code: .[0].check.code, count: length,
                         example: .[0].check.message, ids: (map(.id) | unique)})
                  | sort_by(-.count))})'
```

It prints `[]` for a clean report. Then:

1. **Count by `error_type`** → headline: *N critical, M warnings* (plus any `method`
   / `info`) over `total_checks`.
2. **Group by `code` / message pattern** → the recurring issues (e.g. "40× missing
   Wertebereich", "2× single-child group"). These are the systemic problems worth
   fixing once.
3. **List the offending elements** per top issue (the `identifier.id`s), capped —
   show the first handful and a "+N more" count, not all 170 fields.
4. Lead `critical` first, then `warning`, then `method` / `info`; within each,
   most-frequent code first.

## Step 4 — Report

```
Quality audit: Erstantrag Wohngeld Mietzuschuss (S00000000159 v2.0.0)
  77 findings — 0 critical, 77 warnings  → reusable with caveats

  Top issues:
   • 40× warning 1103  "Kein Wertebereich angegeben" (field has no value range)
        F00000000056, F00000000240, F00000000261 … (+37 more)
   • 25× warning 1101  "Leerer Bezug" (empty Bezug on a `harmonisiert` field)
        F00000000302, F00000000575, F00000000586 … (+22 more)
   •  4× warning 1102  …
  Rules: all clear.   Schema-level: all clear.
```

Rules:
- **Verdict line first** with the severity split and a plain judgement
  ("clean", "reusable with caveats", "needs fixes — N critical").
- **Cluster by issue type**, don't enumerate 77 lines; show counts + a few example
  ids + "+N more". The recurring `code`/`message` is the actionable unit.
- Translate the German `message` to a short English gloss but keep the original on
  request.
- If `total_checks` is `0`, say it passed clean — that's a real, useful result.
- `critical` findings are the must-fix; never let warnings inflate the severity,
  and never drop a severity value you didn't expect. Quote the per-element ids so the user can drill in with
  `fim-portal fields get <namespace> <id>` (note fields take a namespace).
- This report covers a **single version**; if the user is choosing a version to
  adopt, offer to audit the alternatives from `schemas versions`.
