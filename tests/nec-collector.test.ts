import assert from "node:assert/strict";
import test from "node:test";
import {
  getNecConfigStatus,
  mapNecRecord,
  NecCollector,
  necConfigFromEnv,
  NEC_22ND_ASSEMBLY_SG_ID,
  NEC_ASSEMBLY_ELECTION_SG_TYPECODE,
  NEC_DROPPED_PII_FIELDS,
  type NecRecord,
} from "../src/lib/collectors/nec";
import { mergeNecIntoProfiles } from "../src/lib/collectors/nec-merge";
import {
  classifyNecCoverage,
  classifyNecCoveragePerProfile,
  isProportionalDistrict,
  NEC_AMBIGUOUS_WITHHELD_REASON,
} from "../src/lib/collectors/nec-coverage";
import { mockNecRecords } from "../src/lib/collectors/nec-mock";
import {
  parseNecCollectorMode,
  assertNecApprovedForRealCollection,
  selectNecCollector,
  runNecCrossVerificationDryRun,
} from "../src/lib/collectors/nec-pipeline";
import {
  mapOpenAssemblyMemberRecord,
  mergeOpenAssemblyMappedProfile,
} from "../src/lib/collectors/open-assembly";
import { sourceLicensePolicies } from "../src/lib/source-license";
import type { PoliticianProfile } from "../src/lib/types";

function necRecord(raw: Record<string, unknown>, dataset: NecRecord["dataset"] = "winner"): NecRecord {
  return {
    source: "nec",
    dataset,
    raw,
    fetchedAt: "2024-04-10T00:00:00.000Z",
    sourceUrl: "https://example.invalid/nec",
    licenseNote: "MOCK DATA ONLY - test",
  };
}

/** Open Assembly mock 멤버를 실제 매퍼로 만든다(현실적인 member entity로 매칭 검증). */
function oaProfile(raw: Record<string, unknown>): PoliticianProfile {
  const mapped = mapOpenAssemblyMemberRecord({
    source: "open_assembly",
    fetchedAt: "2026-06-13T00:00:00.000Z",
    sourceUrl: "https://example.invalid/open-assembly/roster",
    licenseNote: "fixture license",
    raw,
  });
  if (!mapped) throw new Error("fixture OA profile failed to map");
  return mergeOpenAssemblyMappedProfile(mapped);
}

const KIM = () => oaProfile({ MONA_CD: "M-KIM", HG_NM: "김공개", POLY_NM: "가상정당", ORIG_NM: "서울 목구갑" });
const LEE = () => oaProfile({ MONA_CD: "M-LEE", HG_NM: "이투명", POLY_NM: "샘플정당", ORIG_NM: "부산 예시구을" });

// ── config / off-switch ──

test("nec config reports missing API key and reads env", () => {
  assert.equal(getNecConfigStatus({}).ready, false);
  assert.deepEqual(getNecConfigStatus({}).missing, ["NEC_API_KEY"]);
  assert.equal(necConfigFromEnv({}), null);

  const config = necConfigFromEnv({ NEC_API_KEY: "k" });
  assert.equal(config?.apiKey, "k");
  assert.equal(config?.baseUrl, "http://apis.data.go.kr/9760000");
});

test("nec collector mode defaults to OFF — license approved, but real fetch still gated by the flag", () => {
  assert.equal(parseNecCollectorMode(undefined), "off");
  assert.equal(parseNecCollectorMode("off"), "off");
  assert.equal(parseNecCollectorMode("nec"), "nec");
  assert.throws(() => parseNecCollectorMode("garbage"), /Unsupported NEC_COLLECTOR/);

  // off (default) → no collector, no fetch. THIS is what keeps real NEC data out of public output.
  assert.deepEqual(selectNecCollector({}), { mode: "off", collector: null });

  // nec license is now human-APPROVED (2026-06-13) → the license check passes.
  assert.equal(sourceLicensePolicies.nec.status, "approved");
  assert.doesNotThrow(() => assertNecApprovedForRealCollection());

  // Approval unlocks the LICENSE gate only. Turning the flag on would build a real collector — but the
  // default stays OFF, so no public path enables it this iteration. (We assert the flag wiring, not enable it.)
  const selected = selectNecCollector({ NEC_COLLECTOR: "nec", NEC_API_KEY: "k" });
  assert.equal(selected.mode, "nec");
  assert.ok(selected.collector, "approved + explicit NEC_COLLECTOR=nec builds a collector (not invoked here)");
  // Without a key the build still fails fast (env-only secret, no hardcoding).
  assert.throws(() => selectNecCollector({ NEC_COLLECTOR: "nec" }), /NEC_API_KEY is required/);
});

test("nec collector builds 22nd-assembly winner request with env-only key", async () => {
  const urls: string[] = [];
  const collector = new NecCollector(
    { apiKey: "secret-key", baseUrl: "https://example.invalid/9760000", licenseNote: "fixture" },
    "winner",
    async (input) => {
      urls.push(String(input));
      return { ok: true, status: 200, async json() {
        return { response: { body: { items: [{ item: [{ name: "김공개", jdName: "가상정당", sggName: "서울 목구갑" }] }] } } };
      } };
    },
    () => new Date("2024-04-10T00:00:00.000Z"),
  );

  const records = await collector.collect();
  assert.equal(records.length, 1);
  assert.equal(records[0]?.raw.name, "김공개");
  assert.match(urls[0] ?? "", new RegExp(`sgId=${NEC_22ND_ASSEMBLY_SG_ID}`));
  assert.match(urls[0] ?? "", new RegExp(`sgTypecode=${NEC_ASSEMBLY_ELECTION_SG_TYPECODE}`));
  assert.match(urls[0] ?? "", /serviceKey=secret-key/);
  assert.match(urls[0] ?? "", /getWinnerInfoInqire/);
  // §4 비밀 분리: fetch URL엔 serviceKey가 있어도, evidence로 보관되는 sourceUrl에는 절대 없어야 한다
  // (Iter-29 발견: 키-bearing URL이 sourceUrl로 새어 스냅샷/CSV에 노출됐었음).
  assert.ok((records[0]?.sourceUrl ?? "").length > 0, "sourceUrl must still be present (불변 #2)");
  assert.doesNotMatch(records[0]?.sourceUrl ?? "", /serviceKey=/, "sourceUrl must not carry the serviceKey");
  assert.match(records[0]?.sourceUrl ?? "", /getWinnerInfoInqire/, "sourceUrl keeps the stable service path");
});

test("nec collector PAGINATES (server caps 100/page) until totalCount is covered", async () => {
  // 서버는 numOfRows 요청과 무관하게 페이지당 최대 100을 준다(라이브 확인). totalCount=254 → 100/100/54 = 3페이지.
  const urls: string[] = [];
  const makeRows = (n: number, offset: number) =>
    Array.from({ length: n }, (_, i) => ({ name: `당선인${offset + i}`, jdName: "정당", sggName: `구${offset + i}` }));
  const pageRows: Record<number, ReturnType<typeof makeRows>> = {
    1: makeRows(100, 0),
    2: makeRows(100, 100),
    3: makeRows(54, 200),
  };
  const collector = new NecCollector(
    { apiKey: "k", baseUrl: "https://example.invalid/9760000", licenseNote: "fixture" },
    "winner",
    async (input) => {
      const s = String(input);
      urls.push(s);
      const pageNo = Number(new URL(s).searchParams.get("pageNo"));
      return {
        ok: true,
        status: 200,
        async json() {
          return { response: { body: { totalCount: 254, items: { item: pageRows[pageNo] ?? [] } } } };
        },
      };
    },
  );

  const records = await collector.collect();
  assert.equal(records.length, 254, "all 254 winners collected across pages");
  assert.equal(urls.length, 3, "exactly 3 page calls (100+100+54)");
  assert.match(urls[0] ?? "", /numOfRows=100/);
  assert.match(urls[1] ?? "", /pageNo=2/);
  // sourceUrl은 안정 식별자(첫 페이지 URL, page param 포함은 허용하되 동일 서비스 경로).
  assert.match(records[0]?.sourceUrl ?? "", /getWinnerInfoInqire/);
});

// ── identity-only mapper / PII drop ──

test("nec mapper maps ONLY party + district, each carrying NEC SourceMeta", () => {
  const mapped = mapNecRecord(
    necRecord({ num: 1, name: "김공개", jdName: "가상정당", sggName: "서울 목구갑" }),
    0,
  );
  assert.ok(mapped);
  assert.equal(mapped.party[0]?.value, "가상정당");
  assert.equal(mapped.district[0]?.value, "서울 목구갑");
  assert.equal(mapped.party[0]?.source.sourceKind, "nec");
  assert.equal(mapped.party[0]?.source.sourceOrg, "중앙선거관리위원회");
  assert.ok((mapped.party[0]?.source.sourceUrl ?? "").length > 0);
  assert.ok((mapped.party[0]?.source.fetchedAt ?? "").length > 0);
});

test("nec mapper DROPS PII fields (birthday/gender/edu/career/job/addr) — never emitted", () => {
  const mapped = mapNecRecord(
    necRecord({
      num: 1,
      name: "김공개",
      jdName: "가상정당",
      sggName: "서울 목구갑",
      birthday: "19780101",
      gender: "여",
      edu: "비밀대학교",
      career1: "비밀경력",
      job: "비밀직업",
      addr: "비밀주소",
      age: 47,
    }),
    0,
  );
  assert.ok(mapped);
  const serialized = JSON.stringify(mapped);
  for (const pii of ["19780101", "비밀대학교", "비밀경력", "비밀직업", "비밀주소", '"age"']) {
    assert.ok(!serialized.includes(pii), `PII must not be emitted by NEC mapper: ${pii}`);
  }
  // emit field는 party/district 둘 + 매칭 전용 districtMatchKey(파생 지역구 키, PII 아님). sdName은 값으로 노출 안 됨.
  assert.deepEqual(
    Object.keys(mapped).sort(),
    ["district", "districtMatchKey", "displayName", "party", "politicianId"].sort(),
  );
  // 드롭 목록이 정책대로 유지되는지 잠금.
  assert.deepEqual([...NEC_DROPPED_PII_FIELDS], ["birthday", "gender", "edu", "career1", "career2", "job", "addr", "age"]);
});

test("nec mapper computes a sido-aware districtMatchKey from sdName for MATCHING ONLY (sdName never emitted as a value)", () => {
  // sdName(시도, 공개 지리 식별자)은 매칭 키 산출에만 읽힌다 — district EvidenceValue 값은 raw sggName 그대로.
  const mapped = mapNecRecord(
    necRecord({ num: 7, name: "서공개", jdName: "가상정당", sggName: "서구갑", sdName: "인천광역시" }),
    0,
  );
  assert.ok(mapped);
  // 매칭 키는 canonical 단축 시도+선거구("인천서구갑") — 다른 시 "서구갑"과 분리(불변 #4 충돌 방지).
  assert.equal(mapped.districtMatchKey, "인천서구갑");
  // 그러나 emit되는 district 값은 raw sggName("서구갑") 그대로 — sdName 값("인천광역시")은 어디에도 노출되지 않는다.
  assert.equal(mapped.district[0]?.value, "서구갑");
  assert.ok(!JSON.stringify(mapped).includes("인천광역시"), "sdName must NOT be emitted as a value anywhere");
});

test("nec mapper yields nothing when name or identity fields absent (no fact without source)", () => {
  assert.equal(mapNecRecord(necRecord({ num: 1, jdName: "가상정당" }), 0), null); // no name
  assert.equal(mapNecRecord(necRecord({ num: 1, name: "무정보" }), 0), null); // no party/district
});

// ── entity matching: name + party + district, with ambiguity handling ──

test("merge: unique match joins NEC evidence into the SAME member profile (party becomes 2-source)", () => {
  const necMapped = [mapNecRecord(necRecord({ num: 1, name: "김공개", jdName: "가상정당", sggName: "서울 목구갑" }), 0)!];
  const result = mergeNecIntoProfiles([KIM()], necMapped);

  assert.equal(result.unmatched.length, 0);
  assert.equal(result.ambiguous.length, 0);
  const kim = result.profiles[0]!;
  assert.equal(kim.party.length, 2, "party now has OA + NEC evidence side by side");
  const kinds = new Set(kim.party.map((e) => e.source.sourceKind));
  assert.ok(kinds.has("open_assembly") && kinds.has("nec"));
});

test("merge: no-match NEC profile is returned as unmatched, never silently dropped", () => {
  const necMapped = [mapNecRecord(necRecord({ num: 9, name: "없는사람", jdName: "무소속", sggName: "어디구" }), 0)!];
  const result = mergeNecIntoProfiles([KIM(), LEE()], necMapped);

  assert.equal(result.unmatched.length, 1);
  assert.equal(result.unmatched[0]?.displayName, "없는사람");
  // 두 OA profile 모두 변화 없음(잘못 붙이지 않음).
  assert.deepEqual(result.profiles[0]!.party.length, 1);
  assert.deepEqual(result.profiles[1]!.party.length, 1);
});

test("merge: ambiguous multi-match is NOT merged (returned as ambiguous) — never merge wrong people", () => {
  // 동명이인 두 명, 둘 다 같은 정당 → 이름+정당으로 둘 다 후보 → 모호 → 합류 안 함.
  const twinA = oaProfile({ MONA_CD: "M-A", HG_NM: "동명이인", POLY_NM: "가상정당", ORIG_NM: "서울 갑구" });
  const twinB = oaProfile({ MONA_CD: "M-B", HG_NM: "동명이인", POLY_NM: "가상정당", ORIG_NM: "서울 을구" });
  const necMapped = [mapNecRecord(necRecord({ num: 5, name: "동명이인", jdName: "가상정당", sggName: "대전 병구" }), 0)!];

  const result = mergeNecIntoProfiles([twinA, twinB], necMapped);
  assert.equal(result.ambiguous.length, 1);
  assert.equal(result.unmatched.length, 0);
  assert.equal(result.profiles[0]!.party.length, 1, "ambiguous NEC must not attach to twin A");
  assert.equal(result.profiles[1]!.party.length, 1, "ambiguous NEC must not attach to twin B");
});

test("merge: a party-switcher still matches via district (conflict not hidden by match failure)", () => {
  // NEC party가 OA와 다르지만 지역구가 같다 → 지역구로 매칭되어야 한다(그래야 conflict가 드러난다).
  const necMapped = [mapNecRecord(necRecord({ num: 2, name: "이투명", jdName: "다른정당", sggName: "부산 예시구을" }), 0)!];
  const result = mergeNecIntoProfiles([LEE()], necMapped);

  assert.equal(result.unmatched.length, 0);
  assert.equal(result.ambiguous.length, 0);
  const lee = result.profiles[0]!;
  assert.equal(lee.party.length, 2);
  assert.deepEqual(lee.party.map((e) => e.value).sort(), ["다른정당", "샘플정당"].sort());
});

// ── coverage classification: 비례대표 = out-of-scope, NOT unmatched (ADR-4) ──

test("isProportionalDistrict detects 비례대표 districts, not regional ones", () => {
  assert.equal(isProportionalDistrict("비례대표"), true);
  assert.equal(isProportionalDistrict("서울 종로구"), false);
  assert.equal(isProportionalDistrict(null), false);
  assert.equal(isProportionalDistrict(""), false);
});

test("classifyNecCoverage: 비례대표 member is out-of-scope, regional no-match is genuine-unmatched", () => {
  // 3 OA members: KIM(지역구, NEC와 매칭됨), 무매칭(지역구, NEC 없음), 비례(비례대표, 범위 밖).
  const kim = KIM();
  const regionalNoMatch = oaProfile({ MONA_CD: "M-X", HG_NM: "지역구무매칭", POLY_NM: "정당", ORIG_NM: "대구 어디구" });
  const proportional = oaProfile({ MONA_CD: "M-P", HG_NM: "비례의원", POLY_NM: "정당", ORIG_NM: "비례대표" });

  // KIM만 NEC와 합류시킨다(merge로 nec 출처를 party에 추가).
  const necMapped = [mapNecRecord(necRecord({ num: 1, name: "김공개", jdName: "가상정당", sggName: "서울 목구갑" }), 0)!];
  const merge = mergeNecIntoProfiles([kim, regionalNoMatch, proportional], necMapped);

  const coverage = classifyNecCoverage(merge.profiles, [kim, regionalNoMatch, proportional], merge.ambiguous);
  assert.equal(coverage.matched, 1, "KIM matched a NEC winner");
  assert.equal(coverage.genuineUnmatched, 1, "regional member with no NEC match = genuine unmatched");
  assert.equal(coverage.outOfScope, 1, "비례대표 member = out-of-scope, NOT unmatched");
  assert.equal(coverage.ambiguousWithheld, 0, "no twins here");
  assert.deepEqual(coverage.outOfScopeMembers, ["비례의원"]);
  assert.deepEqual(coverage.genuineUnmatchedMembers, ["지역구무매칭"]);
  assert.equal(coverage.totalOaMembers, 3);
});

test("classifyNecCoverage: same-name+same-party twins (박지원류) are ambiguous-withheld, NOT genuine-unmatched (DECISION 2)", () => {
  // 동명이인+동일정당 쌍둥이 두 명 + NEC에 같은 이름 당선인 1명(지역구로 한쪽과만 일치하나 정당으로 둘 다 후보 → 모호).
  const twinA = oaProfile({ MONA_CD: "M-PJW-A", HG_NM: "박지원", POLY_NM: "더불어민주당", ORIG_NM: "전남 해남군완도군진도군" });
  const twinB = oaProfile({ MONA_CD: "M-PJW-B", HG_NM: "박지원", POLY_NM: "더불어민주당", ORIG_NM: "전북 군산시김제시부안군을" });
  const necMapped = [
    mapNecRecord(necRecord({ num: 11, name: "박지원", jdName: "더불어민주당", sggName: "해남군완도군진도군", sdName: "전라남도" }), 0)!,
  ];

  const merge = mergeNecIntoProfiles([twinA, twinB], necMapped);
  // 합류 보류(잘못된 사람에 붙이지 않음).
  assert.equal(merge.ambiguous.length, 1, "NEC 박지원 hits both twins via party → ambiguous, not merged");
  assert.equal(merge.profiles[0]!.party.length, 1, "twin A unchanged");
  assert.equal(merge.profiles[1]!.party.length, 1, "twin B unchanged");

  const coverage = classifyNecCoverage(merge.profiles, [twinA, twinB], merge.ambiguous);
  // 핵심: 두 쌍둥이는 genuine-unmatched가 아니라 ambiguous-withheld로 분리 분류된다(정직한 보류, 불변 #3).
  assert.equal(coverage.ambiguousWithheld, 2, "both twins are withheld, separated from genuine-unmatched");
  assert.equal(coverage.genuineUnmatched, 0, "twins must NOT be counted as genuine-unmatched");
  assert.deepEqual(coverage.ambiguousWithheldMembers.sort(), ["박지원", "박지원"].sort());
});

test("classifyNecCoveragePerProfile: carrier keyed by politician_id matches the count classification", () => {
  // KIM matched, 무매칭 genuine-unmatched (no carrier), 비례 out-of-scope, twins ambiguous-withheld.
  const kim = KIM();
  const regionalNoMatch = oaProfile({ MONA_CD: "M-X", HG_NM: "지역구무매칭", POLY_NM: "정당", ORIG_NM: "대구 어디구" });
  const proportional = oaProfile({ MONA_CD: "M-P", HG_NM: "비례의원", POLY_NM: "정당", ORIG_NM: "비례대표" });
  const twinA = oaProfile({ MONA_CD: "M-PJW-A", HG_NM: "박지원", POLY_NM: "더불어민주당", ORIG_NM: "전남 해남군완도군진도군" });
  const twinB = oaProfile({ MONA_CD: "M-PJW-B", HG_NM: "박지원", POLY_NM: "더불어민주당", ORIG_NM: "전북 군산시김제시부안군을" });
  const roster = [kim, regionalNoMatch, proportional, twinA, twinB];

  const necMapped = [
    mapNecRecord(necRecord({ num: 1, name: "김공개", jdName: "가상정당", sggName: "서울 목구갑" }), 0)!,
    mapNecRecord(necRecord({ num: 11, name: "박지원", jdName: "더불어민주당", sggName: "해남군완도군진도군", sdName: "전라남도" }), 1)!,
  ];
  const merge = mergeNecIntoProfiles(roster, necMapped);
  const perProfile = classifyNecCoveragePerProfile(merge.profiles, roster, merge.ambiguous);

  // matched + genuine-unmatched carry NO entry (no invented label). Only the two carrier states appear.
  assert.equal(perProfile[kim.politicianId], undefined, "matched has no carrier");
  assert.equal(perProfile[regionalNoMatch.politicianId], undefined, "genuine-unmatched has no carrier");
  assert.equal(perProfile[proportional.politicianId]?.status, "out_of_scope");
  assert.equal(perProfile[twinA.politicianId]?.status, "ambiguous_withheld");
  assert.equal(perProfile[twinB.politicianId]?.status, "ambiguous_withheld");
  assert.equal(perProfile[twinA.politicianId]?.reason, NEC_AMBIGUOUS_WITHHELD_REASON);

  // Counts derived from the carrier map equal the count-classifier's counts (single source of truth).
  const coverage = classifyNecCoverage(merge.profiles, roster, merge.ambiguous);
  const carrierWithheld = Object.values(perProfile).filter((v) => v.status === "ambiguous_withheld").length;
  const carrierOutOfScope = Object.values(perProfile).filter((v) => v.status === "out_of_scope").length;
  assert.equal(carrierWithheld, coverage.ambiguousWithheld);
  assert.equal(carrierOutOfScope, coverage.outOfScope);
});

// ── cross-verification activation (the core deliverable) ──

test("agree case: NEC agrees with OA on party+district → NO conflict", () => {
  const result = runNecCrossVerificationDryRun(
    [KIM()],
    [mockNecRecords()[0]!], // 김공개 agreement row only
  );
  const partyConflicts = result.discrepancies.filter((d) => d.field === "party");
  assert.equal(partyConflicts.length, 0, "agreeing sources must produce no party discrepancy");
});

test("PROOF: party-switcher surfaces content_conflict citing BOTH open_assembly and nec (not merged)", () => {
  const result = runNecCrossVerificationDryRun([KIM(), LEE()], mockNecRecords());

  // cross-verification 실제 활성화.
  assert.ok(result.multiSourceFieldCount > 0, "at least one field must now have >=2 sources");

  // switcher(이투명) party가 content_conflict로 surface.
  const conflict = result.discrepancies.find((d) => d.field === "party" && d.kind === "content_conflict");
  assert.ok(conflict, "party content_conflict must surface for the switcher");

  // 두 출처를 모두 인용한다(병합·억제 금지, 불변 #4).
  const lee = result.profiles.find((p) => p.displayName === "이투명")!;
  const cited = lee.party.filter((e) => conflict!.evidenceIds.includes(e.evidenceId));
  const kinds = new Set(cited.map((e) => e.source.sourceKind));
  assert.ok(kinds.has("open_assembly"), "conflict must cite open_assembly evidence");
  assert.ok(kinds.has("nec"), "conflict must cite nec evidence");

  // 두 값이 모두 보존된다(어느 쪽도 선택/삭제되지 않음).
  assert.deepEqual(lee.party.map((e) => e.value).sort(), ["다른정당", "샘플정당"].sort());

  // 합의 멤버(김공개)는 party 충돌 없음.
  const kimPartyConflict = result.discrepancies.find(
    (d) => d.field === "party" && conflict!.discrepancyId !== d.discrepancyId && d.discrepancyId.includes("KIM"),
  );
  assert.equal(kimPartyConflict, undefined);

  // 전체 dry-run 통과(PII drop + 활성화 + conflict + 라이선스 게이트 reject).
  assert.ok(result.ok, `dry-run checks: ${JSON.stringify(result.checks, null, 2)}`);
});

test("public go-live STILL blocked after approval — by the OFF switch, not the license gate", () => {
  // License is approved, so the public guard is now the NEC_COLLECTOR OFF default (real fetch never runs).
  const result = runNecCrossVerificationDryRun([KIM(), LEE()], mockNecRecords());
  const gateCheck = result.checks.find((c) => c.name === "real_fetch_blocked_by_off_switch");
  assert.ok(gateCheck?.passed, "default OFF switch must keep real NEC data out of public output");
});
