// Shared helpers used across CLI command groups: option parsers, the global
// option resolver, and the two result-rendering paths (JSON and raw download).

import { Command, InvalidArgumentError, Option } from "commander";
import type { CliDeps } from "./io.js";
import type { EngineOptions, RawResponse } from "../client/engine.js";
import type { QueryParams } from "../client/query.js";
import { FreigabeStatusValues } from "../client/enums.js";

/** commander value-parser: a non-negative integer. */
export function parseIntArg(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new InvalidArgumentError("Expected a non-negative integer.");
  }
  return n;
}

/** commander value-parser/accumulator for repeatable string options. */
export function collect(value: string, previous: string[] = []): string[] {
  return previous.concat([value]);
}

/** commander value-parser/accumulator for repeatable Freigabe-Status codes (1..8). */
export function collectFreigabeStatus(value: string, previous: number[] = []): number[] {
  const n = Number(value);
  if (!(FreigabeStatusValues as readonly number[]).includes(n)) {
    throw new InvalidArgumentError(`Must be one of ${FreigabeStatusValues.join(", ")}.`);
  }
  return previous.concat([n]);
}

export interface GlobalOptions {
  baseUrl?: string;
  timeout?: number;
  userAgent?: string;
  maxRetries?: number;
  compact?: boolean;
  output?: string;
}

/** Translate resolved global CLI options into client EngineOptions. */
export function toEngineOptions(global: GlobalOptions): EngineOptions {
  const options: EngineOptions = {};
  if (global.baseUrl !== undefined) options.baseUrl = global.baseUrl;
  if (global.timeout !== undefined) options.timeoutMs = global.timeout;
  if (global.userAgent !== undefined) options.userAgent = global.userAgent;
  if (global.maxRetries !== undefined) options.maxRetries = global.maxRetries;
  return options;
}

/** Drop keys whose value is undefined so we only send what the user set. */
export function pruneUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

/** Render a JSON value to stdout, pretty by default, compact with --compact. */
export function renderJson(deps: CliDeps, global: GlobalOptions, value: unknown): void {
  const text = global.compact ? JSON.stringify(value) : JSON.stringify(value, null, 2);
  deps.io.out(text);
}

/**
 * Render a raw (binary/text) download. Writes to the file given by --output, or
 * to stdout otherwise. Prints a short confirmation to stderr when writing a file
 * so stdout stays clean for piping.
 */
export function renderRaw(
  deps: CliDeps,
  global: GlobalOptions,
  response: RawResponse,
): void {
  if (global.output) {
    deps.io.writeFile(global.output, response.data);
    deps.io.err(`Wrote ${response.data.length} bytes to ${global.output}`);
  } else {
    deps.io.outBinary(response.data);
  }
}

export interface ActionContext {
  client: ReturnType<CliDeps["createClient"]>;
  global: GlobalOptions;
  /** This command's own parsed options. */
  opts: Record<string, unknown>;
}

/**
 * Wrap an async command action with consistent global-option resolution and
 * client construction. The callback receives a context (client + resolved global
 * options + this command's options) and the command's positional arguments.
 *
 * Commander invokes actions as (arg1, ..., argN, options, command); we slice off
 * the trailing options object and command instance to recover the positionals.
 */
export function action(
  deps: CliDeps,
  fn: (ctx: ActionContext, positionals: string[]) => Promise<void>,
): (...args: unknown[]) => Promise<void> {
  return async (...args: unknown[]) => {
    const command = args[args.length - 1] as Command;
    const positionals = args.slice(0, Math.max(0, args.length - 2)) as string[];
    const global = command.optsWithGlobals() as GlobalOptions;
    const client = deps.createClient(toEngineOptions(global));
    await fn({ client, global, opts: command.opts() }, positionals);
  };
}

/** Add the shared offset/limit pagination options to a command. */
export function addPagination(cmd: Command): Command {
  return cmd
    .option("--offset <n>", "offset within the total dataset", parseIntArg)
    .option("--limit <n>", "max number of results (1..200)", parseIntArg);
}

/** Add an Option constrained to a fixed set of choices. */
export function choiceOption(
  flags: string,
  description: string,
  choices: readonly string[],
): Option {
  return new Option(flags, description).choices([...choices]);
}

/** Build a QueryParams object for the four XDatenfelder search endpoints. */
export function commonDatenfelderParams(opts: Record<string, unknown>): QueryParams {
  return pruneUndefined({
    name: opts["name"],
    nummernkreis: opts["nummernkreis"],
    freigabe_status: opts["freigabeStatus"],
    gueltig_am: opts["gueltigAm"],
    status_gesetzt_durch: opts["statusGesetztDurch"],
    status_gesetzt_seit: opts["statusGesetztSeit"],
    status_gesetzt_bis: opts["statusGesetztBis"],
    bezug: opts["bezug"],
    versionshinweis: opts["versionshinweis"],
    updated_since: opts["updatedSince"],
    xdf_version: opts["xdfVersion"],
    fts_query: opts["ftsQuery"],
    is_latest: opts["isLatest"],
    order_by: opts["orderBy"],
    offset: opts["offset"],
    limit: opts["limit"],
  }) as QueryParams;
}

/** Add the search options common to schemas / fields / groups. */
export function addCommonDatenfelderSearchOptions(cmd: Command): Command {
  return addPagination(
    cmd
      .option("--name <name>", "filter by name")
      .option("--nummernkreis <nk>", "filter by Nummernkreis (repeatable, prefix match)", collect)
      .option(
        "--freigabe-status <code>",
        "filter by Freigabestatus 1..8 (repeatable)",
        collectFreigabeStatus,
      )
      .option("--gueltig-am <date>", "only entries valid on this date (YYYY-MM-DD)")
      .option("--status-gesetzt-durch <who>", "filter by status author")
      .option("--status-gesetzt-seit <date>", "status set on/after this date")
      .option("--status-gesetzt-bis <date>", "status set on/before this date")
      .option("--bezug <text>", "filter by Bezug")
      .option("--versionshinweis <text>", "filter by Versionshinweis")
      .option("--updated-since <iso>", "filter by last-update timestamp (ISO-8601)")
      .addOption(
        choiceOption("--xdf-version <v>", "filter by XDatenfelder version", ["2.0", "3.0.0"]),
      )
      .option("--fts-query <q>", "full-text search query")
      .option("--is-latest", "only results that are the latest version of their kind")
      .addOption(
        choiceOption("--order-by <order>", "result order", [
          "geaendert_datum_zeit_desc",
          "geaendert_datum_zeit_asc",
          "name_asc",
          "name_desc",
          "id_asc",
          "id_desc",
        ]),
      ),
  );
}
