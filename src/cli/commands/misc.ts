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
import {
  DatentypValues,
  DokumentartValues,
  FeldartValues,
  SpracheValues,
  XdfVersionValues,
} from "../../client/enums.js";

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
  // rejects nothing: an unrecognised --resource silently exports Leistungen, and a
  // filter value it doesn't know (`--feldart SELECT`) or a filter for another resource
  // (`--feldart` on `--resource schema`) is ignored, exporting the unfiltered result.
  // So --resource and the filters with a known domain are fixed choices (commander
  // reports a bad one as a usage error with the allowed values), and the library
  // (assertSearchCsvParams) refuses a filter that doesn't apply to the resource and an
  // --order-by outside the resource's sort orders. A blank value is rejected
  // (parseNonEmpty, and the library): it is never a meaningful filter.
  program
    .command("search-csv")
    .description("Download a search result as CSV (tools/search-csv-download)")
    .addOption(
      choiceOption("--resource <name>", "resource to export", SearchCsvResourceValues).makeOptionMandatory(),
    )
    .option("--term <text>", "search term", parseNonEmpty)
    .addOption(choiceOption("--xdf-version <v>", "XDatenfelder version (schema, document-profile, field, group)", XdfVersionValues))
    .option("--order-by <order>", "result order (the sort orders of the resource's JSON search)", parseNonEmpty)
    .addOption(choiceOption("--feldart <art>", "filter by Feldart (field)", FeldartValues))
    .addOption(choiceOption("--datentyp <typ>", "filter by Datentyp (field)", DatentypValues))
    .addOption(choiceOption("--dokumentart <code>", "filter by Dokumentart (document-profile)", DokumentartValues))
    .addOption(choiceOption("--sprache <lang>", "filter by language (leistung-steckbriefe)", SpracheValues))
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
