import { Command } from "commander";
import type { CliDeps } from "../io.js";
import {
  action,
  addPagination,
  choiceOption,
  parseNonEmpty,
  pruneUndefined,
  renderJson,
  renderRaw,
} from "../shared.js";
import { SearchCsvResourceValues, type Pagination, type SearchCsvParams } from "../../client/params.js";

export function registerMiscCommands(program: Command, deps: CliDeps): void {
  addPagination(
    program.command("code-lists").description("List the code lists referenced by data fields"),
  ).action(
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
  // Leistungen instead. The library requires a resource from SearchCsvResourceValues;
  // the --resource choices are that list, so commander reports a bad one as a usage
  // error with the allowed values. The other filters are forwarded verbatim. A blank
  // value is rejected (parseNonEmpty, and the library): it is never a meaningful filter.
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
        }) as SearchCsvParams;
        renderRaw(deps, global, await client.tools.searchCsvDownload(params));
      }),
    );
}
