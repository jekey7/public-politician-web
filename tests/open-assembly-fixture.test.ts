import assert from "node:assert/strict";
import test from "node:test";
import {
  assertOpenAssemblyFixtureDryRun,
  runOpenAssemblyFixtureDryRun,
} from "../src/lib/public-pipeline";
import { mockOpenAssemblyRawRecords } from "../src/lib/raw-records";
import type { OpenAssemblyMemberRecord } from "../src/lib/collectors/open-assembly";

const baseRecord = (): OpenAssemblyMemberRecord => ({
  source: "open_assembly",
  fetchedAt: "2026-06-11T00:00:00.000Z",
  sourceUrl: "https://example.invalid/open-assembly/member/A001",
  licenseNote: "MOCK RAW DATA ONLY - replace after source license review",
  raw: {
    NAAS_CD: "A001",
    HG_NM: "홍공개",
    POLY_NM: "테스트정당",
    ORIG_NM: "서울 테스트구",
    JOB_RES_NM: "제22대 국회의원",
  },
});

test("open assembly fixture dry-run passes all internal checks on the mock fixture", () => {
  const result = runOpenAssemblyFixtureDryRun(mockOpenAssemblyRawRecords());

  assert.equal(result.ok, true);
  assert.equal(result.profileCount, 1);
  assert.ok(result.factCount > 0);

  const byName = Object.fromEntries(result.checks.map((check) => [check.name, check.passed]));
  assert.equal(byName.snapshot_schema_valid, true);
  assert.equal(byName.raw_privacy_scan_passed, true);
  assert.equal(byName.only_identity_fields_exposed, true);
  assert.equal(byName.no_guessed_fields, true);
  assert.equal(byName.source_license_gate_still_rejects, true);
});

test("dry-run snapshot is internal-only: it is never produced as a public artifact and only exposes identity facts", () => {
  const result = runOpenAssemblyFixtureDryRun(mockOpenAssemblyRawRecords());

  // Every exposed fact is an open_assembly identity fact carrying full source metadata.
  for (const fact of result.snapshot.verified_facts) {
    assert.equal(fact.category, "identity");
    assert.equal(fact.source_kind, "open_assembly");
    assert.ok(fact.source_url.length > 0);
    assert.ok(fact.license_note.length > 0);
    // committee_role도 identity 카테고리의 출처 동반 사실(JOB_RES_NM 직접 명시값). position은 공직 "국회의원".
    assert.ok(["party", "district", "position", "committee_role"].includes(fact.field));
  }
});

test("fixture exposes position as the office '국회의원' (sourced) and committee_role from JOB_RES_NM", () => {
  const result = runOpenAssemblyFixtureDryRun(mockOpenAssemblyRawRecords());
  const byField = new Map(result.snapshot.verified_facts.map((fact) => [fact.field, fact]));

  // position = "국회의원"(공직), 출처 동반 — 지어낸 bare string 아님(불변 #1·#2).
  const position = byField.get("position");
  assert.ok(position);
  assert.equal(position?.value, "국회의원");
  assert.equal(position?.category, "identity");
  assert.ok((position?.source_url ?? "").length > 0);

  // committee_role = mock 픽스처의 JOB_RES_NM("제22대 국회의원"), 출처 동반.
  const committeeRole = byField.get("committee_role");
  assert.ok(committeeRole);
  assert.equal(committeeRole?.value, "제22대 국회의원");
  assert.equal(committeeRole?.category, "identity");

  // 회귀: position 칸에 위원회 직책이 들어가지 않는다.
  for (const role of ["위원", "간사", "위원장"]) {
    assert.notEqual(position?.value, role);
  }
});

test("fixture with null JOB_RES_NM exposes position but NO committee_role fact", () => {
  const recordWithoutJobRes = mockOpenAssemblyRawRecords().map((record) => {
    const raw = { ...record.raw };
    delete (raw as Record<string, unknown>).JOB_RES_NM;
    return { ...record, raw };
  });

  const result = runOpenAssemblyFixtureDryRun(recordWithoutJobRes);
  assert.equal(result.ok, true);

  const fields = result.snapshot.verified_facts.map((fact) => fact.field);
  assert.ok(fields.includes("position"), "office position must still be present");
  assert.ok(!fields.includes("committee_role"), "null JOB_RES_NM must not produce a committee_role fact");
});

test("dry-run source-license gate still rejects pending open_assembly so it cannot reach public release", () => {
  const result = runOpenAssemblyFixtureDryRun(mockOpenAssemblyRawRecords());
  const gate = result.checks.find((check) => check.name === "source_license_gate_still_rejects");

  assert.ok(gate);
  assert.equal(gate?.passed, true);
  assert.match(gate?.detail ?? "", /open_assembly/);
});

test("dry-run blocks raw archives that leak private data", () => {
  const leaky = baseRecord();
  leaky.raw = { ...leaky.raw, HOME_ADDRESS: "서울시 비공개로 1", CONTACT: "010-1234-5678" };

  assert.throws(() => assertOpenAssemblyFixtureDryRun([leaky]), /private data/);
});

test("dry-run never exposes guessed education/career/election/bill/vote/committee fields", () => {
  // Even if the raw record carries unverified fields, the identity mapper must not surface them.
  const recordWithExtraRawFields = baseRecord();
  recordWithExtraRawFields.raw = {
    ...recordWithExtraRawFields.raw,
    EDU: "○○대학교 경제학과 졸업",
    CAREER: "제21대 국회의원",
    BILL_COUNT: 42,
  };

  const result = runOpenAssemblyFixtureDryRun([recordWithExtraRawFields]);

  assert.equal(result.ok, true);
  const categories = new Set(result.snapshot.verified_facts.map((fact) => fact.category));
  assert.deepEqual([...categories], ["identity"]);
  // The unverified raw values must not appear anywhere in the exposed facts.
  const exposedValues = result.snapshot.verified_facts.map((fact) => String(fact.value));
  assert.ok(!exposedValues.some((value) => value.includes("경제학과")));
  assert.ok(!exposedValues.some((value) => value.includes("제21대")));
});

test("assertOpenAssemblyFixtureDryRun returns the result when every check passes", () => {
  const result = assertOpenAssemblyFixtureDryRun(mockOpenAssemblyRawRecords());
  assert.equal(result.ok, true);
});
