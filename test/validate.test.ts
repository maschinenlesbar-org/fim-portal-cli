import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertEnumParams,
  assertNonBlankParams,
  assertPagination,
  assertValid,
  headerValueProblem,
  intInRangeProblem,
  isBlank,
  nonEmptyProblem,
  nonNegativeIntProblem,
  oneOfProblem,
  pathSegment,
  pathSegmentProblem,
  searchCsvResourceProblem,
  type Problem,
} from "../src/client/validate.js";
import { FimError, FimValidationError } from "../src/client/errors.js";
import * as lib from "../src/index.js";
import { run } from "../src/cli/run.js";
import { FimPortalClient } from "../src/client/client.js";
import type { CliDeps } from "../src/cli/io.js";
import type { QueryParams } from "../src/client/query.js";
import { LIMIT_MAX, LIMIT_MIN } from "../src/client/params.js";
import { jsonResponse, makeMockTransport, parity } from "./helpers.js";

const notFoo: Problem<string> = (v) => (v === "foo" ? "Must not be foo." : undefined);

test("assertValid returns a valid value unchanged", () => {
  assert.equal(assertValid("thing", "bar", notFoo), "bar");
});

test("assertValid throws FimValidationError 'Invalid <name>: <reason>'", () => {
  assert.throws(
    () => assertValid("thing", "foo", notFoo),
    (err: unknown) => {
      assert.ok(err instanceof FimValidationError);
      assert.ok(err instanceof FimError);
      assert.equal((err as Error).name, "FimValidationError");
      assert.equal((err as Error).message, "Invalid thing: Must not be foo.");
      return true;
    },
  );
});

test("the validation layer is exported from the package root", () => {
  assert.equal(lib.FimValidationError, FimValidationError);
  assert.equal(lib.assertValid, assertValid);
});

function cliWith(createClient: CliDeps["createClient"]) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    io: { out: (s) => out.push(s), err: (s) => err.push(s), writeFile: () => {}, outBinary: () => {} },
    createClient,
  };
  return { deps, out, err };
}

test("run() maps a FimValidationError from an action to the usage exit code 1 with 'Error: <message>'", async () => {
  const mt = makeMockTransport(() => jsonResponse({}));
  const cli = cliWith((opts) => {
    const client = new FimPortalClient({ ...opts, transport: mt.transport });
    client.schemas.versions = async () => {
      throw new FimValidationError("Invalid fimId: Expected a non-empty value.");
    };
    return client;
  });
  const code = await run(["schemas", "versions", "S1"], cli.deps);
  assert.equal(code, 1);
  assert.deepEqual(cli.out, []);
  assert.equal(cli.err.join("\n"), "Error: Invalid fimId: Expected a non-empty value.");
  assert.equal(mt.calls.length, 0);
});

test("run() maps a FimValidationError thrown while building the client the same way", async () => {
  const cli = cliWith(() => {
    throw new FimValidationError("Invalid timeoutMs: Must be >= 0.");
  });
  assert.equal(await run(["schemas", "versions", "S1"], cli.deps), 1);
  assert.equal(cli.err.join("\n"), "Error: Invalid timeoutMs: Must be >= 0.");
});

test("parity() drives the same input through run() and the library on one transport", async () => {
  const { cli, lib: res } = await parity(["--compact", "schemas", "versions", "S1"], (transport) =>
    new FimPortalClient({ transport }).schemas.versions("S1"),
    () => jsonResponse([{ fim_id: "S1" }]),
  );
  assert.equal(cli.code, 0);
  assert.equal(cli.out, JSON.stringify([{ fim_id: "S1" }]));
  assert.ok(res.ok);
  assert.deepEqual(res.value, [{ fim_id: "S1" }]);
  assert.deepEqual(cli.requests.map((r) => r.url), res.requests.map((r) => r.url));
});

// ---- blank values (PAT-9) ----

test("isBlank is true for empty and whitespace-only strings only", () => {
  for (const v of ["", " ", "   ", "\t", "\n", " \t\r\n"]) assert.equal(isBlank(v), true, JSON.stringify(v));
  for (const v of ["a", " a ", "0", "."]) assert.equal(isBlank(v), false, JSON.stringify(v));
});

test("nonEmptyProblem rejects a blank value with the CLI's message", () => {
  assert.equal(nonEmptyProblem(""), "Expected a non-empty value.");
  assert.equal(nonEmptyProblem(" \t"), "Expected a non-empty value.");
  assert.equal(nonEmptyProblem("Geburt"), undefined);
});

test("assertNonBlankParams rejects blank values, blank array elements, empty arrays and blank names", () => {
  const cases: Array<[QueryParams, string]> = [
    [{ name: "" }, "Invalid name: Expected a non-empty value."],
    [{ fts_query: "  " }, "Invalid fts_query: Expected a non-empty value."],
    [{ nummernkreis: ["07", " "] }, "Invalid nummernkreis: Expected a non-empty value."],
    [{ nummernkreis: [] }, "Invalid nummernkreis: Expected at least one value."],
    [{ " ": "x" }, "Invalid query parameter name: Expected a non-empty value."],
  ];
  for (const [params, message] of cases) {
    assert.throws(
      () => assertNonBlankParams(params),
      (err: unknown) => err instanceof FimValidationError && (err as Error).message === message,
      JSON.stringify(params),
    );
  }
});

test("assertNonBlankParams accepts omitted values and non-string values", () => {
  assertNonBlankParams({
    name: "Geburt",
    bezug: undefined,
    gueltig_am: null,
    limit: 10,
    is_latest: false,
    freigabe_status: [5, 6],
    nummernkreis: ["07"],
  });
});

// ---- path ids (PAT-10) ----

test("pathSegmentProblem rejects a blank or non-string id", () => {
  assert.equal(pathSegmentProblem(""), "Expected a non-empty value.");
  assert.equal(pathSegmentProblem(" \t"), "Expected a non-empty value.");
  assert.equal(pathSegmentProblem(undefined as unknown as string), "Expected a non-empty value.");
  assert.equal(pathSegmentProblem("S07000009"), undefined);
  assert.equal(pathSegmentProblem(" S1 "), undefined);
});

test("pathSegment percent-encodes a valid id and names the parameter on a blank one", () => {
  assert.equal(pathSegment("namespace", "urn:xoev-de:fim"), "urn%3Axoev-de%3Afim");
  assert.equal(pathSegment("fimVersion", "1.0"), "1.0");
  assert.throws(
    () => pathSegment("fimId", " "),
    (err: unknown) => err instanceof FimValidationError && (err as Error).message === "Invalid fimId: Expected a non-empty value.",
  );
});

// ---- enumerated values (PAT-12) ----

test("oneOfProblem accepts exactly the listed values", () => {
  const problem = oneOfProblem(["a", "b"] as const);
  assert.equal(problem("a"), undefined);
  assert.equal(problem("b"), undefined);
  for (const v of ["c", " a", "A", "", undefined, null, 1, "toString", "constructor"]) {
    assert.equal(problem(v), "Expected one of: a, b.", String(v));
  }
});

test("searchCsvResourceProblem accepts the portal's singular resource names only", () => {
  for (const v of ["schema", "document-profile", "field", "group", "leistung-steckbriefe", "processclass", "process"]) {
    assert.equal(searchCsvResourceProblem(v), undefined, v);
  }
  for (const v of ["schemas", "fields", " schema", "", undefined]) {
    assert.match(searchCsvResourceProblem(v) ?? "", /^Expected one of: schema, /, String(v));
  }
});

test("assertEnumParams checks each listed parameter, scalar or array, and ignores the rest", () => {
  const spec = { feldart: ["input", "select"], freigabe_status: [1, 2] } as const;
  assertEnumParams({ feldart: "input", freigabe_status: [1, 2], name: "anything", limit: 5 }, spec);
  assertEnumParams({ feldart: undefined, freigabe_status: null }, spec);
  for (const [params, message] of [
    [{ feldart: "INPUT" }, "Invalid feldart: Expected one of: input, select."],
    [{ freigabe_status: [1, 3] }, "Invalid freigabe_status: Expected one of: 1, 2."],
    [{ freigabe_status: ["1"] }, "Invalid freigabe_status: Expected one of: 1, 2."],
    [{ freigabe_status: 3 }, "Invalid freigabe_status: Expected one of: 1, 2."],
  ] as const) {
    assert.throws(
      () => assertEnumParams(params, spec),
      (err: unknown) => err instanceof FimValidationError && (err as Error).message === message,
      JSON.stringify(params),
    );
  }
});

// ---- pagination (PAT-11) ----

test("intInRangeProblem accepts safe integers in range only, with the CLI's messages", () => {
  const p = intInRangeProblem(1, 200);
  for (const v of [1, 100, 200]) assert.equal(p(v), undefined, String(v));
  for (const [v, reason] of [
    [0, "Must be >= 1."],
    [-1, "Must be >= 1."],
    [201, "Must be <= 200."],
    [1.5, "Expected an integer."],
    [NaN, "Expected an integer."],
    [Infinity, "Expected an integer."],
    [2 ** 53, "Expected an integer."],
    ["10", "Expected an integer."],
  ] as const) {
    assert.equal(p(v), reason, String(v));
  }
});

test("nonNegativeIntProblem accepts 0 and positive safe integers only", () => {
  for (const v of [0, 1, Number.MAX_SAFE_INTEGER]) assert.equal(nonNegativeIntProblem(v), undefined, String(v));
  for (const v of [-1, 1.5, NaN, Infinity, 1e21, "5"]) {
    assert.equal(nonNegativeIntProblem(v), "Expected a non-negative integer.", String(v));
  }
});

test("assertPagination checks offset, limit and cursor when set", () => {
  assert.equal(LIMIT_MIN, 1);
  assert.equal(LIMIT_MAX, 200);
  assertPagination({});
  assertPagination({ offset: 0, limit: 1, cursor: 0 });
  assertPagination({ offset: 10_000, limit: 200, cursor: 5, name: "x" });
  for (const [params, message] of [
    [{ limit: 201 }, "Invalid limit: Must be <= 200."],
    [{ limit: 0 }, "Invalid limit: Must be >= 1."],
    [{ offset: -1 }, "Invalid offset: Expected a non-negative integer."],
    [{ cursor: NaN }, "Invalid cursor: Expected a non-negative integer."],
  ] as const) {
    assert.throws(
      () => assertPagination(params),
      (err: unknown) => err instanceof FimValidationError && (err as Error).message === message,
      JSON.stringify(params),
    );
  }
});

// ---- header values (PAT-5) ----

test("headerValueProblem allows Latin-1 and tab, and rejects blank, controls, DEL and > U+00FF", () => {
  for (const v of ["fim-portal-cli", "müller-bot/1.0\t(test)", "a b"]) assert.equal(headerValueProblem(v), undefined, v);
  for (const [v, reason] of [
    ["", "Expected a non-empty value."],
    [" \t ", "Expected a non-empty value."],
    ["a" + String.fromCharCode(0x0d, 0x0a) + "b", "Value contains control characters."],
    ["a" + String.fromCharCode(0), "Value contains control characters."],
    ["a" + String.fromCharCode(0x7f), "Value contains control characters."],
    ["agent€", "Value contains characters outside Latin-1 (above U+00FF)."],
    [undefined, "Expected a non-empty value."],
  ] as const) {
    assert.equal(headerValueProblem(v), reason, JSON.stringify(v));
  }
});
