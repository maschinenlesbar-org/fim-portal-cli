// `-o` and `--force` against real files in a temp dir, through run(): a refused target costs
// no request, a write is atomic, an existing file is never overwritten by accident. A write
// cut short is conformance test P26's.

import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
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
      [["code-lists", "-o", "--compact"], 'looks like a missing value — "--compact" is the next option'],
      [["--output=-v", "code-lists"], 'looks like a missing value — "-v" is the next option'],
      [["-o", "--force", "code-lists"], "For a file whose name starts with a dash, write ./-name."],
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

test("--force to a new path creates the file; through a dangling link it creates the file the link names (D1)", async () => {
  await inTempDir(async (dir) => {
    const fresh = join(dir, "fresh.json");
    assert.equal(await run(["--compact", "-o", fresh, "--force", "code-lists"], makeCli().deps), 0);
    assert.deepEqual(JSON.parse(readFileSync(fresh, "utf8")), PAGE);
    // "--force writes through a symlink", also when the file it points at doesn't exist yet; a
    // relative link is resolved from the link's directory, through a chain of links.
    mkdirSync(join(dir, "sub"));
    symlinkSync("sub/nowhere.xml", join(dir, "hop.xml"));
    const dangling = join(dir, "dangling.xml");
    symlinkSync("hop.xml", dangling);
    assert.equal(await run(["-o", dangling, "--force", "schemas", "xdf", "S1", "1.0"], makeCli().deps), 0);
    assert.ok(lstatSync(dangling).isSymbolicLink(), "the link stays a link");
    assert.equal(readFileSync(join(dir, "sub", "nowhere.xml"), "utf8"), XML);
    assert.deepEqual(readdirSync(dir).sort(), ["dangling.xml", "fresh.json", "hop.xml", "sub"]);
    assert.deepEqual(readdirSync(join(dir, "sub")), ["nowhere.xml"], "no temporary file is left");
  });
});

test("a target whose directory can't take the file is a usage error before any request (D5)", async () => {
  await inTempDir(async (dir) => {
    const file = join(dir, "file.json");
    writeFileSync(file, "x");
    const readOnly = join(dir, "ro");
    mkdirSync(readOnly);
    chmodSync(readOnly, 0o555);
    const loop = join(dir, "loop.json");
    symlinkSync("loop.json", loop);
    const danglingIntoMissing = join(dir, "away.json");
    symlinkSync("missing/x.json", danglingIntoMissing);
    const cases: Array<[string[], RegExp]> = [
      [["-o", join(dir, "missing", "x.json")], /the directory ".*missing" does not exist\./],
      [["-o", join(file, "x.json")], /".*file\.json" is not a directory\./],
      [["-o", join(readOnly, "x.json")], /no permission to create files in ".*ro"\./],
      [["-o", danglingIntoMissing, "--force"], /the directory ".*missing" does not exist\./],
      [["-o", loop, "--force"], /too many levels of symbolic links/],
    ];
    try {
      for (const [argv, message] of cases) {
        for (const command of [["code-lists"], ["schemas", "xdf", "S1", "1.0"]]) {
          const cli = makeCli();
          assert.equal(await run([...argv, ...command], cli.deps), 1, argv.join(" "));
          assert.equal(cli.mt.calls.length, 0, `${argv.join(" ")} sent a request`);
          assert.match(cli.err.join("\n"), /^ERROR \[fim-portal\.cli\] Cannot write to "/, argv.join(" "));
          assert.match(cli.err.join("\n"), message, argv.join(" "));
        }
      }
    } finally {
      chmodSync(readOnly, 0o755);
    }
  });
});

test("a file name of up to 255 bytes is written: the temporary name stays within NAME_MAX (D5)", async () => {
  await inTempDir(async (dir) => {
    for (const name of [`${"x".repeat(250)}.xml`, `${"ü".repeat(125)}.xml`, `${"😀".repeat(62)}.xml`]) {
      assert.ok(Buffer.byteLength(name) <= 255, name);
      const path = join(dir, name);
      const cli = makeCli();
      assert.equal(await run(["-o", path, "schemas", "xdf", "S1", "1.0"], cli.deps), 0, cli.err.join("\n"));
      assert.equal(readFileSync(path, "utf8"), XML);
      assert.equal(await run(["-o", path, "--force", "schemas", "xdf", "S1", "1.0"], makeCli().deps), 0);
    }
    assert.equal(readdirSync(dir).length, 3, "no temporary file is left");
  });
});

test("a stream target (/dev/null) needs no --force and is written in place (D5)", async () => {
  for (const argv of [["-o", "/dev/null"], ["-o", "/dev/null", "--force"]]) {
    for (const [command, note] of [[["code-lists"], ""], [["schemas", "xdf", "S1", "1.0"], " \\(Content-Type: application/xml\\)"]] as const) {
      const cli = makeCli();
      assert.equal(await run([...argv, ...command], cli.deps), 0, cli.err.join("\n"));
      assert.equal(cli.mt.calls.length, 1);
      assert.match(cli.err.join("\n"), new RegExp(`^INFO  \\[fim-portal\\.output\\] Wrote \\d+ bytes to /dev/null${note}$`));
    }
  }
  assert.ok(statSync("/dev/null").isCharacterDevice(), "/dev/null is still the device");
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

test("a write the file system refuses is an ERROR of the output area naming the file, not the temporary one; exit 1", async () => {
  await inTempDir(async (dir) => {
    for (const argv of [["code-lists"], ["schemas", "xdf", "S1", "1.0"]]) {
      const sub = join(dir, "gone");
      mkdirSync(sub);
      const path = join(sub, "out.json");
      // The directory is there when -o is checked, and gone when the answer is written.
      const cli = makeCli((req) => {
        rmSync(sub, { recursive: true });
        return req.url.includes("/xdf") ? rawResponse(XML, "application/xml") : jsonResponse(PAGE);
      });
      assert.equal(await run(["-o", path, ...argv], cli.deps), 1);
      assert.equal(cli.err.length, 1, cli.err.join("\n"));
      assert.match(cli.err[0]!, new RegExp(`^ERROR \\[fim-portal\\.output\\] Could not write to ".*out\\.json": ENOENT: no such file or directory$`));
    }
    assert.deepEqual(readdirSync(dir), []);
  });
});

test("a file whose name starts with a dash is written as ./-name (T13)", async () => {
  await inTempDir(async (dir) => {
    const path = join(dir, "-v.json");
    const cli = makeCli();
    assert.equal(await run(["-o", `${dir}/./-v.json`, "code-lists"], cli.deps), 0, cli.err.join("\n"));
    assert.equal(cli.mt.calls.length, 1);
    assert.match(readFileSync(path, "utf8"), /rotes/);
  });
});
