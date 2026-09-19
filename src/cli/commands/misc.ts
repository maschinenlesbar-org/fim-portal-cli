import { Command } from "commander";
import type { CliDeps } from "../io.js";
import {
  action,
  parseIntArg,
  parseBoundedInt,
  parseNonEmpty,
  pruneUndefined,
  renderJson,
  renderRaw,
} from "../shared.js";
import type { Pagination } from "../../client/params.js";

export function registerMiscCommands(program: Command, deps: CliDeps): void {
  program
    .command("code-lists")
    .description("List the code lists referenced by data fields")
    .option("--offset <n>", "offset within the total dataset (>= 0)", parseIntArg)
    .option("--limit <n>", "max number of results (1..200)", parseBoundedInt(1, 200))
    .action(
      action(deps, async ({ client, global, opts }) => {
        const params = pruneUndefined({
          offset: opts["offset"],
          limit: opts["limit"],
        }) as Pagination;
        renderJson(deps, global, await client.codeLists.list(params));
      }),
    );

  // search-csv is a deliberate unvalidated pass-through: it exposes a convenient
  // subset of the CSV filters and forwards their values verbatim. The OpenAPI
  // spec types every search-csv-download parameter as a free-form string with no
  // enum, so there are intentionally no choices() guards here (unlike `fields
  // search`); the server validates the values. Only a blank value is rejected
  // locally (parseNonEmpty): it is never a meaningful filter.
  program
    .command("search-csv")
    .description("Download a search result as CSV (tools/search-csv-download)")
    .requiredOption(
      "--resource <name>",
      "resource to export (e.g. schemas, fields, groups, steckbriefe, leistungen, processes)",
      parseNonEmpty,
    )
    .option("--term <text>", "search term", parseNonEmpty)
    .option("--xdf-version <v>", "XDatenfelder version", parseNonEmpty)
    .option("--order-by <order>", "result order", parseNonEmpty)
    .option("--feldart <art>", "filter by Feldart", parseNonEmpty)
    .option("--datentyp <typ>", "filter by Datentyp", parseNonEmpty)
    .option("--dokumentart <code>", "filter by Dokumentart", parseNonEmpty)
    .option("--sprache <lang>", "filter by language", parseNonEmpty)
    .action(
      action(deps, async ({ client, global, opts }) => {
        const params = pruneUndefined({
          resource: opts["resource"],
          term: opts["term"],
          xdf_version: opts["xdfVersion"],
          order_by: opts["orderBy"],
          feldart: opts["feldart"],
          datentyp: opts["datentyp"],
          dokumentart: opts["dokumentart"],
          sprache: opts["sprache"],
        }) as Record<string, string | undefined>;
        renderRaw(deps, global, await client.tools.searchCsvDownload(params));
      }),
    );
}
