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
import type { XzufiEntityListParams } from "../../client/params.js";
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
  /** Whether the listing supports full-text search (`fts_query`). */
  fullText: boolean,
): void {
  const cmd = program.command(name).description(description);

  const list = cmd
    .command("list")
    .description(`List ${name} (cursor paginated)`)
    .option("--cursor <n>", "pagination cursor (>= 0)", parseIntArg)
    .option("--limit <n>", "max number of results (1..200)", parseBoundedInt(1, 200));
  if (fullText) list.option("--fts-query <q>", "full-text search query", parseNonEmpty);
  list
    .action(
      action(deps, async ({ client, global, opts }) => {
        const params = pruneUndefined({
          fts_query: opts["ftsQuery"],
          cursor: opts["cursor"],
          limit: opts["limit"],
        }) as XzufiEntityListParams;
        renderJson(deps, global, await pick(client).list(params));
      }),
    );

  cmd
    .command("xzufi")
    .argument("<redaktionId>", "Redaktion id", parseNonEmpty)
    .argument("<id>", "entity id", parseNonEmpty)
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
    true,
  );
  registerEntity(
    program,
    deps,
    "specializations",
    "Spezialisierungen (XZuFi)",
    (c) => c.specializations,
    false,
  );
  registerEntity(
    program,
    deps,
    "online-services",
    "Onlinedienste (XZuFi)",
    (c) => c.onlineServices,
    true,
  );
}
