import { Command } from "commander";
import type { CliDeps } from "../io.js";
import { action, parseIntArg, pruneUndefined, renderJson, renderRaw } from "../shared.js";
import type { Pagination } from "../../client/params.js";

export function registerMiscCommands(program: Command, deps: CliDeps): void {
  program
    .command("code-lists")
    .description("List the code lists referenced by data fields")
    .option("--offset <n>", "offset within the total dataset", parseIntArg)
    .option("--limit <n>", "max number of results", parseIntArg)
    .action(
      action(deps, async ({ client, global, opts }) => {
        const params = pruneUndefined({
          offset: opts["offset"],
          limit: opts["limit"],
        }) as Pagination;
        renderJson(deps, global, await client.codeLists.list(params));
      }),
    );

  program
    .command("search-csv")
    .description("Download a search result as CSV (tools/search-csv-download)")
    .requiredOption(
      "--resource <name>",
      "resource to export (e.g. schemas, fields, groups, steckbriefe, leistungen, processes)",
    )
    .option("--term <text>", "search term")
    .option("--xdf-version <v>", "XDatenfelder version")
    .option("--order-by <order>", "result order")
    .option("--feldart <art>", "filter by Feldart")
    .option("--datentyp <typ>", "filter by Datentyp")
    .option("--dokumentart <code>", "filter by Dokumentart")
    .option("--sprache <lang>", "filter by language")
    .action(
      action(deps, async ({ client, global, opts }) => {
        const params = pruneUndefined({
          resource: opts["resource"] as string | undefined,
          term: opts["term"] as string | undefined,
          xdf_version: opts["xdfVersion"] as string | undefined,
          order_by: opts["orderBy"] as string | undefined,
          feldart: opts["feldart"] as string | undefined,
          datentyp: opts["datentyp"] as string | undefined,
          dokumentart: opts["dokumentart"] as string | undefined,
          sprache: opts["sprache"] as string | undefined,
        }) as Record<string, string | undefined>;
        renderRaw(deps, global, await client.tools.searchCsvDownload(params));
      }),
    );
}
