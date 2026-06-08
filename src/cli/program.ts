// Assemble the full commander program. The program is built around an injectable
// CliDeps so the entire CLI can be driven in tests with a mocked client and
// captured output.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import type { CliDeps } from "./io.js";
import { defaultIO } from "./io.js";
import { FimPortalClient } from "../client/client.js";
import { parseIntArg, parseNonEmpty } from "./shared.js";
import { registerSchemaCommands } from "./commands/schemas.js";
import { registerDocumentProfileCommands } from "./commands/document-profiles.js";
import { registerFieldCommands } from "./commands/fields.js";
import { registerGroupCommands } from "./commands/groups.js";
import { registerServiceCommands } from "./commands/services.js";
import { registerXzufiEntityCommands } from "./commands/xzufi.js";
import { registerProcessCommands } from "./commands/processes.js";
import { registerMiscCommands } from "./commands/misc.js";

/**
 * Single source of truth for the version: read from package.json at runtime
 * rather than duplicating a literal that can silently drift after a release bump.
 * From the compiled location (dist/src/cli/program.js) package.json is three
 * directories up; the same offset holds for the source under src/cli.
 */
function readVersion(): string {
  try {
    const pkgUrl = new URL("../../../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(fileURLToPath(pkgUrl), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION = readVersion();

/** Default dependencies: real client + real stdout/stderr/filesystem. */
export const defaultDeps: CliDeps = {
  io: defaultIO,
  createClient: (options) => new FimPortalClient(options),
};

export function buildProgram(deps: CliDeps = defaultDeps): Command {
  const program = new Command();

  program
    .name("fim-portal")
    .description(
      "CLI for the open (no-auth) endpoints of the FIM Portal API (https://fimportal.de)",
    )
    .version(VERSION)
    .option("--base-url <url>", "API base URL", "https://fimportal.de")
    .option("--timeout <ms>", "per-request timeout in milliseconds", parseIntArg)
    .option("--user-agent <ua>", "User-Agent header value", parseNonEmpty)
    .option("--max-retries <n>", "retries for transient 429/503 responses", parseIntArg)
    .option(
      "--max-response-bytes <n>",
      "cap response body size in bytes (0 = unlimited; default 100 MiB)",
      parseIntArg,
    )
    .option("--compact", "print JSON on a single line instead of pretty-printed")
    .option(
      "-o, --output <file>",
      "for downloads: write bytes to this file instead of stdout",
    )
    .showHelpAfterError();

  registerSchemaCommands(program, deps);
  registerDocumentProfileCommands(program, deps);
  registerFieldCommands(program, deps);
  registerGroupCommands(program, deps);
  registerServiceCommands(program, deps);
  registerXzufiEntityCommands(program, deps);
  registerProcessCommands(program, deps);
  registerMiscCommands(program, deps);

  return program;
}
