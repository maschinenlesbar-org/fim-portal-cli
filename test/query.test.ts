import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQueryString } from "../src/client/query.js";

test("buildQueryString omits undefined and null values", () => {
  const qs = buildQueryString({ a: "x", b: undefined, c: null });
  assert.equal(qs, "a=x");
});

test("buildQueryString serialises arrays as repeated keys", () => {
  const qs = buildQueryString({ freigabe_status: [3, 5, 6] });
  assert.equal(qs, "freigabe_status=3&freigabe_status=5&freigabe_status=6");
});

test("buildQueryString skips null/undefined entries inside arrays", () => {
  const qs = buildQueryString({ nummernkreis: ["01", undefined, null, "02"] });
  assert.equal(qs, "nummernkreis=01&nummernkreis=02");
});

test("buildQueryString renders booleans as true/false strings", () => {
  assert.equal(buildQueryString({ is_latest: true }), "is_latest=true");
  assert.equal(buildQueryString({ is_latest: false }), "is_latest=false");
});

test("buildQueryString renders Date as ISO-8601", () => {
  const d = new Date("2023-10-17T16:50:40.000Z");
  assert.equal(buildQueryString({ updated_since: d }), "updated_since=2023-10-17T16%3A50%3A40.000Z");
});

test("buildQueryString encodes spaces as %20, not +", () => {
  const qs = buildQueryString({ name: "Geburt Kind" });
  assert.equal(qs, "name=Geburt%20Kind");
});

test("buildQueryString returns empty string when nothing survives", () => {
  assert.equal(buildQueryString({ a: undefined, b: null }), "");
});

test("buildQueryString encodes reserved characters in keys and values", () => {
  const qs = buildQueryString({ "fts_query": "a&b=c" });
  assert.equal(qs, "fts_query=a%26b%3Dc");
});
