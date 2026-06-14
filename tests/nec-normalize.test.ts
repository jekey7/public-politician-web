import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalSido,
  normalizeNameForMatch,
  normalizePartyForMatch,
  normalizeDistrictForMatch,
  normalizeDistrictForMatchSidoAware,
  sameNormalizedKey,
  KR_SIDO_CANONICAL,
} from "../src/lib/collectors/nec-normalize";

/**
 * 이 테스트는 라이브 2026-06-14 dry-run에서 **실제 관측된** 표기차로만 규칙을 잠근다(가상 변형 금지).
 * 핵심 안전 속성(불변 #4): 정규화가 진짜 다른 값을 같은 키로 무너뜨리지 않는다(특히 다른 시의 동일 선거구명),
 * 그리고 진짜 같은 값(시도 표기형만 다름)은 같은 키가 된다(놓친 매칭이 conflict를 숨기지 않게).
 */

// ── party: 공백·NFC만, 글자 자체는 보존(진짜 당명 차이 보존) ──
test("party normalize collapses whitespace only — does NOT collapse different parties", () => {
  assert.equal(normalizePartyForMatch("더불어민주당"), normalizePartyForMatch(" 더불어 민주당 "));
  // 무소속 vs 새로운미래(김종민 실제 케이스)는 서로 다른 키 — content_conflict로 surface돼야 한다.
  assert.notEqual(normalizePartyForMatch("무소속"), normalizePartyForMatch("새로운미래"));
  assert.notEqual(normalizePartyForMatch("무소속"), normalizePartyForMatch("더불어민주당"));
});

// ── name: 공백 제거(매칭 전용, emit 안 됨) ──
test("name normalize strips spaces/case (match-only)", () => {
  assert.equal(normalizeNameForMatch("김 공개"), normalizeNameForMatch("김공개"));
});

// ── canonical 시도: 정식형↔단축형 환원(라이브 관측 17개) ──
test("canonicalSido reconciles full official names and short tokens to the same short token", () => {
  assert.equal(canonicalSido("인천광역시"), "인천");
  assert.equal(canonicalSido("인천"), "인천");
  assert.equal(canonicalSido("강원특별자치도"), "강원");
  assert.equal(canonicalSido("전북특별자치도"), "전북");
  assert.equal(canonicalSido("경기도"), "경기");
  assert.equal(canonicalSido("세종특별자치시"), "세종");
  assert.equal(canonicalSido("없는시도"), "");
  assert.equal(KR_SIDO_CANONICAL.length, 17);
});

// ── district sido-aware (Option B, 권장): OA 단축형 == NEC 정식형 sdName, 같은 선거구 ──
test("sido-aware district: OA short-prefix == NEC full-sdName for the SAME 선거구 (notation match)", () => {
  // OA "서울 강서구갑" (단축 접두) vs NEC sggName "강서구갑" + sdName "서울특별시"
  const oaKey = normalizeDistrictForMatchSidoAware("서울 강서구갑");
  const necKey = normalizeDistrictForMatchSidoAware("강서구갑", "서울특별시");
  assert.equal(oaKey, necKey);
  assert.equal(oaKey, "서울강서구갑");
});

// ── district sido-aware: 다른 시의 같은 선거구명은 다른 키(불변 #4 충돌 방지) ──
test("sido-aware district: same 선거구명 in DIFFERENT cities stays DISTINCT (no collision)", () => {
  // 라이브에서 충돌했던 "서구갑": 인천/대전/광주 — sido-aware로 분리 보존돼야 한다.
  const incheon = normalizeDistrictForMatchSidoAware("서구갑", "인천광역시");
  const daejeon = normalizeDistrictForMatchSidoAware("서구갑", "대전광역시");
  const gwangju = normalizeDistrictForMatchSidoAware("서구갑", "광주광역시");
  assert.equal(incheon, "인천서구갑");
  assert.notEqual(incheon, daejeon);
  assert.notEqual(daejeon, gwangju);
  // 그리고 OA 측 "인천 서구갑"과는 같아야 한다(같은 선거구).
  assert.equal(incheon, normalizeDistrictForMatchSidoAware("인천 서구갑"));
});

// ── district sido-aware: 세종 엣지케이스(시도명이 선거구명에 내장, 공백 없음) ──
test("sido-aware district: 세종 (sido embedded in 선거구명, no space) does NOT double-prepend", () => {
  // 김종민 실제 케이스: OA "세종특별자치시갑", NEC sggName "세종특별자치시갑" + sdName "세종특별자치시".
  const oaKey = normalizeDistrictForMatchSidoAware("세종특별자치시갑");
  const necKey = normalizeDistrictForMatchSidoAware("세종특별자치시갑", "세종특별자치시");
  assert.equal(oaKey, necKey, "세종 keys must match (else a real conflict would be hidden — 불변 #4)");
  assert.equal(oaKey, "세종갑");
  // 세종갑 != 세종을 (선거구는 보존).
  assert.notEqual(
    normalizeDistrictForMatchSidoAware("세종특별자치시갑"),
    normalizeDistrictForMatchSidoAware("세종특별자치시을"),
  );
  // idempotent: 이미 canonical 키를 다시 넣어도 동일(파이프라인이 키를 재투입해도 안전).
  assert.equal(normalizeDistrictForMatchSidoAware("세종갑"), "세종갑");
  assert.equal(normalizeDistrictForMatchSidoAware("인천서구갑"), "인천서구갑");
});

// ── Option A (측정 전용)의 충돌 위험을 테스트로 명시(이래서 단독 사용 금지) ──
test("Option A district (bare 선거구명) COLLIDES across cities — documents why it is measurement-only", () => {
  // 시도 제거 → 인천/대전 "서구갑"이 같은 키로 무너진다(충돌). 이 동작을 잠가 경고를 남긴다.
  assert.equal(normalizeDistrictForMatch("인천 서구갑"), normalizeDistrictForMatch("대전 서구갑"));
  assert.equal(normalizeDistrictForMatch("인천 서구갑"), "서구갑");
});

// ── sameNormalizedKey: 빈 값은 일치로 보지 않는다 ──
test("sameNormalizedKey treats empty/null as non-match", () => {
  assert.equal(sameNormalizedKey("", ""), false);
  assert.equal(sameNormalizedKey(null, "x"), false);
  assert.equal(sameNormalizedKey("x", "x"), true);
});
