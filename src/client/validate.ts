// The library's input rules, as pure functions. Each `<thing>Problem(value)`
// returns the reason a value is invalid, or `undefined` when it is valid. The
// library enforces them with assertValid() before any request; the CLI's
// commander parsers call the same functions and turn the reason into a usage
// error, so a rule is written once and the CLI and the library cannot drift apart.

import { FimValidationError } from "./errors.js";
import type { QueryParams } from "./query.js";
import { SearchCsvResourceValues } from "./params.js";

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
