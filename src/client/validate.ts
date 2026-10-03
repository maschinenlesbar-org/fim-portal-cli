// The library's input rules, as pure functions. Each `<thing>Problem(value)`
// returns the reason a value is invalid, or `undefined` when it is valid. The
// library enforces them with assertValid() before any request; the CLI's
// commander parsers call the same functions and turn the reason into a usage
// error, so a rule is written once and the CLI and the library cannot drift apart.

import { FimValidationError } from "./errors.js";
import type { QueryParams } from "./query.js";
import { LIMIT_MAX, LIMIT_MIN, SearchCsvResourceValues } from "./params.js";
import { DetaillierungsstufeValues, XzufiSourceValues } from "./enums.js";

/** A rule: the reason `value` is invalid, or `undefined` when it is valid. */
export type Problem<T = unknown> = (value: T) => string | undefined;

/**
 * Throw a {@link FimValidationError} with the message `Invalid <name>: <reason>`
 * when `problem(value)` finds a reason; otherwise return `value` unchanged. Call it
 * before any request, so a rejected input sends nothing. Async methods call it
 * inside their body, so the rejection arrives as a rejected promise rather than a
 * synchronous throw.
 */
export function assertValid<T>(name: string, value: T, problem: Problem<T>): T {
  const reason = problem(value);
  if (reason !== undefined) throw new FimValidationError(`Invalid ${name}: ${reason}`);
  return value;
}

/** True for an empty or whitespace-only string. */
export function isBlank(value: string): boolean {
  return value.trim() === "";
}

/**
 * A blank value ("" or whitespace only) is invalid: the API treats an empty
 * parameter as no filter and answers with the unfiltered result, and an empty path
 * segment re-targets the request to another endpoint.
 */
export const nonEmptyProblem: Problem<string> = (value) =>
  isBlank(value) ? "Expected a non-empty value." : undefined;

/**
 * Reject query parameters that would silently widen a search: a blank parameter
 * name, a blank string value, an empty array, or a blank string inside an array.
 * `undefined` and `null` still mean "omitted"; numbers, booleans and dates are left
 * to their own rules. Throws `FimValidationError` naming the parameter
 * (`Invalid fts_query: Expected a non-empty value.`).
 */
export function assertNonBlankParams(params: QueryParams): void {
  for (const [key, raw] of Object.entries(params)) {
    assertValid("query parameter name", key, nonEmptyProblem);
    if (raw === undefined || raw === null) continue;
    if (Array.isArray(raw)) {
      if (raw.length === 0) throw new FimValidationError(`Invalid ${key}: Expected at least one value.`);
      for (const value of raw) if (typeof value === "string") assertValid(key, value, nonEmptyProblem);
    } else if (typeof raw === "string") {
      assertValid(key, raw, nonEmptyProblem);
    }
  }
}

/**
 * A path id (a FIM id, version, namespace, Leistungsschlüssel, language code, …)
 * must be a non-blank string. An empty last segment turns
 * `/api/v1/schemas/<id>` into `/api/v1/schemas/` (the search collection) and
 * `/api/v1/schemas/S1/<version>` into the versions list, which the library would
 * return as the requested object; an empty middle segment requests `//`.
 */
export const pathSegmentProblem: Problem<string> = (value) =>
  typeof value !== "string" || isBlank(value) ? "Expected a non-empty value." : undefined;

/**
 * Validate one path id (pathSegmentProblem) and percent-encode it for the request
 * path. Throws `FimValidationError` (`Invalid <name>: ...`) for a blank id. "." and
 * ".." pass through encoding unchanged and are rejected by RequestEngine.buildUrl.
 */
export function pathSegment(name: string, value: string): string {
  return encodeURIComponent(assertValid(name, value, pathSegmentProblem));
}

/**
 * A rule for an enumerated value: valid when `value` is one of `allowed` (compared
 * with `includes`, so no inherited `Object.prototype` name can pass and no trimming
 * or case-folding happens).
 */
export function oneOfProblem<T>(allowed: readonly T[]): Problem<unknown> {
  return (value) =>
    (allowed as readonly unknown[]).includes(value) ? undefined : `Expected one of: ${allowed.join(", ")}.`;
}

/**
 * The `resource` of `tools.searchCsvDownload` is required and must be one of
 * SearchCsvResourceValues: the server never rejects a value, it answers anything it
 * does not recognise (the plural `schemas`, a padded or missing name) with a CSV of
 * Leistungen.
 */
export const searchCsvResourceProblem: Problem<unknown> = oneOfProblem(SearchCsvResourceValues);

/** Which query parameters of an endpoint are enumerated, and their allowed values. */
export type EnumSpec = Readonly<Record<string, readonly unknown[]>>;

/**
 * Check every parameter `spec` lists against its allowed values (oneOfProblem); an
 * array parameter is checked element by element. `undefined`/`null` mean omitted;
 * parameters `spec` does not list are left alone. Throws `FimValidationError`
 * (`Invalid feldart: Expected one of: input, select, …`). The TypeScript unions
 * already say this, but plain-JS callers, casts and values taken from data bypass
 * them, and the API would answer with a 422 or, worse, an unfiltered result.
 */
export function assertEnumParams(params: object, spec: EnumSpec): void {
  const values = params as Record<string, unknown>;
  for (const [key, allowed] of Object.entries(spec)) {
    const value = values[key];
    if (value === undefined || value === null) continue;
    const problem = oneOfProblem(allowed);
    if (Array.isArray(value)) for (const v of value) assertValid(key, v, problem);
    else assertValid(key, value, problem);
  }
}

/** The `stufe` path segment of a process: one of DetaillierungsstufeValues (101..105). */
export const detaillierungsstufeProblem: Problem<unknown> = oneOfProblem(DetaillierungsstufeValues);

/** The `source` path segment of a service text: one of XzufiSourceValues. */
export const xzufiSourceProblem: Problem<unknown> = oneOfProblem(XzufiSourceValues);

/**
 * A rule for an integer option: valid when `value` is a safe integer in
 * `min..max`. The reasons match the CLI's integer parsers ("Expected an integer.",
 * "Must be >= 1.", "Must be <= 200.").
 */
export function intInRangeProblem(min: number, max: number = Number.MAX_SAFE_INTEGER): Problem<unknown> {
  return (value) => {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) return "Expected an integer.";
    if (value < min) return `Must be >= ${min}.`;
    if (value > max) return `Must be <= ${max}.`;
    return undefined;
  };
}

/** A non-negative safe integer (an `offset` or a `cursor`). */
export const nonNegativeIntProblem: Problem<unknown> = (value) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? undefined
    : "Expected a non-negative integer.";

/** A page size: an integer in LIMIT_MIN..LIMIT_MAX (1..200). */
export const limitProblem: Problem<unknown> = intInRangeProblem(LIMIT_MIN, LIMIT_MAX);

/**
 * Check the paging parameters a search or list call sets: `offset` and `cursor` a
 * non-negative safe integer, `limit` an integer in 1..200. `undefined`/`null` mean
 * omitted. Throws `FimValidationError` (`Invalid limit: Must be <= 200.`). The API
 * documents these bounds; NaN, Infinity, fractions or 1e21 would otherwise be sent
 * as text and fail late with a 422, or be read some other way.
 */
export function assertPagination(params: object): void {
  const { offset, limit, cursor } = params as { offset?: unknown; limit?: unknown; cursor?: unknown };
  if (offset !== undefined && offset !== null) assertValid("offset", offset, nonNegativeIntProblem);
  if (limit !== undefined && limit !== null) assertValid("limit", limit, limitProblem);
  if (cursor !== undefined && cursor !== null) assertValid("cursor", cursor, nonNegativeIntProblem);
}

/**
 * A value that goes into an HTTP header (the User-Agent): non-blank, no C0 control
 * or DEL (tab is allowed, as in HTTP), nothing above U+00FF. Node's HTTP layer
 * refuses those with an opaque "Invalid character in header content" TypeError at
 * request time, and an injected transport would send a CR/LF value as is.
 * Checked by char code so the source stays free of control bytes.
 */
export const headerValueProblem: Problem<unknown> = (value) => {
  if (typeof value !== "string" || isBlank(value)) return "Expected a non-empty value.";
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if ((c < 0x20 && c !== 0x09) || c === 0x7f) return "Value contains control characters.";
    if (c > 0xff) return "Value contains characters outside Latin-1 (above U+00FF).";
  }
  return undefined;
};
