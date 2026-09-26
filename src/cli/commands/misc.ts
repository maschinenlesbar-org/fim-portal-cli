import { Command } from "commander";
import type { CliDeps } from "../io.js";
import {
  action,
  choiceOption,
  parseIntArg,
  parseBoundedInt,
  parseNonEmpty,
  pruneUndefined,
  renderJson,
  renderRaw,
} from "../shared.js";
import { SearchCsvResourceValues, type Pagination } from "../../client/params.js";

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

  // search-csv exposes a convenient subset of the CSV filters. The OpenAPI spec
  // types every search-csv-download parameter as a free-form string, and the server
  // does not reject unknown values: an unrecognised --resource silently exports
  // Leistungen instead. So --resource is checked against the values the portal's
  // own search page uses (SearchCsvResourceValues); the other filters are
  // forwarded verbatim. A blank value is rejected locally (parseNonEmpty): it is
  // never a meaningful filter.
  program
    .command("search-csv")
    .description("Download a search result as CSV (tools/search-csv-download)")
    .addOption(
      choiceOption("--resource <name>", "resource to export", SearchCsvResourceValues).makeOptionMandatory(),
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
