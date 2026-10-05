// Public entry point for the API client library.

export { FimPortalClient } from "./client.js";
export {
  RequestEngine,
  DEFAULT_BASE_URL,
  MAX_RETRIES,
  MAX_RETRY_AFTER_MS,
  assertHeaderValue,
  intOption,
  isTransientNetworkError,
  parseRetryAfter,
  validateBaseUrl,
} from "./engine.js";
export { MAX_DETAIL_LENGTH, cleanDetail, decodeBody, responseShapeProblem } from "./engine.js";
export type { EngineOptions, RawResponse, ResponseShape } from "./engine.js";
export { MAX_TIMEOUT_MS, nodeHttpTransport, sizeLimitMessage } from "./http.js";
export type { Transport, HttpRequest, HttpResponse } from "./http.js";
export { buildQueryString } from "./query.js";
export type { QueryParams, QueryValue } from "./query.js";
export {
  FimError,
  FimApiError,
  FimNetworkError,
  FimParseError,
  FimValidationError,
  MAX_MESSAGE_VALUE_LENGTH,
  credentialsIn,
  cutForMessage,
  redactCredentials,
  redactUrl,
} from "./errors.js";
export {
  assertEnumParams,
  assertNonBlankParams,
  assertPagination,
  assertValid,
  baseUrlProblem,
  baseUrlWhitespaceProblem,
  detaillierungsstufeProblem,
  headerValueProblem,
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
export {
  CODE_LIST_PARAMS,
  CSV_ORDER_VALUES,
  DOCUMENT_PROFILE_SEARCH_PARAMS,
  FIELD_SEARCH_PARAMS,
  GROUP_SEARCH_PARAMS,
  PROCESS_CLASS_SEARCH_PARAMS,
  PROCESS_SEARCH_PARAMS,
  SCHEMA_SEARCH_PARAMS,
  SEARCH_CSV_FILTERS,
  SERVICE_PROFILE_SEARCH_PARAMS,
  SERVICE_TEXT_SEARCH_PARAMS,
  XZUFI_FTS_LIST_PARAMS,
  XZUFI_LIST_PARAMS,
  assertParams,
  assertSearchCsvParams,
} from "./filters.js";
export type { CsvFilter, FilterOptions, ParamKind, ParamSpec } from "./filters.js";

export * from "./enums.js";
export * from "./types.js";
export * from "./params.js";
