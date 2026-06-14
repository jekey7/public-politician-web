import assert from "node:assert/strict";
import test from "node:test";
import { politicians } from "../src/lib/mock-data";
import { buildPublicSnapshot, allProfileEvidence } from "../src/lib/snapshot";
import { reconstructProfilesFromSnapshot, type SnapshotCoverageSidecar } from "../src/lib/snapshot-reader";
import type { PublicSnapshot } from "../src/lib/types";

const generatedAt = "2026-06-11T00:00:00.000Z";
const snapshot = buildPublicSnapshot(politicians, generatedAt);
const reconstructed = reconstructProfilesFromSnapshot(snapshot);

test("reconstruct preserves politician identity and order", () => {
  assert.equal(reconstructed.length, politicians.length);
  for (let i = 0; i < politicians.length; i += 1) {
    assert.equal(reconstructed[i]!.politicianId, politicians[i]!.politicianId);
    assert.equal(reconstructed[i]!.displayName, politicians[i]!.displayName);
  }
});

test("reconstruct is a faithful inverse of buildPublicSnapshot (round-trip facts)", () => {
  // Every evidence value, with source metadata, survives the snapshot round-trip into the same field array.
  for (let i = 0; i < politicians.length; i += 1) {
    const original = allProfileEvidence(politicians[i]!);
    const back = allProfileEvidence(reconstructed[i]!);
    assert.equal(back.length, original.length, `${politicians[i]!.politicianId} evidence count`);

    const key = (e: (typeof original)[number]) =>
      `${e.evidenceId}|${e.category}|${e.field}|${String(e.value)}|${e.source.sourceId}|${e.source.sourceUrl}`;
    assert.deepEqual(new Set(back.map(key)), new Set(original.map(key)));
  }
});

test("reconstruct routes facts into the correct profile arrays (no data crossing fields)", () => {
  const original = politicians[0]!;
  const rebuilt = reconstructed[0]!;
  // identity field routing
  assert.deepEqual(
    rebuilt.party.map((e) => e.value),
    original.party.map((e) => e.value),
  );
  assert.deepEqual(
    rebuilt.education.map((e) => e.value),
    original.education.map((e) => e.value),
  );
  assert.deepEqual(
    rebuilt.activities.committees.map((e) => e.value),
    original.activities.committees.map((e) => e.value),
  );
});

test("reconstruct preserves detected discrepancies with both sources un-merged (불변 #4)", () => {
  for (let i = 0; i < politicians.length; i += 1) {
    const original = politicians[i]!.discrepancies;
    const back = reconstructed[i]!.discrepancies;
    assert.equal(back.length, original.length);
    assert.deepEqual(
      new Set(back.map((d) => d.discrepancyId)),
      new Set(original.map((d) => d.discrepancyId)),
    );
    // Each discrepancy still references >=2 distinct evidence ids that exist on the reconstructed profile.
    const evidenceIds = new Set(allProfileEvidence(reconstructed[i]!).map((e) => e.evidenceId));
    for (const d of back) {
      assert.ok(d.evidenceIds.length >= 2);
      for (const id of d.evidenceIds) assert.ok(evidenceIds.has(id), `missing evidence ${id}`);
    }
  }
});

test("reconstruct attaches news only to existing profiles", () => {
  const withNews = reconstructed.find((p) => p.news.length > 0);
  assert.ok(withNews, "expected at least one profile with news");
  assert.equal(withNews!.news[0]!.politicianId, withNews!.politicianId);
});

test("coverage sidecar carries ambiguous-withheld / out-of-scope onto matching profiles (불변 #3)", () => {
  const targetId = politicians[0]!.politicianId;
  const sidecar: SnapshotCoverageSidecar = {
    generated_at: generatedAt,
    coverage: {
      [targetId]: { status: "ambiguous_withheld", reason: "동명이인 — 식별 불가, NEC 교차검증 보류" },
    },
  };
  const withCoverage = reconstructProfilesFromSnapshot(snapshot, sidecar);
  const target = withCoverage.find((p) => p.politicianId === targetId)!;
  assert.equal(target.necCoverage?.status, "ambiguous_withheld");
  assert.equal(target.necCoverage?.reason, "동명이인 — 식별 불가, NEC 교차검증 보류");
  // Profiles not named in the sidecar carry NO label (불변 #3: 라벨을 지어내지 않는다).
  const other = withCoverage.find((p) => p.politicianId !== targetId);
  assert.equal(other?.necCoverage, undefined);
});

test("reconstruct without a sidecar leaves coverage absent (no invented label)", () => {
  for (const p of reconstructed) assert.equal(p.necCoverage, undefined);
});

test("reconstruct of an empty snapshot yields an empty array (no crash)", () => {
  const empty: PublicSnapshot = {
    schema_version: "0.1.0",
    generated_at: generatedAt,
    assumptions: [],
    verified_facts: [],
    discrepancies: [],
    news_feed: [],
  };
  assert.deepEqual(reconstructProfilesFromSnapshot(empty), []);
});
