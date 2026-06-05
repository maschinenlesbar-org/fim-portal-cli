import { Command } from "commander";
import type { CliDeps } from "../io.js";
import {
  action,
  addCommonDatenfelderSearchOptions,
  choiceOption,
  commonDatenfelderParams,
  renderJson,
  renderRaw,
} from "../shared.js";
import type { SchemaSearchParams } from "../../client/params.js";

export function registerSchemaCommands(program: Command, deps: CliDeps): void {
  const schemas = program.command("schemas").description("Datenschemata (XDatenfelder)");

  const search = schemas
    .command("search")
    .description("Search/filter Datenschemata")
    .option("--bezug-unterelemente <text>", "filter by Bezug of sub-elements")
    .option("--bezeichnung <text>", "filter by Bezeichnung")
    .option("--stichwort <text>", "filter by Stichwort (XDF3 only)")
    .addOption(
      choiceOption("--suche-nur-in <module>", "restrict full-text search to a module", [
        "Rechtsgrundlagen",
        "Status_gesetzt_durch",
        "Versionshinweis",
        "Stichwort",
      ]),
    );
  addCommonDatenfelderSearchOptions(search).action(
    action(deps, async ({ client, global, opts }) => {
      const params = {
        ...commonDatenfelderParams(opts),
        bezug_unterelemente: opts["bezugUnterelemente"],
        bezeichnung: opts["bezeichnung"],
        stichwort: opts["stichwort"],
        suche_nur_in: opts["sucheNurIn"],
      } as SchemaSearchParams;
      renderJson(deps, global, await client.schemas.search(params));
    }),
  );

  schemas
    .command("versions <fimId>")
    .description("List all versions of a schema")
    .action(
      action(deps, async ({ client, global }, [fimId]) => {
        renderJson(deps, global, await client.schemas.versions(fimId!));
      }),
    );

  schemas
    .command("get <fimId> [fimVersion]")
    .description("Get a full schema (version defaults to 'latest')")
    .action(
      action(deps, async ({ client, global }, [fimId, fimVersion]) => {
        renderJson(deps, global, await client.schemas.get(fimId!, fimVersion ?? "latest"));
      }),
    );

  schemas
    .command("xdf <fimId> [fimVersion]")
    .description("Download the XDatenfelder XML for a schema")
    .action(
      action(deps, async ({ client, global }, [fimId, fimVersion]) => {
        renderRaw(deps, global, await client.schemas.downloadXdf(fimId!, fimVersion ?? "latest"));
      }),
    );

  schemas
    .command("quality-report <fimId> [fimVersion]")
    .description("Get the quality report for a schema")
    .action(
      action(deps, async ({ client, global }, [fimId, fimVersion]) => {
        renderJson(
          deps,
          global,
          await client.schemas.qualityReport(fimId!, fimVersion ?? "latest"),
        );
      }),
    );
}
