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
import type { GroupSearchParams } from "../../client/params.js";

export function registerGroupCommands(program: Command, deps: CliDeps): void {
  const groups = program.command("groups").description("Datenfeldgruppen (data groups)");

  const search = groups
    .command("search")
    .description("Search/filter data groups")
    .addOption(
      choiceOption("--suche-nur-in <module>", "restrict full-text search to a module", [
        "Rechtsgrundlagen",
        "Status_gesetzt_durch",
        "Versionshinweis",
      ]),
    );
  addCommonDatenfelderSearchOptions(search).action(
    action(deps, async ({ client, global, opts }) => {
      const params = {
        ...commonDatenfelderParams(opts),
        suche_nur_in: opts["sucheNurIn"],
      } as GroupSearchParams;
      renderJson(deps, global, await client.groups.search(params));
    }),
  );

  groups
    .command("versions <namespace> <fimId>")
    .description("List all versions of a data group")
    .action(
      action(deps, async ({ client, global }, [namespace, fimId]) => {
        renderJson(deps, global, await client.groups.versions(namespace!, fimId!));
      }),
    );

  groups
    .command("get <namespace> <fimId> [fimVersion]")
    .description("Get a single data group (version defaults to 'latest')")
    .action(
      action(deps, async ({ client, global }, [namespace, fimId, fimVersion]) => {
        renderJson(
          deps,
          global,
          await client.groups.get(namespace!, fimId!, fimVersion ?? "latest"),
        );
      }),
    );

  groups
    .command("xdf <namespace> <fimId> [fimVersion]")
    .description("Download the XDatenfelder XML for a data group")
    .action(
      action(deps, async ({ client, global }, [namespace, fimId, fimVersion]) => {
        renderRaw(
          deps,
          global,
          await client.groups.downloadXdf(namespace!, fimId!, fimVersion ?? "latest"),
        );
      }),
    );
}
