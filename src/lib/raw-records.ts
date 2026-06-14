import type { OpenAssemblyMemberRecord } from "./collectors/open-assembly";

export interface InternalRawArchive<TRecord extends { source: string; fetchedAt: string; raw: unknown }> {
  schema_version: "0.1.0";
  generated_at: string;
  visibility: "internal_only";
  warning: string;
  privacy_scan: RawPrivacyScanResult;
  records: TRecord[];
}

export interface RawPrivacyFinding {
  record_index: number;
  path: string;
  reason: "sensitive_key" | "sensitive_value";
  excerpt: string;
}

export interface RawPrivacyScanResult {
  status: "passed" | "blocked";
  findings: RawPrivacyFinding[];
}

export function buildInternalRawArchive<TRecord extends { source: string; fetchedAt: string; raw: unknown }>(
  records: TRecord[],
  generatedAt: string,
): InternalRawArchive<TRecord> {
  const privacyScan = scanRawRecordsForPrivateData(records);

  return {
    schema_version: "0.1.0",
    generated_at: generatedAt,
    visibility: "internal_only",
    warning: "Internal raw records are for reproducible verification only. Do not publish before source license review.",
    privacy_scan: privacyScan,
    records,
  };
}

export function assertRawArchivePublishableForInternalUse(
  archive: InternalRawArchive<{ source: string; fetchedAt: string; raw: unknown }>,
) {
  if (archive.privacy_scan.status === "blocked") {
    const paths = archive.privacy_scan.findings.map((finding) => finding.path).join(", ");
    throw new Error(`Internal raw archive contains possible private data: ${paths}`);
  }
}

/**
 * 사람 승인된 공개 연락 raw 키(ADR 2026-06-13). 이 키의 *값*은 전화/이메일 형태라도 leak이 아니므로
 * value-scan에서 제외한다(정책=공개 vs scan=차단 모순 방지). 키 이름 자체도 sensitiveKeyPatterns에서 빠져 있다.
 * 보좌진 실명(STAFF/SECRETARY/SECRETARY2)은 여기에 없으므로 계속 차단된다.
 */
const APPROVED_PUBLIC_CONTACT_KEYS = new Set(["TEL_NO", "E_MAIL", "ASSEM_ADDR", "HOMEPAGE"]);

export function scanRawRecordsForPrivateData(records: { raw?: unknown }[]): RawPrivacyScanResult {
  const findings = records.flatMap((record, recordIndex) => scanValue(record.raw, recordIndex, "raw"));

  return {
    status: findings.length > 0 ? "blocked" : "passed",
    findings,
  };
}

export function mockOpenAssemblyRawRecords(): OpenAssemblyMemberRecord[] {
  return [
    {
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
        MEM_TITLE: "공개 출처 기반 목 데이터",
      },
    },
  ];
}

/**
 * raw-archive privacy scan이 sensitive로 차단하는 키 패턴.
 *
 * ADR(2026-06-13, 사람 승인) 정렬: Open Assembly 공직 연락 필드(TEL_NO/E_MAIL/ASSEM_ADDR/HOMEPAGE)는
 * 사람이 §0.7로 **공개 승인**한 자기등록 채널이므로 더 이상 leak으로 보지 않는다 → 아래 패턴에서 제외해
 * 정책(공개)과 scan(차단)이 모순되지 않게 한다. 단 사인(보좌진) 실명(STAFF/SECRETARY/보좌/비서)은
 * 계속 차단한다. 또한 진짜 사적정보(주민번호·자택·가족·휴대전화 등)도 그대로 차단한다.
 *
 * 주의: `tel`/`email`/`addr`/`home`/`전화`/`주소` 등 연락 일반 패턴은 제거했다 — 승인된 공직 연락과
 * 충돌하기 때문. 진짜 사적 연락(자택·휴대)은 전용 패턴(자택/휴대/mobile)으로 따로 잡는다.
 */
const sensitiveKeyPatterns = [
  // 진짜 사적 식별/연락 정보(공개 승인 대상 아님):
  /resident/i,
  /rrn/i,
  /mobile/i,
  /family/i,
  /spouse/i,
  /child/i,
  /주민/,
  /가족/,
  /배우자/,
  /자녀/,
  /자택/,
  /휴대/,
  // 사인(보좌진) 실명 — 무조건 차단(STAFF/SECRETARY/SECRETARY2 및 한글 표기):
  /staff/i,
  /secretary/i,
  /보좌/,
  /비서/,
];

const sensitiveValuePatterns = [
  /\b\d{2,3}-\d{3,4}-\d{4}\b/,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b\d{6}-\d{7}\b/,
];

function scanValue(value: unknown, recordIndex: number, path: string): RawPrivacyFinding[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => scanValue(item, recordIndex, `${path}[${index}]`));
  }

  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, nestedValue]) => {
      const nextPath = `${path}.${key}`;
      const keyFindings = sensitiveKeyPatterns.some((pattern) => pattern.test(key))
        ? [
            {
              record_index: recordIndex,
              path: nextPath,
              reason: "sensitive_key" as const,
              excerpt: key,
            },
          ]
        : [];

      // 승인된 공개 연락 키(TEL_NO/E_MAIL/ASSEM_ADDR/HOMEPAGE)의 값은 전화·이메일 형태라도 leak이 아니므로
      // value-scan을 건너뛴다(정책=공개와 모순 방지). 키 이름 자체는 위에서 이미 sensitive로 안 잡힌다.
      const valueFindings = APPROVED_PUBLIC_CONTACT_KEYS.has(key)
        ? []
        : scanValue(nestedValue, recordIndex, nextPath);

      return [...keyFindings, ...valueFindings];
    });
  }

  if (typeof value === "string") {
    const match = sensitiveValuePatterns.find((pattern) => pattern.test(value));
    if (!match) return [];

    return [
      {
        record_index: recordIndex,
        path,
        reason: "sensitive_value",
        excerpt: value.slice(0, 80),
      },
    ];
  }

  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
