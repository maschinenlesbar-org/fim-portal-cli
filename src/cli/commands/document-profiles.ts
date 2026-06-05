import { Command } from "commander";
import type { CliDeps } from "../io.js";
import {
  action,
  addPagination,
  choiceOption,
  collect,
  collectFreigabeStatus,
  pruneUndefined,
  renderJson,
  renderRaw,
} from "../shared.js";
import type { DocumentProfileSearchParams } from "../../client/params.js";
import {
  DokumentartValues,
  SteckbriefSucheInValues,
  XdfVersionValues,
  DatenfelderSearchOrderValues,
} from "../../client/enums.js";

export function registerDocumentProfileCommands(program: Command, deps: CliDeps): void {
  const dp = program
    .command("document-profiles")
    .description("Dokumentsteckbriefe (document profiles)");

  const search = dp
    .command("search")
    .description("Search/filter document profiles")
    .option("--name <name>", "filter by name")
    .option("--nummernkreis <nk>", "filter by Nummernkreis (repeatable, prefix match)", collect)
    .option(
      "--freigabe-status <code>",
      "filter by Freigabestatus 1..8 (repeatable)",
      collectFreigabeStatus,
    )
    .option("--status-gesetzt-durch <who>", "filter by status author")
    .option("--status-gesetzt-seit <date>", "status set on/after this date")
    .option("--status-gesetzt-bis <date>", "status set on/before this date")
    .option("--bezeichnung <text>", "filter by Bezeichnung")
    .addOption(choiceOption("--dokumentart <code>", "filter by Dokumentart", DokumentartValues))
    .option("--bezug <text>", "filter by Bezug")
    .option("--fts-query <q>", "full-text search query")
    .addOption(
      choiceOption(
        "--suche-nur-in <module>",
        "restrict full-text search to a module",
        SteckbriefSucheInValues,
      ),
    )
    .option("--versionshinweis <text>", "filter by Versionshinweis")
    .option("--updated-since <iso>", "filter by last-update timestamp (ISO-8601)")
    .addOption(choiceOption("--xdf-version <v>", "filter by XDatenfelder version", XdfVersionValues))
    .option("--stichwort <text>", "filter by Stichwort (XDF3 only)")
    .option("--is-latest", "only the latest version of each kind")
    .addOption(choiceOption("--order-by <order>", "result order", DatenfelderSearchOrderValues));
  addPagination(search).action(
    action(deps, async ({ client, global, opts }) => {
      const params = pruneUndefined({
        name: opts["name"],
        nummernkreis: opts["nummernkreis"],
        freigabe_status: opts["freigabeStatus"],
        status_gesetzt_durch: opts["statusGesetztDurch"],
        status_gesetzt_seit: opts["statusGesetztSeit"],
        status_gesetzt_bis: opts["statusGesetztBis"],
        bezeichnung: opts["bezeichnung"],
        dokumentart: opts["dokumentart"],
        bezug: opts["bezug"],
        fts_query: opts["ftsQuery"],
        suche_nur_in: opts["sucheNurIn"],
        versionshinweis: opts["versionshinweis"],
        updated_since: opts["updatedSince"],
        xdf_version: opts["xdfVersion"],
        stichwort: opts["stichwort"],
        is_latest: opts["isLatest"],
        order_by: opts["orderBy"],
        offset: opts["offset"],
        limit: opts["limit"],
      }) as DocumentProfileSearchParams;
      renderJson(deps, global, await client.documentProfiles.search(params));
    }),
  );

  dp.command("versions <fimId>")
    .description("List all versions of a document profile")
    .action(
      action(deps, async ({ client, global }, [fimId]) => {
        renderJson(deps, global, await client.documentProfiles.versions(fimId!));
      }),
    );

  dp.command("get <fimId> [fimVersion]")
    .description("Get a single document profile (version defaults to 'latest')")
    .action(
      action(deps, async ({ client, global }, [fimId, fimVersion]) => {
        renderJson(deps, global, await client.documentProfiles.get(fimId!, fimVersion ?? "latest"));
      }),
    );

  dp.command("xdf <fimId> [fimVersion]")
    .description("Download the XDatenfelder XML for a document profile")
    .action(
      action(deps, async ({ client, global }, [fimId, fimVersion]) => {
        renderRaw(
          deps,
          global,
          await client.documentProfiles.downloadXdf(fimId!, fimVersion ?? "latest"),
        );
      }),
    );
}
