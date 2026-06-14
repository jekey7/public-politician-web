import assert from "node:assert/strict";
import test from "node:test";
import { politicians } from "../src/lib/mock-data";
import { buildPublicSnapshot } from "../src/lib/snapshot";
import { validatePublicSnapshot } from "../src/lib/snapshot-validator";

const snapshot = buildPublicSnapshot(politicians, "2026-06-11T00:00:00.000Z");

test("snapshot separates facts, discrepancies, and news", () => {
  assert.equal(snapshot.schema_version, "0.1.0");
  assert.ok(snapshot.verified_facts.length > 0);
  assert.ok(snapshot.discrepancies.length > 0);
  assert.ok(snapshot.news_feed.length > 0);
});

test("snapshot passes public snapshot validator", () => {
  const result = validatePublicSnapshot(snapshot);

  assert.deepEqual(result, { valid: true, errors: [] });
});

test("every fact row keeps source metadata with the value", () => {
  for (const fact of snapshot.verified_facts) {
    assert.ok(fact.value !== "");
    assert.ok(fact.raw_text);
    assert.ok(fact.source_id);
    assert.ok(fact.source_kind);
    assert.ok(fact.source_org);
    assert.ok(fact.source_url);
    assert.ok(fact.fetched_at);
    assert.ok(fact.license_note);
  }
});

test("discrepancy evidence ids reference existing fact evidence", () => {
  const evidenceIds = new Set(snapshot.verified_facts.map((fact) => fact.evidence_id));

  for (const discrepancy of snapshot.discrepancies) {
    assert.ok(discrepancy.evidence_ids.length > 1);
    for (const evidenceId of discrepancy.evidence_ids) {
      assert.equal(evidenceIds.has(evidenceId), true, `${discrepancy.discrepancy_id} references missing ${evidenceId}`);
    }
  }
});

test("news rows do not carry hosted article bodies or image assets", () => {
  for (const item of snapshot.news_feed) {
    assert.ok(item.title);
    assert.ok(item.publisher);
    assert.ok(item.source_url);
    assert.equal(Object.hasOwn(item, "body"), false);
    assert.equal(Object.hasOwn(item, "image"), false);
    assert.equal(Object.hasOwn(item, "thumbnail"), false);
  }
});

test("snapshot validator rejects extra fact fields", () => {
  const invalidSnapshot = structuredClone(snapshot);
  Object.assign(invalidSnapshot.verified_facts[0] ?? {}, { body: "not allowed" });
  const result = validatePublicSnapshot(invalidSnapshot);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("body is not allowed")));
});

test("snapshot validator rejects missing discrepancy evidence", () => {
  const invalidSnapshot = structuredClone(snapshot);
  if (invalidSnapshot.discrepancies[0]) invalidSnapshot.discrepancies[0].evidence_ids = ["missing-evidence"];
  const result = validatePublicSnapshot(invalidSnapshot);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("missing-evidence")));
});
