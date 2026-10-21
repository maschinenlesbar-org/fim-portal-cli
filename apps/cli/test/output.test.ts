// `-o` and `--force` against real files in a temp dir, through run(): a refused target costs
// no request, a write is atomic, an existing file is never overwritten by accident. A write
// cut short is conformance test P26's.

import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli/run.js";
import type { CliDeps } from "../src/cli/io.js";
import { FimPortalClient } from "@maschinenlesbar.org/fim-portal-client/internal/client";
import type { HttpRequest, HttpResponse } from "@maschinenlesbar.org/fim-portal-client/internal/http";
import { jsonResponse, makeMockTransport, rawResponse, untimed } from "./helpers.js";

const PAGE = { items: [{ name: "Ein \u001b[31mrotes\u009b Item ‮" }], offset: 0, limit: 200, count: 1, total_count: 1 };
const XML = "<xdf:schema>…</xdf:schema>\n";

function makeCli(responder: (req: HttpRequest) => HttpResponse = (req) => (req.url.includes("/xdf") ? rawResponse(XML, "application/xml") : jsonResponse(PAGE))) {
  const out: string[] = [];
  const err: string[] = [];
  const mt = makeMockTransport(responder);
  const deps: CliDeps = {
    io: { out: (s) => out.push(s), err: (s) => err.push(untimed(s)), outBinary: (d) => void out.push(d.toString("utf8")) },
    createClient: (opts) => new FimPortalClient({ ...opts, transport: mt.transport }),
  };
  return { deps, out, err, mt };
}

/** Run `body` with a fresh temp directory that is always removed. */
async function inTempDir(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "fim-portal-output-"));
  try {
    await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("-o writes what stdout would show, plus a newline, and says so in an INFO record", async () => {
  await inTempDir(async (dir) => {
    const shown = makeCli();
    assert.equal(await run(["code-lists"], shown.deps), 0);
    const path = join(dir, "lists.json");
    const cli = makeCli();
    assert.equal(await run(["-o", path, "code-lists"], cli.deps), 0);
    const written = readFileSync(path, "utf8");
    assert.equal(written, `${shown.out.join("\n")}\n`);
    assert.doesNotMatch(written, /[\u001b\u009b‮]/, "control characters are escaped in the file too");
    assert.deepEqual(cli.out, []);
    assert.deepEqual(cli.err, [`INFO  [fim-portal.output] Wrote ${Buffer.byteLength(written)} bytes to ${path}`]);

    const xdf = join(dir, "schema.xml");
    const raw = makeCli();
    assert.equal(await run(["-o", xdf, "schemas", "xdf", "S1", "1.0"], raw.deps), 0);
    assert.equal(readFileSync(xdf, "utf8"), XML);
    assert.deepEqual(readdirSync(dir).sort(), ["lists.json", "schema.xml"], "no temporary file is left");
  });
});

test("-o - prints to stdout and creates no file, with --force too", async () => {
  await inTempDir(async (dir) => {
    const cli = makeCli();
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      assert.equal(await run(["--compact", "-o", "-", "code-lists"], cli.deps), 0);
      assert.equal(await run(["--compact", "-o", "-", "--force", "code-lists"], cli.deps), 0);
    } finally {
      process.chdir(cwd);
    }
    assert.equal(cli.out.length, 2);
    assert.deepEqual(cli.err, []);
    assert.deepEqual(readdirSync(dir), []);
  });
});

test("a refused -o target is a usage error (exit 1) before any request", async () => {
  await inTempDir(async (dir) => {
    const existing = join(dir, "existing.json");
    writeFileSync(existing, "keep");
    const dangling = join(dir, "dangling.json");
    symlinkSync(join(dir, "nowhere"), dangling);
    const sub = join(dir, "sub");
    mkdirSync(sub);
    const cases: Array<[string[], string]> = [
      [["-o", "", "code-lists"], "Expected a non-empty value."],
      [["-o", "  ", "code-lists"], "Expected a non-empty value."],
      [["--force", "code-lists"], "--force needs --output (it only allows overwriting the -o file)."],
      [["-o", existing, "code-lists"], `Refusing to overwrite existing file "${existing}"; pass --force to overwrite.`],
      [["-o", existing, "schemas", "xdf", "S1", "1.0"], `Refusing to overwrite existing file "${existing}"; pass --force to overwrite.`],
      [["-o", dangling, "code-lists"], `Refusing to overwrite existing file "${dangling}"; pass --force to overwrite.`],
      [["-o", sub, "code-lists"], `"${sub}" is a directory; give a file path to --output.`],
      [["-o", sub, "--force", "code-lists"], `"${sub}" is a directory; give a file path to --output.`],
    ];
    for (const [argv, message] of cases) {
      const cli = makeCli();
      assert.equal(await run(argv, cli.deps), 1, argv.join(" "));
      assert.equal(cli.mt.calls.length, 0, `${argv.join(" ")} sent a request`);
      assert.ok(cli.err.some((line) => line.startsWith("ERROR [fim-portal.cli]") && line.includes(message)), `${argv.join(" ")}: ${cli.err.join(" | ")}`);
    }
    assert.equal(readFileSync(existing, "utf8"), "keep");
    assert.deepEqual(readdirSync(dir).sort(), ["dangling.json", "existing.json", "sub"]);
  });
});

test("--force replaces an existing file, keeps its mode, and writes through a symlink", async () => {
  await inTempDir(async (dir) => {
    const path = join(dir, "out.json");
    writeFileSync(path, "old");
    chmodSync(path, 0o600);
    assert.equal(await run(["--compact", "-o", path, "--force", "code-lists"], makeCli().deps), 0);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), PAGE);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const link = join(dir, "latest.xml");
    symlinkSync(path, link);
    assert.equal(await run(["-o", link, "--force", "schemas", "xdf", "S1", "1.0"], makeCli().deps), 0);
    assert.equal(readFileSync(path, "utf8"), XML);
    assert.deepEqual(readdirSync(dir).sort(), ["latest.xml", "out.json"]);
  });
});

test("--force to a new path creates the file; over a dangling link it replaces the link with the file", async () => {
  await inTempDir(async (dir) => {
    const fresh = join(dir, "fresh.json");
    assert.equal(await run(["--compact", "-o", fresh, "--force", "code-lists"], makeCli().deps), 0);
    assert.deepEqual(JSON.parse(readFileSync(fresh, "utf8")), PAGE);
    const dangling = join(dir, "dangling.json");
    symlinkSync(join(dir, "nowhere"), dangling);
    assert.equal(await run(["--compact", "-o", dangling, "--force", "code-lists"], makeCli().deps), 0);
    assert.deepEqual(JSON.parse(readFileSync(dangling, "utf8")), PAGE);
    assert.deepEqual(readdirSync(dir).sort(), ["dangling.json", "fresh.json"]);
  });
});

test("a file that appears during the request is not overwritten: exit 1, an ERROR of the output area", async () => {
  await inTempDir(async (dir) => {
    const path = join(dir, "race.json");
    const cli = makeCli(() => {
      writeFileSync(path, "theirs");
      return jsonResponse(PAGE);
    });
    assert.equal(await run(["-o", path, "code-lists"], cli.deps), 1);
    assert.equal(readFileSync(path, "utf8"), "theirs");
    assert.deepEqual(cli.err, [`ERROR [fim-portal.output] Refusing to overwrite existing file "${path}"; pass --force to overwrite.`]);
    assert.deepEqual(readdirSync(dir), ["race.json"]);
  });
});

test("a write the file system refuses is an ERROR of the output area naming the file, exit 1", async () => {
  await inTempDir(async (dir) => {
    for (const argv of [["code-lists"], ["schemas", "xdf", "S1", "1.0"]]) {
      const path = join(dir, "missing-dir", "out.json");
      const cli = makeCli();
      assert.equal(await run(["-o", path, ...argv], cli.deps), 1);
      assert.equal(cli.err.length, 1, cli.err.join("\n"));
      assert.match(cli.err[0]!, new RegExp(`^ERROR \\[fim-portal\\.output\\] Could not write to ".*out\\.json": ENOENT`));
    }
    assert.deepEqual(readdirSync(dir), []);
  });
});
