# fim-portal-cli — Claude Code Skills

A set of [Claude Code](https://code.claude.com/docs/en/skills) **Agent Skills** for the
German **FIM Portal** — the federal catalogue of administrative-service data — all powered
by the **[fim-portal](README.md)** CLI over the open [FIM Portal REST API](https://fimportal.de/docs)
(`fimportal.de`): the XDatenfelder schemas, XZuFi services and XProzess processes of the
"Föderales Informationsmanagement".

Each skill teaches Claude how to drive the `fim-portal` CLI to answer a specific, real-world
question — "tell me everything about the Personalausweis service", "what fields are in the
Wohngeld schema?", "is this schema clean?", "is there a reusable field for a surname?" — and
to report the answer with evidence rather than guesswork. They encode the parts that are easy
to get wrong (the namespace argument on fields/groups, error-vs-warning severity in quality
reports, resolving id-only cross-references) so Claude doesn't rediscover them each time.

## Skills

| Skill | What it does | Ask it… |
|---|---|---|
| **fim-service-dossier** | Builds a full briefing for a public service: profile + its regional master texts + legal bases + linked process, resolving the id-only cross-references. | "everything about the Personalausweis service", "legal bases & regional texts for 99008001012012" |
| **fim-schema-blueprint** | Flattens a data schema's group/field tree into a readable form blueprint with types, cardinalities and code lists. | "what fields are in the Wohngeld schema?", "show the form structure for S00000000159" |
| **fim-quality-audit** | Runs a schema's quality report and ranks the findings by severity and recurring issue, instead of the flat blob. | "is this schema clean?", "which fields are missing a Wertebereich?" |
| **fim-field-finder** | Finds released, reusable data fields and groups for form modelling, filtered by type/status and ranked by reusability. | "is there a standard field for a surname?", "released date input fields", "groups for an address" |

## Requirements

- **[Claude Code](https://code.claude.com/docs/en/overview)** (or any harness that loads
  Agent Skills).
- **The `fim-portal` CLI** installed globally:
  ```bash
  npm i -g @maschinenlesbar.org/fim-portal-cli   # installs the `fim-portal` bin
  ```
  Verify with `command -v fim-portal` or `fim-portal --version` before running any skill.
  No API key is required — the FIM Portal's open endpoints are free, read-only, and need no
  account or configuration.

## Installation

### Plugin marketplace (recommended)

This repo is a Claude Code **plugin marketplace**, so installation is two commands inside
Claude Code:

```
/plugin marketplace add maschinenlesbar-org/fim-portal-cli
/plugin install fim-portal@fim-portal-skills
```

The first command registers the marketplace; the second installs the `fim-portal` plugin,
which bundles all four skills. Update later with `/plugin marketplace update`.

### Manual (copy the skill folders)

Prefer not to use the marketplace? Copy the skills into your **personal** directory
(available across all your projects):

```bash
git clone https://github.com/maschinenlesbar-org/fim-portal-cli tmp-skills
mkdir -p ~/.claude/skills
cp -R tmp-skills/skills/* ~/.claude/skills/
rm -rf tmp-skills
```

…or into a single project's `.claude/skills/` by swapping `~/.claude/skills` for
`.claude/skills`. Each skill lives in its own directory with a `SKILL.md`, e.g.
`skills/fim-service-dossier/SKILL.md`. Start a new Claude Code session and the skills are
picked up automatically.

## Usage

You don't normally invoke these by name — Claude auto-selects the right skill from your
request. Just ask in natural language:

> Give me the full dossier for the Personalausweis service, including the legal bases.

> What data fields and groups make up the Wohngeld schema, with their types?

> Run a quality audit on schema S00000000159 and tell me if it's reusable.

> Is there a released, reusable FIM field for a German surname?

You can also invoke a skill explicitly with its slash command, e.g. `/fim-service-dossier`.

## How it works

Every skill is a single `SKILL.md` — a short, model-facing playbook describing which
`fim-portal` subcommands to call, in what order, and how to interpret the JSON. The skills
encode the non-obvious parts of this API, for example:

- **`fields` and `groups` `get`/`versions`/`xdf` take a `<namespace>` argument *before* the
  FIM id** (`fim-portal fields get baukasten F00000000013`); omit it and the id is consumed
  as the namespace and the command errors — carry the `namespace` from the search result
  (see **fim-field-finder**);
- a **quality report buries severity**: `total_checks` counts *all* findings but most are
  `warning`s, not `error`s — split by `error_type` before judging a schema "broken", and
  treat an all-clean report (`total_checks: 0`) as a valid pass (see **fim-quality-audit**);
- a **schema `get` returns three views** of the same content — a hierarchical `children[]`
  tree (with `type` and `anzahl` cardinality but only ids), and flat `datenfelder[]` /
  `datenfeldgruppen[]` catalogues (with names and types but no order); you must join them by
  `fim_id` to build a readable blueprint (see **fim-schema-blueprint**);
- a service profile's cross-references (`leistung_stammtexte`, `prozessklasse`) come back as
  **id-only lists**, and `prozessklasse` is usually `null`; the dossier resolves the texts on
  demand, picking the right `source` (`leika` / `landesredaktion` / `pvog`) from the
  `redaktion_id` prefix (see **fim-service-dossier**);
- searches without **`--is-latest`** return every historical version of each record — dedupe
  to latest unless version history is wanted; an empty match returns
  `{"items":[],"total_count":0}` and exits `0` (not an error), while a missing id exits `4`;
- download commands (`xdf`, `xzufi`, `xprozess`, `pdf`, `report`, `visualization*`,
  `search-csv`) stream raw bytes — always use `-o <file>`, and note the PDF **language code**
  (`de-DE`) differs from the `--sprache` *search* filter (`Deutsch`).

## Contributing

This project does not accept external code contributions (see
[CONTRIBUTING.md](CONTRIBUTING.md)). When adding a skill internally, keep `SKILL.md`
focused, give it a `description` with concrete trigger phrases, and follow the
[official skill format](https://code.claude.com/docs/en/skills).

## License

[AGPL-3.0-or-later](LICENSE) © Sebastian Schürmann. See [LICENSING.md](LICENSING.md) for
the dual-licensing / commercial option.
