import assert from "node:assert/strict";
import test from "node:test";
import { politicians } from "../src/lib/mock-data";
import { buildPublicSnapshot } from "../src/lib/snapshot";
import { validateSnapshotSourceLicenses } from "../src/lib/source-license";

const snapshot = buildPublicSnapshot(politicians, "2026-06-11T00:00:00.000Z");

test("current mock-only snapshot passes source license gate", () => {
  const result = validateSnapshotSourceLicenses(snapshot);

  assert.deepEqual(result, { valid: true, errors: [] });
});

test("mock rows must keep explicit mock-only license note", () => {
  const invalidSnapshot = structuredClone(snapshot);
  if (invalidSnapshot.verified_facts[0]) invalidSnapshot.verified_facts[0].license_note = "Public data license reviewed.";

  const result = validateSnapshotSourceLicenses(invalidSnapshot);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("mock data must carry MOCK DATA ONLY")));
});

test("still-pending real source rows are blocked until their source license policy is approved", () => {
  // open_assembly is now human-approved (2026-06-13), so use a still-pending source (rokps) here.
  const invalidSnapshot = structuredClone(snapshot);
  const fact = invalidSnapshot.verified_facts[0];
  if (!fact) throw new Error("missing fixture fact");
  fact.source_kind = "rokps";
  fact.source_id = "rokps-real";
  fact.source_org = "헌정회";
  fact.source_url = "https://www.rokps.or.kr/";
  fact.license_note = "헌정회 자료";

  const result = validateSnapshotSourceLicenses(invalidSnapshot);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("source license is not approved")));
});

test("approved nec rows pass the gate; remaining pending sources still reject", () => {
  // Human approval 2026-06-13 flipped nec -> approved (dataset 15000864). Other sources stay pending.
  const okSnapshot = structuredClone(snapshot);
  const necFact = okSnapshot.verified_facts[0];
  if (!necFact) throw new Error("missing fixture fact");
  necFact.source_kind = "nec";
  necFact.source_id = "nec-winner-1";
  necFact.source_org = "중앙선거관리위원회";
  necFact.source_url = "https://www.data.go.kr/data/15000864/openapi.do";
  necFact.license_note = "출처: 중앙선거관리위원회, 당선인 정보 조회 서비스 (이용허락범위 제한 없음), https://www.data.go.kr/data/15000864/openapi.do";
  assert.deepEqual(validateSnapshotSourceLicenses(okSnapshot), { valid: true, errors: [] });

  // Every other real source is still pending_review and must reject.
  for (const pending of ["public_data_portal", "rokps", "news_search", "rss", "manual_review"] as const) {
    const bad = structuredClone(snapshot);
    const fact = bad.verified_facts[0];
    if (!fact) throw new Error("missing fixture fact");
    fact.source_kind = pending;
    fact.source_id = `${pending}-real`;
    fact.source_org = pending;
    fact.source_url = "https://example.invalid/pending";
    fact.license_note = "some note";
    const result = validateSnapshotSourceLicenses(bad);
    assert.equal(result.valid, false, `${pending} must still reject`);
    assert.ok(result.errors.some((e) => e.includes("source license is not approved")), `${pending} reason`);
  }
});

test("approved open_assembly rows pass the gate when the license note has no provisional language", () => {
  // Human approval 2026-06-13 flipped open_assembly -> approved (endpoint nwvrqwxyaytdsfvhu).
  const validSnapshot = structuredClone(snapshot);
  const fact = validSnapshot.verified_facts[0];
  if (!fact) throw new Error("missing fixture fact");
  fact.source_kind = "open_assembly";
  fact.source_id = "open-assembly-M22-001";
  fact.source_org = "열린국회정보";
  fact.source_url = "https://open.assembly.go.kr/portal/openapi/nwvrqwxyaytdsfvhu";
  fact.license_note = "출처: 열린국회정보, 국회의원 인적사항 (공공누리 제1유형, 출처표시), https://open.assembly.go.kr";

  const result = validateSnapshotSourceLicenses(validSnapshot);

  assert.deepEqual(result, { valid: true, errors: [] });
});

test("approved open_assembly rows are still blocked if the license note carries provisional language", () => {
  // Approval does not waive the provisional-language guard: a TODO/confirm note must still be rejected.
  const invalidSnapshot = structuredClone(snapshot);
  const fact = invalidSnapshot.verified_facts[0];
  if (!fact) throw new Error("missing fixture fact");
  fact.source_kind = "open_assembly";
  fact.source_id = "open-assembly-M22-001";
  fact.source_org = "열린국회정보";
  fact.source_url = "https://open.assembly.go.kr/portal/openapi/nwvrqwxyaytdsfvhu";
  fact.license_note = "TODO: confirm Open Assembly license terms before public data release.";

  const result = validateSnapshotSourceLicenses(invalidSnapshot);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("provisional language")));
});
