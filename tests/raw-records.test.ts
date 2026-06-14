import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRawArchivePublishableForInternalUse,
  buildInternalRawArchive,
  mockOpenAssemblyRawRecords,
  scanRawRecordsForPrivateData,
} from "../src/lib/raw-records";

test("internal raw archive is explicitly marked as non-public", () => {
  const archive = buildInternalRawArchive(mockOpenAssemblyRawRecords(), "2026-06-11T00:00:00.000Z");

  assert.equal(archive.visibility, "internal_only");
  assert.match(archive.warning, /Do not publish/);
  assert.equal(archive.privacy_scan.status, "passed");
  assert.equal(archive.records.length, 1);
  assert.equal(archive.records[0]?.source, "open_assembly");
});

test("raw privacy scan blocks genuinely-private keys and values", () => {
  const scan = scanRawRecordsForPrivateData([
    {
      raw: {
        HG_NM: "홍공개",
        주민등록번호: "900101-1234567", // sensitive key (주민) + sensitive RRN value
        MOBILE: "010-1234-5678", // private mobile (not an approved office channel)
      },
    },
  ]);

  assert.equal(scan.status, "blocked");
  assert.ok(scan.findings.some((finding) => finding.reason === "sensitive_key"));
  assert.ok(scan.findings.some((finding) => finding.reason === "sensitive_value"));
});

test("raw privacy scan does NOT flag approved public-contact fields (TEL_NO/E_MAIL/ASSEM_ADDR/HOMEPAGE)", () => {
  // ADR(사람 승인): 자기등록 공직 연락 채널은 leak이 아니다 — 키/값 모두 통과해야 한다.
  const scan = scanRawRecordsForPrivateData([
    {
      raw: {
        HG_NM: "강현직",
        TEL_NO: "02-000-0000",
        E_MAIL: "office@example.invalid",
        ASSEM_ADDR: "의원회관 000호",
        HOMEPAGE: "https://blog.example.invalid/x",
      },
    },
  ]);

  assert.equal(scan.status, "passed", "approved public-contact fields must not be flagged as private");
  assert.equal(scan.findings.length, 0);
});

test("internal raw archive assertion rejects privacy scan findings", () => {
  const archive = buildInternalRawArchive(
    [
      {
        source: "open_assembly",
        fetchedAt: "2026-06-11T00:00:00.000Z",
        raw: {
          EMAIL: "person@example.com",
        },
      },
    ],
    "2026-06-11T00:00:00.000Z",
  );

  assert.throws(() => assertRawArchivePublishableForInternalUse(archive), /possible private data/);
});
