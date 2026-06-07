# fim-portal-cli — exploratory bug report

**Environment note.** Tested on macOS (Darwin 25.5.0), Node present, against the
build produced by `npm run build` (succeeded, no errors). The live FIM Portal API
(`https://fimportal.de`) and the alternate base URL `https://schema.fim.fitko.net`
were **reachable** throughout testing; all "live" repros below hit the real API.
CLI invoked as `node dist/src/cli/index.js ...` from
`/Users/sebastian.schuermann/private/machinenlesbar.org/api-cli/fim-portal-cli`.

Many things work well and are explicitly **not** bugs: enum/`choices()` validation
(`--feldart`, `--datentyp`, `--order-by`, `--xdf-version`, `--freigabe-status`,
positional `source`/`stufe`), `--limit`/`--offset` range checks, URL-encoding of ids
(`..%2F..%2F` — no traversal), non-http scheme rejection, write-failure handling
(directory / nonexistent dir / read-only FS all exit 1 with a clean message),
`--max-response-bytes` cap, `--timeout`, bad host / closed port, 404 → exit 4,
binary-safe stdout piping, and verbatim JSON pass-through (no dropped fields vs curl
for `schemas`/`service-profiles` search).

Repros use the shorthand `CLI = node dist/src/cli/index.js`.

---

## High severity

### 1. Large integer args silently corrupted (precision loss) before being sent — ✅ FIXED
**Fix:** Added `parseDecimalInt` in `src/cli/shared.ts`, used by `parseIntArg`/`parseBoundedInt`. It rejects values that are not safe integers (`Number.isSafeInteger`), so `99999999999999999999` is now rejected instead of being silently rounded.
- **Severity:** High · **Confidence:** High
- **Repro:** `CLI schemas search --offset 99999999999999999999 --limit 1`
- **Expected:** Either rejection (not a representable integer) or the exact value sent.
- **Actual (exit 1):**
  ```
  Error: HTTP 500 for GET https://fimportal.de/api/v1/schemas?offset=100000000000000000000&limit=1
  ```
  The user typed `99999999999999999999` but `100000000000000000000` was sent — a
  **different number**, silently rounded.
- **Root cause:** `parseIntArg` in `src/cli/shared.ts:16-22` uses `Number(value)`.
  `Number("99999999999999999999")` = `1e20`, `Number.isInteger(1e20)` is `true`, so it
  passes the guard, then `String()` in `query.ts` emits the rounded value. A data-integrity
  defect: the value transmitted differs from what the user entered.

### 2. `--limit` / `--offset` "integer" parsers accept hex, binary, scientific, signed, padded — ✅ FIXED
**Fix:** `parseDecimalInt` in `src/cli/shared.ts` now requires the canonical `/^-?\d+$/` form, rejecting `0x10`, `0b101`, `1e2`, `+5`, and whitespace-padded values. Covers all global numeric flags and `--cursor`, which share these parsers.
- **Severity:** High · **Confidence:** High
- **Repro (each prints results, exit 0):**
  - `CLI --compact schemas search --offset 0x10 --limit 1`  (hex → 16)
  - `CLI --compact schemas search --limit 1e2`              (scientific → 100)
  - `CLI --compact schemas search --offset 0b101 --limit 1` (binary → 5)
  - `CLI --compact schemas search --offset +5 --limit 1`    (signed → 5)
  - `CLI --compact schemas search --offset " 5 " --limit 1` (whitespace-padded → 5)
- **Expected:** The help text says "Expected a non-negative integer" / "Expected an
  integer"; these are not decimal integers and should be rejected (`abc`, `Infinity`,
  `1.5`, `-1`, `""` *are* correctly rejected, so the contract is "integer").
- **Actual:** All silently accepted and coerced via `Number()`.
- **Root cause:** `parseIntArg` (`shared.ts:16-22`) and `parseBoundedInt` (`shared.ts:28-36`)
  validate with `Number()` + `Number.isInteger()`, which accepts `0x`/`0b`/`1e2`/`+`/padded
  forms. Same root cause as #1; affects `--limit`, `--offset`, `--cursor`, `--timeout`,
  `--max-retries`, `--max-response-bytes` (all global numeric flags).

### 3. API 422 validation errors are reported with **no detail** (opaque) — ✅ FIXED
**Fix:** Added `formatDetail` in `src/client/engine.ts` and used it in `toApiError`. It now handles FastAPI's array-of-objects `detail` shape, joining each entry as `loc.path: msg` (e.g. `query.gueltig_am: Input should be a valid date or datetime`), in addition to the plain-string form.
- **Severity:** High · **Confidence:** High
- **Repro:** `CLI schemas search --gueltig-am "not-a-date" --limit 1`
- **Expected:** Surface what was wrong, e.g. "gueltig_am: Input should be a valid date".
- **Actual (exit 1):**
  ```
  Error: HTTP 422 for GET https://fimportal.de/api/v1/schemas?gueltig_am=not-a-date&limit=1
  ```
  The server body actually contains rich detail (verified via curl):
  `{"detail":[{"type":"date_from_datetime_parsing","loc":["query","gueltig_am"],
  "msg":"Input should be a valid date or datetime...","input":"not-a-date",...}]}`
  — none of it is shown.
- **Root cause:** `RequestEngine.toApiError` (`src/client/engine.ts:129-139`) only keeps
  `detail` when `typeof parsed.detail === "string"`. FastAPI 422 validation errors return
  `detail` as an **array of objects**, so it's dropped, and `FimApiError`
  (`src/client/errors.ts:30-31`) appends nothing. The full `body` is stored on the error
  object but never printed. Every 422 is opaque to the CLI user.

---

## Medium severity

### 4. `processes visualization` / `visualization-display` return PDF, not BPMN/XML — ✅ FIXED
**Fix:** `downloadVisualization`/`downloadVisualizationDisplay` in `src/client/client.ts` now negotiate `ACCEPT_PDF` to match what the server serves; command descriptions in `src/cli/commands/processes.ts` and the README example (`vis.pdf`) updated accordingly. The returned Content-Type is now also surfaced (see #6).
- **Severity:** Medium · **Confidence:** High
- **Repro:** `CLI -o /tmp/v.bpmn processes visualization 99063078261000 01.00.00 101`
- **Expected:** Per README example (`fim-portal -o vis.bpmn processes visualization ...`)
  and the `Accept: application/xml` the client sends, a BPMN/XML file.
- **Actual (exit 0):** `Wrote 293569 bytes`; `file /tmp/v.bpmn` →
  `PDF document, version 1.4`; first bytes `%PDF-1.4`. Server `Content-Type: application/pdf`
  (confirmed via curl) regardless of the `Accept: application/xml` header.
- **Root cause:** `ProcessesResource.downloadVisualization` / `downloadVisualizationDisplay`
  (`src/client/client.ts:274-290`) hard-code `ACCEPT_XML`; the endpoint actually serves PDF.
  The README example (`README.md:113`) names the output `.bpmn`, compounding the mismatch.
  The CLI never inspects/surfaces the returned content-type, so users get a `.bpmn` file
  that is really a PDF.

### 5. `processes report` also returns PDF while client requests XML — ✅ FIXED
**Fix:** `downloadReport` in `src/client/client.ts` now negotiates `ACCEPT_PDF`; the CLI description in `src/cli/commands/processes.ts` updated to say "report PDF". Content-Type is now surfaced on download (see #6).
- **Severity:** Medium · **Confidence:** High
- **Repro:** `curl -sD - -o /dev/null "https://fimportal.de/api/v0/processes/99063078261000/01.00.00/101/report" -H "Accept: application/xml"` → `Content-Type: application/pdf`
- **Expected:** The `report` download is requested with `ACCEPT_XML` (`client.ts:270-272`),
  implying XML.
- **Actual:** Server returns `application/pdf`. The CLI writes the PDF bytes with no
  indication the content-type differs from requested.
- **Root cause:** `downloadReport` (`src/client/client.ts:270-272`) hard-codes `ACCEPT_XML`;
  same class of content-type mismatch as #4.

### 6. Raw downloads never expose/validate the returned content-type — ✅ FIXED
**Fix:** `renderRaw` in `src/cli/shared.ts` now appends the server's Content-Type to the confirmation it prints to stderr (both for `--output` writes and stdout streaming), e.g. `Wrote 293569 bytes to /tmp/v.pdf (Content-Type: application/pdf)`. stdout stays byte-clean for piping; the note goes to stderr.
- **Severity:** Medium · **Confidence:** High
- **Repro:** any download, e.g. `CLI -o /tmp/x.xml schemas xdf S00000000159`
- **Expected:** Given the CLI advertises distinct XML/PDF/CSV downloads, a content-type
  mismatch (e.g. an HTML/JSON error page returned with status 200, or PDF where XML was
  requested as in #4/#5) should be surfaced or at least the content-type reported.
- **Actual:** `renderRaw` (`src/cli/shared.ts:114-130`) writes `response.data` verbatim and
  only prints `Wrote N bytes`. `RawResponse.contentType` is captured (`engine.ts:104,109`)
  but never used by the CLI. A user piping to a `.xml`/`.bpmn` file has no way to learn the
  bytes are actually PDF/JSON/HTML.

### 7. `-o/--output` is silently ignored on non-download (JSON) commands — ✅ FIXED
**Fix:** `renderJson` in `src/cli/shared.ts` now honors `global.output`: when `-o` is set it writes the JSON (UTF-8, with trailing newline) to the file and reports bytes on stderr, mirroring `renderRaw`; otherwise it prints to stdout as before.
- **Severity:** Medium · **Confidence:** High
- **Repro:** `CLI -o /tmp/s.json schemas search --limit 1`
- **Expected:** Either write the JSON to the file, or warn that `-o` is unsupported here.
- **Actual (exit 0):** JSON is printed to **stdout**; `/tmp/s.json` is **not created**
  (`ls: /tmp/s.json: No such file or directory`). The flag is accepted globally but the
  JSON renderer ignores it entirely.
- **Root cause:** `-o` is a global option (`program.ts`), but `renderJson`
  (`src/cli/shared.ts:99-102`) only ever calls `deps.io.out`; only `renderRaw` honors
  `global.output`. No diagnostic is emitted for the mismatch.

---

## Low severity

### 8. `parseBoundedInt`/`parseIntArg` error wording understates what's accepted — ✅ FIXED
**Fix:** Resolved together with #1/#2: the validators in `src/cli/shared.ts` now enforce a strict decimal-integer contract, so the "integer" / "non-negative integer" wording is accurate — `1e2`/`0x10` and friends are rejected.
- **Severity:** Low · **Confidence:** High
- **Repro:** `CLI schemas search --limit 1e2` (accepted) vs `CLI schemas search --limit abc`
  → `argument 'abc' is invalid. Expected an integer.`
- **Expected:** Consistent contract — if `1e2`/`0x10` are valid, the message is wrong; if
  the contract is "decimal integer", they should be rejected (see #2).
- **Actual:** Messages claim "integer" / "non-negative integer" but accept many non-integer
  literal forms.
- **Root cause:** Same `Number()`-based validators (`shared.ts:16-36`).

### 9. README example `service-profiles pdf 99050048262000 de` is dead (404) — ✅ FIXED (docs)
**Fix:** Documentation issue, not a code defect — the IDs/language code are placeholders. Added a note in `README.md` (above the Examples block) clarifying that identifiers are illustrative placeholders to be substituted with real `search` results, and that PDF exports need a concrete API-served language code (not generic `de`).
- **Severity:** Low · **Confidence:** High
- **Repro:** `CLI service-profiles pdf 99050048262000 de`
- **Actual (exit 4):**
  `Error: HTTP 404 ... Could not find Leistungssteckbrief 99050048262000.`
  The leistungsschluessel in the README example (`README.md:105`) does not exist, and the
  PDF language code `de` is also rejected for valid profiles (`Could not find language 'de'`,
  e.g. with `99008001012012`) — `de`, `de_DE`, `Deutsch` all 404. The documented example
  cannot succeed as written.

### 10. README example `service-texts get L100001 L1 leika` is dead (404) — ✅ FIXED (docs)
**Fix:** Same class as #9 — placeholder IDs. Covered by the new "illustrative placeholders" note added above the Examples block in `README.md`.
- **Severity:** Low · **Confidence:** High
- **Repro:** `CLI service-texts get L100001 L1 leika`
- **Actual (exit 4):**
  `Error: HTTP 404 ... Could not find Leistungstammtext L1 from Redaktion L100001.`
  These look like placeholder ids; the documented example (`README.md:104`) fails live.

### 11. `--xdf-version` enum values don't match the values the API returns — ✅ FIXED
**Fix:** Added `2.0.0` to `XdfVersionValues` in `src/client/enums.ts` (now `["2.0", "2.0.0", "3.0.0"]`), so a user can filter by the value they see in results (`2.0.0`) without it being rejected by `choices()`. The existing `2.0` filter form (which the server accepts) is kept.
- **Severity:** Low · **Confidence:** Medium
- **Repro:** `CLI --compact schemas search --xdf-version 2.0 --limit 1` works (1670 hits),
  but result items report `"xdf_version":"2.0.0"` and `"3.0.0"`.
- **Expected:** The filter enum and the data values to be consistent.
- **Actual:** The filter accepts `2.0` / `3.0.0` (`XdfVersionValues`, `enums.ts:152`) while
  records carry `2.0.0` / `3.0.0`. A user filtering by the value they see (`2.0.0`) is
  rejected by `choices()`; they must know to type `2.0`. Confusing but functional (server
  accepts the filter form), so low severity.

### 12. `--user-agent ""` (empty) is accepted and used — ✅ FIXED
**Fix:** Added a `parseNonEmpty` value-parser in `src/cli/shared.ts` and attached it to the `--user-agent` option in `src/cli/program.ts`. An empty/whitespace-only User-Agent is now rejected at parse time with a clear message.
- **Severity:** Low · **Confidence:** Medium
- **Repro:** `CLI --user-agent "" --compact schemas search --limit 1` → succeeds (exit 0).
- **Expected:** Arguably reject an empty User-Agent or fall back to the default.
- **Actual:** An empty UA string is forwarded as the header value. No validation in
  `toEngineOptions` (`shared.ts:79-87`) / engine (`engine.ts:58`). Minor; the server
  tolerates it here.

### 13. `search-csv --resource <bogus>` silently returns a full default CSV (no error) — ⚠️ WONTFIX (intentional design)
**Fix:** Not a code defect. `search-csv` is a deliberate unvalidated pass-through (documented in `src/cli/commands/misc.ts:29-33`, the README note, and an existing test "search-csv forwards unvalidated values verbatim"); the OpenAPI spec types these params as free-form strings, so client-side enum guards would be wrong. The unexpected default-CSV response is server behavior. Mitigated indirectly by #6: the returned Content-Type is now reported on download.
- **Severity:** Low · **Confidence:** Medium (server-side, surfaced via the unvalidated CLI)
- **Repro:** `CLI -o /tmp/b.csv search-csv --resource bogusresource --term x`
- **Expected:** With an invalid resource name, an error or empty result.
- **Actual (exit 0):** `Wrote 113453 bytes` — a full CSV of (apparently) leistungen is
  returned. The CLI passes `--resource` through unvalidated by design (`misc.ts:29-33`), so
  the silent "wrong but successful" result is a usability trap rather than a crash. Noted
  because the README presents `--resource` as a meaningful selector.

---

## Count

**13 genuine, reproducible findings** documented above; **all 13 are real** (each verified
live against the API or by exact local output, with exit codes shown). I was unable to reach
20 without padding: the CLI's input validation, URL-encoding, write-failure handling, network
error paths, exit-code mapping (404→4, usage→1, success→0), and JSON pass-through are
genuinely solid, so the remaining probe categories produced correct behavior rather than
bugs. Padding to 20 with duplicate or speculative entries would violate the "real only" rule,
so the honest count is **13 real bugs** (3 High, 4 Medium, 6 Low).
