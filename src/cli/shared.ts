// Shared helpers used across CLI command groups: option parsers, the global
// option resolver, and the two result-rendering paths (JSON and raw download).

import { Command, InvalidArgumentError, Option } from "commander";
import type { CliDeps } from "./io.js";
import { FimError } from "../client/errors.js";
import {
  isBidiControl,
  sanitizeServerText,
  type EngineOptions,
  type RawResponse,
} from "../client/engine.js";
import type { QueryParams } from "../client/query.js";
import {
  baseUrlProblem,
  headerValueProblem,
  intInRangeProblem,
  nonEmptyProblem,
  nonNegativeIntProblem,
} from "../client/validate.js";
import { LIMIT_MAX, LIMIT_MIN } from "../client/params.js";
import {
  FreigabeStatusValues,
  XdfVersionValues,
  DatenfelderSearchOrderValues,
} from "../client/enums.js";

/**
 * Parse a plain decimal integer literal exactly.
 *
 * Returns `undefined` for anything that is not a base-10 integer in the
 * canonical form `[+-]?digits`. This deliberately rejects the many alternative
 * numeric forms `Number()` would silently accept (hex `0x10`, binary `0b101`,
 * scientific `1e2`, whitespace-padded `" 5 "`, leading `+`), and rejects values
 * that overflow the safe-integer range (e.g. `99999999999999999999`, which
 * `Number()` would round to a different value before transmitting it).
 */
function parseDecimalInt(value: string): number | undefined {
  if (!/^-?\d+$/.test(value)) return undefined;
  const n = Number(value);
  if (!Number.isSafeInteger(n)) return undefined;
  return n;
}

/**
 * commander value-parser: a non-negative integer. The CLI only turns the argv
 * string into a number; the rule is the library's nonNegativeIntProblem.
 */
export function parseIntArg(value: string): number {
  const n = parseDecimalInt(value);
  const reason = nonNegativeIntProblem(n ?? NaN);
  if (reason !== undefined) throw new InvalidArgumentError(reason);
  return n!;
}

/**
 * Build a commander value-parser for an integer constrained to [min, max], with
 * the library's intInRangeProblem rule. Thrown at parse time, so commander prints
 * a clear message and exits.
 */
export function parseBoundedInt(min: number, max?: number): (value: string) => number {
  const problem = intInRangeProblem(min, max);
  return (value: string) => {
    const n = parseDecimalInt(value);
    const reason = problem(n ?? NaN);
    if (reason !== undefined) throw new InvalidArgumentError(reason);
    return n!;
  };
}

/**
 * commander value-parser: a non-empty (after trimming) string. The rule is the
 * library's nonEmptyProblem, which the client enforces on every query value too;
 * here it only turns a blank value into an early usage error.
 */
export function parseNonEmpty(value: string): string {
  const reason = nonEmptyProblem(value);
  if (reason !== undefined) throw new InvalidArgumentError(reason);
  return value;
}

/**
 * commander value-parser for a value that ends up in an HTTP header (`--user-agent`):
 * the library's headerValueProblem (non-blank, no C0 control or DEL, tab allowed,
 * nothing above U+00FF), reported as a usage error. The client applies the same
 * rule to `userAgent` when it is built.
 */
export function parseHeaderValue(value: string): string {
  const reason = headerValueProblem(value);
  if (reason !== undefined) throw new InvalidArgumentError(reason);
  return value;
}

/**
 * commander value-parser for `--base-url`: the library's base-URL rule
 * (baseUrlProblem: a parseable http(s) URL without a query, a fragment,
 * whitespace or control characters), reported as a usage error before any request
 * is built. The client applies the same rule when it is built, so the CLI holds no
 * rules of its own. commander maps every parse/usage error to exit 1 in this repo,
 * matching the documented contract.
 */
export function parseBaseUrl(value: string): string {
  const reason = baseUrlProblem(value);
  if (reason !== undefined) throw new InvalidArgumentError(reason);
  return value;
}

/**
 * commander value-parser/accumulator for repeatable string options. Each value
 * must be non-empty (parseNonEmpty); the library rejects a blank element too.
 */
export function collect(value: string, previous: string[] = []): string[] {
  return previous.concat([parseNonEmpty(value)]);
}

/**
 * commander value-parser/accumulator for repeatable Freigabe-Status codes (1..8).
 * Only a plain decimal is accepted (see parseDecimalInt): `Number()` would also turn
 * `0x5`, `0b101`, `5.0`, `1e0` and `" 5"` into a valid code.
 */
export function collectFreigabeStatus(value: string, previous: number[] = []): number[] {
  const n = parseDecimalInt(value);
  if (n === undefined || !(FreigabeStatusValues as readonly number[]).includes(n)) {
    throw new InvalidArgumentError(`Must be one of ${FreigabeStatusValues.join(", ")}.`);
  }
  return previous.concat([n]);
}

export interface GlobalOptions {
  baseUrl?: string;
  timeout?: number;
  userAgent?: string;
  maxRetries?: number;
  maxResponseBytes?: number;
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
  if (global.maxResponseBytes !== undefined) options.maxResponseBytes = global.maxResponseBytes;
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

/**
 * Escape the characters JSON.stringify leaves raw although a terminal acts on them.
 * It escapes C0 (including ESC) but not DEL, the C1 range U+0080–U+009F (U+009B is
 * the 8-bit form of CSI) or the bidi formatting characters (isBidiControl), which
 * reorder the text that follows. The output is server data, so escape them; the
 * result is equivalent, valid JSON (these characters only occur inside strings).
 * Checked by char code so the source stays free of control bytes.
 */
export function escapeControlChars(json: string): string {
  let result = "";
  let from = 0;
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i);
    if ((c >= 0x7f && c <= 0x9f) || isBidiControl(c)) {
      result += json.slice(from, i) + "\\u" + c.toString(16).padStart(4, "0");
      from = i + 1;
    }
  }
  return from === 0 ? json : result + json.slice(from);
}

/**
 * JSON.stringify, pretty or compact. A deeply nested value (a hostile or broken
 * response) overflows the stack — the pretty form far sooner than the compact one,
 * which is why the message suggests --compact. The RangeError becomes a FimError so
 * the CLI prints a clear message instead of "Unexpected error: Maximum call stack
 * size exceeded".
 */
function stringifyJson(value: unknown, compact: boolean): string {
  try {
    return compact ? JSON.stringify(value) : JSON.stringify(value, null, 2);
  } catch (err) {
    if (err instanceof RangeError) {
      throw new FimError(
        compact
          ? "The response is nested too deeply to print."
          : "The response is nested too deeply to pretty-print; try --compact.",
        { cause: err },
      );
    }
    throw err;
  }
}

/** The `-o` value that means stdout, as in other Unix tools (`-o -`). */
export const STDOUT_PATH = "-";

/**
 * The file `--output` names, or undefined for stdout: no `-o` at all, or `-o -`. A
 * script that passes a variable defaulting to `-` expects stdout; writing a regular
 * file literally named `-` into the working directory surprised everyone.
 */
export function outputFile(global: GlobalOptions): string | undefined {
  return global.output === undefined || global.output === STDOUT_PATH ? undefined : global.output;
}

/**
 * Render a JSON value, pretty by default and compact with --compact. Honors
 * --output by writing the JSON (UTF-8) to that file instead of stdout, so the
 * flag is not silently ignored on JSON commands; otherwise (and for `-o -`) prints
 * to stdout.
 */
export function renderJson(deps: CliDeps, global: GlobalOptions, value: unknown): void {
  const text = escapeControlChars(stringifyJson(value, global.compact === true));
  const file = outputFile(global);
  if (file !== undefined) {
    const data = Buffer.from(text + "\n", "utf8");
    try {
      deps.io.writeFile(file, data);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new FimError(`could not write ${file}: ${reason}`, { cause: err });
    }
    deps.io.err(`Wrote ${data.length} bytes to ${file}`);
  } else {
    deps.io.out(text);
  }
}

/**
 * Render a raw (binary/text) download. Writes to the file given by --output, or
 * to stdout otherwise (also for `-o -`). Prints a short confirmation to stderr when writing a file
 * so stdout stays clean for piping.
 *
 * The confirmation reports the server's Content-Type so the user can tell what
 * the bytes actually are (e.g. a PDF returned where XML was requested, or an
 * HTML/JSON error page served with a 200). When writing to stdout the same
 * Content-Type note goes to stderr, keeping stdout byte-clean for piping.
 *
 * The --output path is trusted input (the user owns their shell). A failed write
 * (missing directory, permissions, read-only FS) is wrapped in a FimError so it
 * exits 1 with a clean `Error: could not write ...` message rather than falling
 * through to the generic "Unexpected error" handler.
 */
export function renderRaw(
  deps: CliDeps,
  global: GlobalOptions,
  response: RawResponse,
): void {
  // The Content-Type is server-derived and printed to stderr; strip control
  // characters so a hostile endpoint cannot inject terminal escape sequences.
  const typeNote = response.contentType
    ? ` (Content-Type: ${sanitizeServerText(response.contentType)})`
    : "";
  const file = outputFile(global);
  if (file !== undefined) {
    try {
      deps.io.writeFile(file, response.data);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new FimError(`could not write ${file}: ${reason}`, { cause: err });
    }
    deps.io.err(`Wrote ${response.data.length} bytes to ${file}${typeNote}`);
  } else {
    deps.io.outBinary(response.data);
    deps.io.err(`Wrote ${response.data.length} bytes to stdout${typeNote}`);
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

/** The --limit option of every search and list command: the library's LIMIT_MIN..LIMIT_MAX. */
export function addLimitOption(cmd: Command): Command {
  return cmd.option(
    "--limit <n>",
    `max number of results (${LIMIT_MIN}..${LIMIT_MAX})`,
    parseBoundedInt(LIMIT_MIN, LIMIT_MAX),
  );
}

/** Add the shared offset/limit pagination options to a command. */
export function addPagination(cmd: Command): Command {
  return addLimitOption(cmd.option("--offset <n>", "offset within the total dataset (>= 0)", parseIntArg));
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
    // The API spells this one parameter with a capital V; a lowercase name is ignored.
    Versionshinweis: opts["versionshinweis"],
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
      .option("--name <name>", "filter by name", parseNonEmpty)
      .option("--nummernkreis <nk>", "filter by Nummernkreis (repeatable, prefix match)", collect)
      .option(
        "--freigabe-status <code>",
        "filter by Freigabestatus 1..8 (repeatable)",
        collectFreigabeStatus,
      )
      .option("--gueltig-am <date>", "only entries valid on this date (YYYY-MM-DD)", parseNonEmpty)
      .option("--status-gesetzt-durch <who>", "filter by status author", parseNonEmpty)
      .option("--status-gesetzt-seit <date>", "status set on/after this date", parseNonEmpty)
      .option("--status-gesetzt-bis <date>", "status set on/before this date", parseNonEmpty)
      .option("--bezug <text>", "filter by Bezug", parseNonEmpty)
      .option("--versionshinweis <text>", "filter by Versionshinweis", parseNonEmpty)
      .option("--updated-since <iso>", "filter by last-update timestamp (ISO-8601)", parseNonEmpty)
      .addOption(
        choiceOption("--xdf-version <v>", "filter by XDatenfelder version", XdfVersionValues),
      )
      .option("--fts-query <q>", "full-text search query", parseNonEmpty)
      .option("--is-latest", "only results that are the latest version of their kind")
      .addOption(choiceOption("--order-by <order>", "result order", DatenfelderSearchOrderValues)),
  );
}
