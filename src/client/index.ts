// Public entry point for the API client library.

export { FimPortalClient } from "./client.js";
export { RequestEngine, DEFAULT_BASE_URL, MAX_RETRY_AFTER_MS, parseRetryAfter } from "./engine.js";
export type { EngineOptions, RawResponse } from "./engine.js";
export { MAX_TIMEOUT_MS, nodeHttpTransport } from "./http.js";
export type { Transport, HttpRequest, HttpResponse } from "./http.js";
export { buildQueryString } from "./query.js";
export type { QueryParams, QueryValue } from "./query.js";
export {
  FimError,
  FimApiError,
  FimNetworkError,
  FimParseError,
  FimValidationError,
  redactUrl,
} from "./errors.js";
export {
  assertEnumParams,
  assertNonBlankParams,
  assertPagination,
  assertValid,
  detaillierungsstufeProblem,
  intInRangeProblem,
  isBlank,
  limitProblem,
  nonEmptyProblem,
  nonNegativeIntProblem,
  oneOfProblem,
  pathSegment,
  pathSegmentProblem,
  searchCsvResourceProblem,
  xzufiSourceProblem,
} from "./validate.js";
export type { EnumSpec, Problem } from "./validate.js";

export * from "./enums.js";
export * from "./types.js";
export * from "./params.js";
