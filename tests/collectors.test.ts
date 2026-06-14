import assert from "node:assert/strict";
import test from "node:test";
import {
  getOpenAssemblyConfigStatus,
  mapOpenAssemblyMemberRecord,
  mergeOpenAssemblyMappedProfile,
  OpenAssemblyCollector,
  openAssemblyConfigFromEnv,
  APPROVED_PUBLIC_CONTACT_FIELDS,
  PUBLIC_MAPPER_DROPPED_FIELDS,
} from "../src/lib/collectors/open-assembly";
import { scanRawRecordsForPrivateData } from "../src/lib/raw-records";

/**
 * 실제 nwvrqwxyaytdsfvhu("국회의원 인적사항", 현직 제22대) 응답 row를 본뜬 fixture.
 * MONA_CD(id) + 보좌진 실명(STAFF/SECRETARY/SECRETARY2) + 사무실 연락(TEL_NO/E_MAIL/HOMEPAGE/ASSEM_ADDR)을
 * 모두 포함해 drop 로직과 privacy scan을 검증한다. (값은 가상.)
 */
function currentAssemblyRawRow(): Record<string, unknown> {
  return {
    MONA_CD: "M22-001",
    HG_NM: "강현직",
    HJ_NM: "姜現職",
    ENG_NM: "KANG HYUNJIK",
    BTH_DATE: "1970-01-01",
    JOB_RES_NM: "위원",
    POLY_NM: "테스트현직당",
    ORIG_NM: "서울 테스트구갑",
    ELECT_GBN_NM: "지역구",
    CMIT_NM: "법제사법위원회",
    REELE_GBN_NM: "재선",
    UNITS: "제21대, 제22대",
    SEX_GBN_NM: "남",
    MEM_TITLE: "현직 22대 국회의원 (테스트)",
    // 아래는 공개 mapper가 절대 읽지 않아야 하는 사적/연락 필드(값은 가상):
    STAFF: "보좌관실명1, 보좌관실명2",
    SECRETARY: "선임비서관실명",
    SECRETARY2: "비서관실명",
    TEL_NO: "02-000-0000",
    E_MAIL: "private@example.invalid",
    HOMEPAGE: "https://blog.example.invalid/hyunjik",
    ASSEM_ADDR: "의원회관 000호",
  };
}

test("open assembly config reports missing API key", () => {
  const status = getOpenAssemblyConfigStatus({});

  assert.equal(status.ready, false);
  assert.deepEqual(status.missing, ["OPEN_ASSEMBLY_API_KEY"]);
  assert.equal(openAssemblyConfigFromEnv({}), null);
});

test("open assembly config reads API key and default base URL", () => {
  const config = openAssemblyConfigFromEnv({ OPEN_ASSEMBLY_API_KEY: "test-key" });

  assert.deepEqual(config, {
    apiKey: "test-key",
    baseUrl: "https://open.assembly.go.kr/portal/openapi",
  });
});

test("open assembly config allows explicit base URL for tests", () => {
  const config = openAssemblyConfigFromEnv({
    OPEN_ASSEMBLY_API_KEY: "test-key",
    OPEN_ASSEMBLY_BASE_URL: "https://example.invalid/openapi",
  });

  assert.equal(config?.baseUrl, "https://example.invalid/openapi");
});

test("open assembly raw member maps to sourced evidence values", () => {
  const mapped = mapOpenAssemblyMemberRecord({
    source: "open_assembly",
    fetchedAt: "2026-06-11T00:00:00.000Z",
    sourceUrl: "https://example.invalid/open-assembly/member",
    licenseNote: "fixture license",
    raw: {
      NAAS_CD: "A001",
      HG_NM: "홍공개",
      POLY_NM: "테스트정당",
      ORIG_NM: "서울 테스트구",
      JOB_RES_NM: "제22대 국회의원",
    },
  });

  assert.ok(mapped);
  assert.equal(mapped.displayName, "홍공개");
  assert.equal(mapped.party[0]?.source.sourceKind, "open_assembly");
  assert.equal(mapped.party[0]?.source.sourceUrl, "https://example.invalid/open-assembly/member");
  assert.equal(mapped.party[0]?.source.licenseNote, "fixture license");

  // position = "국회의원"(공직) — JOB_RES_NM이 아니라 roster 소속에서 도출, 출처 동반(불변 #1·#2).
  assert.equal(mapped.position[0]?.value, "국회의원");
  assert.equal(mapped.position[0]?.source.sourceKind, "open_assembly");
  assert.ok((mapped.position[0]?.source.sourceUrl ?? "").length > 0);
  // committee_role = JOB_RES_NM 값(여기서는 "제22대 국회의원"), 출처 동반.
  assert.equal(mapped.committeeRole[0]?.field, "committee_role");
  assert.equal(mapped.committeeRole[0]?.value, "제22대 국회의원");
  assert.equal(mapped.committeeRole[0]?.source.sourceKind, "open_assembly");

  const profile = mergeOpenAssemblyMappedProfile(mapped);
  assert.equal(profile.politicianId, "open-assembly-A001");
  assert.equal(profile.discrepancies.length, 0);
});

test("open assembly mapper supports fallback field names", () => {
  const mapped = mapOpenAssemblyMemberRecord({
    source: "open_assembly",
    fetchedAt: "2026-06-11T00:00:00.000Z",
    sourceUrl: "https://example.invalid/open-assembly/member",
    licenseNote: "fixture license",
    raw: {
      id: "A002",
      name: "박투명",
      party: "fallback party",
      district: "fallback district",
      position: "fallback position",
    },
  });

  assert.ok(mapped);
  assert.equal(mapped.politicianId, "open-assembly-A002");
  assert.equal(mapped.party[0]?.value, "fallback party");
  assert.equal(mapped.district[0]?.value, "fallback district");
  // position은 항상 공직 "국회의원"(roster 소속). raw `position`/JOB_RES_NM은 committee_role로 간다.
  assert.equal(mapped.position[0]?.value, "국회의원");
  assert.equal(mapped.committeeRole[0]?.value, "fallback position");
});

test("open assembly mapper does not expose raw records without identity", () => {
  const mapped = mapOpenAssemblyMemberRecord({
    source: "open_assembly",
    fetchedAt: "2026-06-11T00:00:00.000Z",
    sourceUrl: "https://example.invalid/open-assembly/member",
    licenseNote: "fixture license",
    raw: {
      POLY_NM: "테스트정당",
    },
  });

  assert.equal(mapped, null);
});

test("nwvrqwxyaytdsfvhu mapper reads MONA_CD as member id (not NAAS_CD)", () => {
  const mapped = mapOpenAssemblyMemberRecord({
    source: "open_assembly",
    fetchedAt: "2026-06-11T00:00:00.000Z",
    sourceUrl: "https://example.invalid/open-assembly/member",
    licenseNote: "fixture license",
    raw: currentAssemblyRawRow(),
  });

  assert.ok(mapped, "MONA_CD must be accepted as the member id");
  assert.equal(mapped.politicianId, "open-assembly-M22-001");
  assert.equal(mapped.displayName, "강현직");
  assert.equal(mapped.party[0]?.value, "테스트현직당");
  assert.equal(mapped.district[0]?.value, "서울 테스트구갑");
  assert.equal(mapped.party[0]?.source.sourceKind, "open_assembly");
  // JOB_RES_NM="위원"은 position이 아니라 committee_role로 간다. position은 공직 "국회의원".
  assert.equal(mapped.position[0]?.value, "국회의원");
  assert.equal(mapped.committeeRole[0]?.field, "committee_role");
  assert.equal(mapped.committeeRole[0]?.value, "위원");
  assert.equal(mapped.committeeRole[0]?.source.sourceKind, "open_assembly");
});

test("position is the office '국회의원' carrying roster source (NOT JOB_RES_NM, NOT an invented bare string)", () => {
  // 불변 #1·#2: position="국회의원"은 지어낸 상수가 아니라 roster 소속에서 도출된 사실이며 출처를 단다.
  const mapped = mapOpenAssemblyMemberRecord({
    source: "open_assembly",
    fetchedAt: "2026-06-11T00:00:00.000Z",
    sourceUrl: "https://example.invalid/open-assembly/roster",
    licenseNote: "fixture license",
    raw: { MONA_CD: "M22-002", HG_NM: "정위원장", JOB_RES_NM: "위원장" },
  });

  assert.ok(mapped);
  assert.equal(mapped.position.length, 1);
  assert.equal(mapped.position[0]?.value, "국회의원");
  assert.equal(mapped.position[0]?.field, "position");
  // 출처가 비어있지 않아야 한다(bare string 금지, 불변 #2).
  assert.equal(mapped.position[0]?.source.sourceKind, "open_assembly");
  assert.equal(mapped.position[0]?.source.sourceUrl, "https://example.invalid/open-assembly/roster");
  assert.ok((mapped.position[0]?.source.licenseNote ?? "").length > 0);
  // 위원장은 committee_role로 분리된다.
  assert.equal(mapped.committeeRole[0]?.value, "위원장");
});

test("committee_role yields NO fact when JOB_RES_NM is null (null -> absent, not '국회의원', not empty string)", () => {
  // JOB_RES_NM이 없는 9건: committee_role은 아무것도 emit하지 않는다(지어내지 않음). position은 그대로 공직.
  const mapped = mapOpenAssemblyMemberRecord({
    source: "open_assembly",
    fetchedAt: "2026-06-11T00:00:00.000Z",
    sourceUrl: "https://example.invalid/open-assembly/roster",
    licenseNote: "fixture license",
    raw: { MONA_CD: "M22-003", HG_NM: "무직책", POLY_NM: "테스트당", ORIG_NM: "서울 무구" },
  });

  assert.ok(mapped);
  assert.deepEqual(mapped.committeeRole, [], "null JOB_RES_NM must produce no committee_role fact");
  // position은 여전히 공직 "국회의원"으로 출처를 달고 존재한다.
  assert.equal(mapped.position[0]?.value, "국회의원");
});

test("regression: no profile's position reads a committee role (위원/간사/위원장)", () => {
  const committeeRoles = ["위원", "간사", "위원장"];
  for (const role of committeeRoles) {
    const mapped = mapOpenAssemblyMemberRecord({
      source: "open_assembly",
      fetchedAt: "2026-06-11T00:00:00.000Z",
      sourceUrl: "https://example.invalid/open-assembly/roster",
      licenseNote: "fixture license",
      raw: { MONA_CD: `M22-${role}`, HG_NM: "회귀테스트", JOB_RES_NM: role },
    });
    assert.ok(mapped);
    assert.equal(mapped.position[0]?.value, "국회의원", `position must be the office, not the committee role ${role}`);
    assert.notEqual(mapped.position[0]?.value, role);
    // 위원회 직책은 committee_role로 이동했는지 확인.
    assert.equal(mapped.committeeRole[0]?.value, role);
  }
});

test("public mapper EXPOSES approved contact fields but still DROPS aide names", () => {
  const mapped = mapOpenAssemblyMemberRecord({
    source: "open_assembly",
    fetchedAt: "2026-06-11T00:00:00.000Z",
    sourceUrl: "https://example.invalid/open-assembly/member",
    licenseNote: "fixture license",
    raw: currentAssemblyRawRow(),
  });
  assert.ok(mapped);

  // 승인된 4개 공직 연락 필드는 출처 메타데이터를 달고 노출된다.
  const contactByField = new Map(mapped.contact.map((e) => [e.field, e]));
  assert.equal(contactByField.get("office_phone")?.value, "02-000-0000");
  assert.equal(contactByField.get("office_email")?.value, "private@example.invalid");
  assert.equal(contactByField.get("office_room")?.value, "의원회관 000호");
  assert.equal(contactByField.get("registered_channel_url")?.value, "https://blog.example.invalid/hyunjik");
  // 각 연락 evidence는 출처 메타데이터를 동반한다(불변 #2).
  assert.equal(contactByField.get("office_phone")?.source.sourceKind, "open_assembly");

  const serialized = JSON.stringify(mergeOpenAssemblyMappedProfile(mapped));
  // 승인된 연락값은 이제 공개 결과에 포함되어야 한다.
  for (const present of ["02-000-0000", "private@example.invalid", "의원회관 000호", "blog.example.invalid"]) {
    assert.ok(serialized.includes(present), `approved contact value missing from public mapper: ${present}`);
  }
  // 보좌진 실명은 여전히 절대 새면 안 된다(§0.7).
  for (const secret of ["보좌관실명1", "보좌관실명2", "선임비서관실명", "비서관실명"]) {
    assert.ok(!serialized.includes(secret), `aide name leaked into public mapper: ${secret}`);
  }

  // 드롭 집합은 이제 보좌진 실명만 — 연락 필드는 빠졌다(두 집합 분리 확인).
  assert.deepEqual(PUBLIC_MAPPER_DROPPED_FIELDS.aideNames, ["STAFF", "SECRETARY", "SECRETARY2"]);
  assert.ok(!("awaitingHumanDecision" in PUBLIC_MAPPER_DROPPED_FIELDS), "contact fields no longer in dropped set");
  assert.deepEqual(APPROVED_PUBLIC_CONTACT_FIELDS, {
    TEL_NO: "office_phone",
    E_MAIL: "office_email",
    ASSEM_ADDR: "office_room",
    HOMEPAGE: "registered_channel_url",
  });
});

test("internal raw-archive privacy scan FLAGS aide names but NOT approved contact fields", () => {
  const scan = scanRawRecordsForPrivateData([{ raw: currentAssemblyRawRow() }]);

  assert.equal(scan.status, "blocked", "raw archive carrying aide names must still be blocked");
  const flaggedKeys = new Set(scan.findings.map((f) => f.path.split(".").pop()));

  // 보좌진 실명은 계속 차단.
  for (const key of ["STAFF", "SECRETARY", "SECRETARY2"]) {
    assert.ok(flaggedKeys.has(key), `privacy scan must still flag aide name ${key}`);
  }
  // 승인된 공직 연락 필드는 (키든 값이든) flag되면 안 된다 — 정책/스캔 모순 방지.
  for (const key of ["TEL_NO", "E_MAIL", "ASSEM_ADDR", "HOMEPAGE"]) {
    assert.ok(!flaggedKeys.has(key), `approved contact field must NOT be flagged: ${key}`);
  }
});

test("open assembly raw member without source URL is not exposable", () => {
  const mapped = mapOpenAssemblyMemberRecord({
    source: "open_assembly",
    fetchedAt: "2026-06-11T00:00:00.000Z",
    sourceUrl: "",
    licenseNote: "fixture license",
    raw: {
      NAAS_CD: "A001",
      HG_NM: "홍공개",
    },
  });

  assert.equal(mapped, null);
});

test("open assembly collector fetches rows with injected fetch", async () => {
  const requestedUrls: string[] = [];
  const collector = new OpenAssemblyCollector(
    {
      apiKey: "test-key",
      baseUrl: "https://example.invalid/openapi",
      memberListPath: "MEMBERS",
      licenseNote: "fixture license",
    },
    async (input) => {
      requestedUrls.push(String(input));
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            MEMBERS: [
              { head: [{ list_total_count: 1 }] },
              {
                row: [
                  {
                    NAAS_CD: "A001",
                    HG_NM: "홍공개",
                  },
                ],
              },
            ],
          };
        },
      };
    },
    () => new Date("2026-06-11T00:00:00.000Z"),
  );

  const records = await collector.collect();

  assert.equal(records.length, 1);
  assert.equal(records[0]?.raw.HG_NM, "홍공개");
  assert.equal(records[0]?.fetchedAt, "2026-06-11T00:00:00.000Z");
  assert.equal(records[0]?.licenseNote, "fixture license");
  // 인증 파라미터는 대소문자 구분 — 명세서상 `Key`(대문자 K). 과거 `KEY`는 서버가 인증키 없음으로
  // 보고 sample 기본값(5행 고정)을 돌려주던 버그였다(2026-06-13 실측 확인).
  assert.match(requestedUrls[0] ?? "", /[?&]Key=test-key/);
  assert.doesNotMatch(requestedUrls[0] ?? "", /[?&]KEY=/, "must not send the case-wrong KEY param");
  assert.match(requestedUrls[0] ?? "", /Type=json/);
  // §4 비밀 분리: fetch URL엔 키가 있어도, evidence로 보관되는 sourceUrl에는 인증키가 절대 없어야 한다
  // (Iter-29 발견: 키-bearing URL이 sourceUrl로 새어 스냅샷/CSV에 노출됐었음).
  assert.ok((records[0]?.sourceUrl ?? "").length > 0, "sourceUrl must still be present (불변 #2)");
  assert.doesNotMatch(records[0]?.sourceUrl ?? "", /Key=test-key/, "sourceUrl must not carry the auth key");
  assert.doesNotMatch(records[0]?.sourceUrl ?? "", /[?&]Key=/, "sourceUrl must have no Key param at all");
});

test("open assembly collector rejects failed responses", async () => {
  const collector = new OpenAssemblyCollector(
    {
      apiKey: "test-key",
      baseUrl: "https://example.invalid/openapi",
    },
    async () => ({
      ok: false,
      status: 500,
      async json() {
        return {};
      },
    }),
  );

  await assert.rejects(() => collector.collect(), /status 500/);
});
