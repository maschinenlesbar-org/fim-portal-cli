import { Command } from "commander";
import type { CliDeps } from "../io.js";
import {
  action,
  parseIntArg,
  parseBoundedInt,
  pruneUndefined,
  renderJson,
  renderRaw,
} from "../shared.js";
import type { CursorPagination } from "../../client/params.js";
import type { FimPortalClient } from "../../client/client.js";

type EntityResource =
  | FimPortalClient["organizationalUnits"]
  | FimPortalClient["specializations"]
  | FimPortalClient["onlineServices"];

/** All three XZuFi entity resources share the same cursor-list + xzufi-download shape. */
function registerEntity(
  program: Command,
  deps: CliDeps,
  name: string,
  description: string,
  pick: (c: FimPortalClient) => EntityResource,
): void {
  const cmd = program.command(name).description(description);

  cmd
    .command("list")
    .description(`List ${name} (cursor paginated)`)
    .option("--cursor <n>", "pagination cursor (>= 0)", parseIntArg)
    .option("--limit <n>", "max number of results (1..200)", parseBoundedInt(1, 200))
    .action(
      action(deps, async ({ client, global, opts }) => {
        const params = pruneUndefined({
          cursor: opts["cursor"],
          limit: opts["limit"],
        }) as CursorPagination;
        renderJson(deps, global, await pick(client).list(params));
      }),
    );

  cmd
    .command("xzufi <redaktionId> <id>")
    .description(`Download the XZuFi XML for a ${name} entity`)
    .action(
      action(deps, async ({ client, global }, [redaktionId, id]) => {
        renderRaw(deps, global, await pick(client).downloadXzufi(redaktionId!, id!));
      }),
    );
}

export function registerXzufiEntityCommands(program: Command, deps: CliDeps): void {
  registerEntity(
    program,
    deps,
    "organizational-units",
    "Organisationseinheiten (XZuFi)",
    (c) => c.organizationalUnits,
  );
  registerEntity(
    program,
    deps,
    "specializations",
    "Spezialisierungen (XZuFi)",
    (c) => c.specializations,
  );
  registerEntity(
    program,
    deps,
    "online-services",
    "Onlinedienste (XZuFi)",
    (c) => c.onlineServices,
  );
}
