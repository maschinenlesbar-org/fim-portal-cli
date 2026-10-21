// Compile-time checks of the exported option types: a consumer compiled with
// exactOptionalPropertyTypes may pass undefined for any option, as the runtime treats it as
// omitted.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FimPortalClient } from "../src/index.js";
import { constantJson, makeMockTransport, jsonResponse, rawResponse } from "./helpers.js";

// Runs the TypeScript compiler over a consumer file.
const STARTS_A_PROCESS = { timeout: 30_000 };
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const INDEX = fileURLToPath(new URL("../src/index.js", import.meta.url));

/** Every exported option interface: each field given as undefined must compile. */
const OPTION_TYPES = [
  "EngineOptions",
  "FilterOptions",
  "Pagination",
  "CursorPagination",
  "XzufiEntityListParams",
  "SchemaSearchParams",
  "DocumentProfileSearchParams",
  "FieldSearchParams",
  "GroupSearchParams",
  "LeistungSteckbriefSearchParams",
  "LeistungStammtextSearchParams",
  "ProcessClassSearchParams",
  "ProcessSearchParams",
];

test("a consumer with the strictest compiler settings can pass undefined for any option", STARTS_A_PROCESS, async () => {
  // Under exactOptionalPropertyTypes, `{ baseUrl: process.env.X }` fails to compile against an
  // option declared `?: string`, although the runtime treats undefined as omitted.
  const dir = mkdtempSync(join(tmpdir(), "fim-portal-types-"));
  try {
    writeFileSync(
      join(dir, "use.ts"),
      [
        `import { FimPortalClient, type ${OPTION_TYPES.join(", type ")}, type SearchCsvParams } from ${JSON.stringify(INDEX)};`,
        "declare function allUndefined<T>(): { [K in keyof T]-?: undefined };",
        ...OPTION_TYPES.map((name) => `export const all${name}: ${name} = allUndefined<${name}>();`),
        "export const csv: SearchCsvParams = { resource: \"schema\", term: undefined, xdf_version: undefined, order_by: undefined, feldart: undefined, datentyp: undefined, dokumentart: undefined, sprache: undefined };",
        "export const client = new FimPortalClient({ baseUrl: process.env.FIM_PORTAL_BASE_URL, timeoutMs: 15_000 });",
        "export const names = async (): Promise<string[]> =>",
        "  (await client.schemas.search({ name: process.env.NAME, limit: undefined }, { allowUnknownFilters: undefined })).items.map((s) => s.name);",
        "export const page = (cursor: number | undefined) => client.organizationalUnits.list({ cursor, fts_query: process.env.Q });",
        "export const raw = () => client.tools.searchCsvDownload({ resource: \"field\", term: process.env.T });",
      ].join("\n"),
    );
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          exactOptionalPropertyTypes: true,
          noUncheckedIndexedAccess: true,
          module: "nodenext",
          moduleResolution: "nodenext",
          target: "es2022",
          noEmit: true,
          skipLibCheck: false,
          types: ["node"],
          typeRoots: [join(ROOT, "node_modules/@types")],
        },
        files: ["use.ts"],
      }),
    );
    const tsc = join(ROOT, "node_modules/typescript/bin/tsc");
    const result = await new Promise<{ code: number; out: string }>((resolve) => {
      execFile(process.execPath, [tsc, "-p", join(dir, "tsconfig.json")], (err, stdout, stderr) =>
        resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, out: stdout + stderr }),
      );
    });
    assert.equal(result.code, 0, result.out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an option given as undefined means its default, as an omitted one does", async () => {
  const mt = constantJson({ items: [], total_count: 0 });
  const client = new FimPortalClient({
    baseUrl: undefined,
    userAgent: undefined,
    timeoutMs: undefined,
    maxRetries: undefined,
    retryDelayMs: undefined,
    maxResponseBytes: undefined,
    sleep: undefined,
    onRetry: undefined,
    transport: mt.transport,
  });
  await client.schemas.search({ name: undefined, fts_query: "Geburt", limit: undefined }, { allowUnknownFilters: undefined });
  assert.equal(mt.last().url, "https://fimportal.de/api/v1/schemas?fts_query=Geburt");
  assert.equal(mt.last().headers?.["User-Agent"], "fim-portal-cli");
  assert.equal(mt.last().timeoutMs, 30_000);
  assert.equal(mt.last().maxResponseBytes, 100 * 1024 * 1024);

  const cursor = makeMockTransport(() => jsonResponse({ items: [], next_cursor: null }));
  await new FimPortalClient({ transport: cursor.transport }).organizationalUnits.list({ cursor: undefined, fts_query: undefined });
  assert.equal(cursor.last().url, "https://fimportal.de/api/v0/organizational-unit");

  const csv = makeMockTransport(() => rawResponse("a;b\n", "text/csv"));
  await new FimPortalClient({ transport: csv.transport }).tools.searchCsvDownload({ resource: "schema", term: undefined });
  assert.equal(csv.last().url, "https://fimportal.de/tools/search-csv-download?resource=schema");
});
