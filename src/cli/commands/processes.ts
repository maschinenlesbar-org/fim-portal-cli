import { Command } from "commander";
import type { CliDeps } from "../io.js";
import {
  action,
  addPagination,
  choiceOption,
  collectFreigabeStatus,
  pruneUndefined,
  renderJson,
  renderRaw,
} from "../shared.js";
import type { ProcessClassSearchParams, ProcessSearchParams } from "../../client/params.js";
import {
  OperativesZielValues,
  VerfahrensartValues,
  HandlungsformValues,
  DetaillierungsstufeValues,
  AnwendungsgebietValues,
  type Detaillierungsstufe,
} from "../../client/enums.js";

export function registerProcessCommands(program: Command, deps: CliDeps): void {
  registerProcessClasses(program, deps);
  registerProcesses(program, deps);
}

function registerProcessClasses(program: Command, deps: CliDeps): void {
  const pc = program.command("process-classes").description("Prozessklassen (XProzess)");

  const search = pc
    .command("search")
    .description("Search/filter process classes")
    .option("--fts-query <q>", "full-text search query")
    .option(
      "--freigabe-status <code>",
      "filter by Freigabestatus 1..8 (repeatable)",
      collectFreigabeStatus,
    )
    .addOption(choiceOption("--operatives-ziel <code>", "filter by Operatives Ziel", OperativesZielValues))
    .addOption(choiceOption("--verfahrensart <code>", "filter by Verfahrensart", VerfahrensartValues))
    .addOption(choiceOption("--handlungsform <code>", "filter by Handlungsform", HandlungsformValues));
  addPagination(search).action(
    action(deps, async ({ client, global, opts }) => {
      const params = pruneUndefined({
        fts_query: opts["ftsQuery"],
        freigabe_status: opts["freigabeStatus"],
        operatives_ziel: opts["operativesZiel"],
        verfahrensart: opts["verfahrensart"],
        handlungsform: opts["handlungsform"],
        offset: opts["offset"],
        limit: opts["limit"],
      }) as ProcessClassSearchParams;
      renderJson(deps, global, await client.processClasses.search(params));
    }),
  );

  pc.command("get <id> <version>")
    .description("Get a specific process class")
    .action(
      action(deps, async ({ client, global }, [id, version]) => {
        renderJson(deps, global, await client.processClasses.get(id!, version!));
      }),
    );

  pc.command("xprozess <id> <version>")
    .description("Get the XProzess representation of a process class (JSON)")
    .action(
      action(deps, async ({ client, global }, [id, version]) => {
        renderJson(deps, global, await client.processClasses.getXprozess(id!, version!));
      }),
    );
}

function registerProcesses(program: Command, deps: CliDeps): void {
  const p = program.command("processes").description("Prozesse (XProzess)");

  const search = p
    .command("search")
    .description("Search/filter processes")
    .option(
      "--freigabe-status <code>",
      "filter by Freigabestatus 1..8 (repeatable)",
      collectFreigabeStatus,
    )
    .addOption(
      choiceOption("--detaillierungsstufe <code>", "filter by Detaillierungsstufe", DetaillierungsstufeValues),
    )
    .addOption(
      choiceOption("--anwendungsgebiet <code>", "filter by Anwendungsgebiet", AnwendungsgebietValues),
    )
    .option("--is-musterprozess", "only Musterprozesse")
    .option("--fts-query <q>", "full-text search query");
  addPagination(search).action(
    action(deps, async ({ client, global, opts }) => {
      const params = pruneUndefined({
        freigabe_status: opts["freigabeStatus"],
        detaillierungsstufe: opts["detaillierungsstufe"],
        anwendungsgebiet: opts["anwendungsgebiet"],
        is_musterprozess: opts["isMusterprozess"],
        fts_query: opts["ftsQuery"],
        offset: opts["offset"],
        limit: opts["limit"],
      }) as ProcessSearchParams;
      renderJson(deps, global, await client.processes.search(params));
    }),
  );

  p.command("get <id> <version> <stufe>")
    .description("Get a specific process (stufe: 101..105)")
    .action(
      action(deps, async ({ client, global }, [id, version, stufe]) => {
        renderJson(deps, global, await client.processes.get(id!, version!, stufe as Detaillierungsstufe));
      }),
    );

  const downloads: Array<[string, keyof typeof downloadMap]> = [
    ["xprozess <id> <version> <stufe>", "downloadXprozess"],
    ["report <id> <version> <stufe>", "downloadReport"],
    ["visualization <id> <version> <stufe>", "downloadVisualization"],
    ["visualization-display <id> <version> <stufe>", "downloadVisualizationDisplay"],
  ];
  const downloadMap = {
    downloadXprozess: "Download the XProzess XML for a process",
    downloadReport: "Download the report XML for a process",
    downloadVisualization: "Download the visualization XML for a process",
    downloadVisualizationDisplay: "Download the display visualization XML for a process",
  } as const;

  for (const [signature, method] of downloads) {
    p.command(signature)
      .description(downloadMap[method])
      .action(
        action(deps, async ({ client, global }, [id, version, stufe]) => {
          const res = await client.processes[method](id!, version!, stufe as Detaillierungsstufe);
          renderRaw(deps, global, res);
        }),
      );
  }
}
