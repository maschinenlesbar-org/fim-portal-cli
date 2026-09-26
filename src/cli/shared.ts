// Shared helpers used across CLI command groups: option parsers, the global
// option resolver, and the two result-rendering paths (JSON and raw download).

import { Command, InvalidArgumentError, Option } from "commander";
import type { CliDeps } from "./io.js";
import { FimError } from "../client/errors.js";
import { sanitizeServerText, type EngineOptions, type RawResponse } from "../client/engine.js";
import type { QueryParams } from "../client/query.js";
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

/** commander value-parser: a non-negative integer. */
export function parseIntArg(value: string): number {
  const n = parseDecimalInt(value);
  if (n === undefined || n < 0) {
    throw new InvalidArgumentError("Expected a non-negative integer.");
  }
  return n;
}

/**
 * Build a commander value-parser for an integer constrained to [min, max].
 * Thrown at parse time, so commander prints a clear message and exits.
 */
export function parseBoundedInt(min: number, max?: number): (value: string) => number {
  return (value: string) => {
    const n = parseDecimalInt(value);
    if (n === undefined) throw new InvalidArgumentError("Expected an integer.");
    if (n < min) throw new InvalidArgumentError(`Must be >= ${min}.`);
    if (max !== undefined && n > max) throw new InvalidArgumentError(`Must be <= ${max}.`);
    return n;
  };
}

/** commander value-parser: a non-empty (after trimming) string. */
export function parseNonEmpty(value: string): string {
  if (value.trim() === "") {
    throw new InvalidArgumentError("Expected a non-empty value.");
  }
  return value;
}

/**
 * commander value-parser for `--base-url`: accept only a well-formed http(s) URL.
 *
 * The default transport already refuses non-http(s) schemes, but that check runs
 * at dial time and surfaces as a network error. Rejecting here at parse time gives
 * a clear usage error before any request is built, and — since this is the
 * reference implementation — makes the "http(s)-only" control real at the CLI
 * boundary rather than only inside one transport (a library consumer injecting a
 * custom Transport is still covered by the transport-level check). commander maps
 * every parse/usage error to exit 1 in this repo, matching the documented contract.
 */
export function parseBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InvalidArgumentError("Expected a valid absolute URL (e.g. https://fimportal.de).");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new InvalidArgumentError('Only "http:" and "https:" base URLs are supported.');
  }
  // Paths are appended to the base URL as a string, so a query or fragment would
  // swallow every request path ("http://h/#f" requests "/" for every command).
  if (/[?#]/.test(value)) {
    throw new InvalidArgumentError("A base URL cannot have a query (?) or fragment (#).");
  }
  // new URL() trims surrounding whitespace silently; the raw value is what the
  // engine uses, so reject it rather than guess.
  if (value !== value.trim()) {
    throw new InvalidArgumentError("A base URL cannot have surrounding whitespace.");
  }
  return value;
}

/**
 * Validate a positional argument against an allowed set (commander does not
 * support .choices() on positional args). Throws a FimError so run() prints a
 * clear message and exits 1.
 */
export function assertEnum<T extends string>(
  value: string,
  allowed: readonly T[],
  argName: string,
): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new FimError(`Invalid ${argName} "${value}". Expected one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}

/**
 * commander value-parser/accumulator for repeatable string options. Each value
 * must be non-empty: a blank one would otherwise be sent as an empty parameter.
 */
export function collect(value: string, previous: string[] = []): string[] {
  return previous.concat([parseNonEmpty(value)]);
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
 * Escape the control characters JSON.stringify leaves raw. It escapes C0 (including
 * ESC) but not DEL or the C1 range U+0080–U+009F, and terminals may act on those —
 * U+009B is the 8-bit form of CSI. The output is server data, so escape them; the
 * result is equivalent, valid JSON (these characters only occur inside strings).
 * Checked by char code so the source stays free of control bytes.
 */
export function escapeControlChars(json: string): string {
  let result = "";
  let from = 0;
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i);
    if (c >= 0x7f && c <= 0x9f) {
      result += json.slice(from, i) + "\\u" + c.toString(16).padStart(4, "0");
      from = i + 1;
    }
  }
  return from === 0 ? json : result + json.slice(from);
}

/**
 * Render a JSON value, pretty by default and compact with --compact. Honors
 * --output by writing the JSON (UTF-8) to that file instead of stdout, so the
 * flag is not silently ignored on JSON commands; otherwise prints to stdout.
 */
export function renderJson(deps: CliDeps, global: GlobalOptions, value: unknown): void {
  const text = escapeControlChars(global.compact ? JSON.stringify(value) : JSON.stringify(value, null, 2));
  if (global.output) {
    const data = Buffer.from(text + "\n", "utf8");
    try {
      deps.io.writeFile(global.output, data);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new FimError(`could not write ${global.output}: ${reason}`, { cause: err });
    }
    deps.io.err(`Wrote ${data.length} bytes to ${global.output}`);
  } else {
    deps.io.out(text);
  }
}

/**
 * Render a raw (binary/text) download. Writes to the file given by --output, or
 * to stdout otherwise. Prints a short confirmation to stderr when writing a file
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
  if (global.output) {
    try {
      deps.io.writeFile(global.output, response.data);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new FimError(`could not write ${global.output}: ${reason}`, { cause: err });
    }
    deps.io.err(`Wrote ${response.data.length} bytes to ${global.output}${typeNote}`);
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

/** Add the shared offset/limit pagination options to a command. */
export function addPagination(cmd: Command): Command {
  return cmd
    .option("--offset <n>", "offset within the total dataset (>= 0)", parseIntArg)
    .option("--limit <n>", "max number of results (1..200)", parseBoundedInt(1, 200));
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
