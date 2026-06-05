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
import type { FieldSearchParams } from "../../client/params.js";
import { FeldartValues, DatentypValues, FeldSucheInValues } from "../../client/enums.js";

export function registerFieldCommands(program: Command, deps: CliDeps): void {
  const fields = program.command("fields").description("Datenfelder (data fields)");

  const search = fields
    .command("search")
    .description("Search/filter data fields")
    .addOption(
      choiceOption(
        "--suche-nur-in <module>",
        "restrict full-text search to a module",
        FeldSucheInValues,
      ),
    )
    .addOption(choiceOption("--feldart <art>", "filter by Feldart", FeldartValues))
    .addOption(choiceOption("--datentyp <typ>", "filter by Datentyp", DatentypValues));
  addCommonDatenfelderSearchOptions(search).action(
    action(deps, async ({ client, global, opts }) => {
      const params = {
        ...commonDatenfelderParams(opts),
        suche_nur_in: opts["sucheNurIn"],
        feldart: opts["feldart"],
        datentyp: opts["datentyp"],
      } as FieldSearchParams;
      renderJson(deps, global, await client.fields.search(params));
    }),
  );

  fields
    .command("versions <namespace> <fimId>")
    .description("List all versions of a data field")
    .action(
      action(deps, async ({ client, global }, [namespace, fimId]) => {
        renderJson(deps, global, await client.fields.versions(namespace!, fimId!));
      }),
    );

  fields
    .command("get <namespace> <fimId> [fimVersion]")
    .description("Get a single data field (version defaults to 'latest')")
    .action(
      action(deps, async ({ client, global }, [namespace, fimId, fimVersion]) => {
        renderJson(
          deps,
          global,
          await client.fields.get(namespace!, fimId!, fimVersion ?? "latest"),
        );
      }),
    );

  fields
    .command("xdf <namespace> <fimId> [fimVersion]")
    .description("Download the XDatenfelder XML for a data field")
    .action(
      action(deps, async ({ client, global }, [namespace, fimId, fimVersion]) => {
        renderRaw(
          deps,
          global,
          await client.fields.downloadXdf(namespace!, fimId!, fimVersion ?? "latest"),
        );
      }),
    );
}
