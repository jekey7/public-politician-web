import { readFileSync } from "node:fs";
import { join } from "node:path";
import { politicians as mockPoliticians } from "./mock-data";
import { reconstructProfilesFromSnapshot, type SnapshotCoverageSidecar } from "./snapshot-reader";
import type { PoliticianProfile, PublicSnapshot } from "./types";

/**
 * 상세/검색 화면의 **단일 진실 공급원** 선택. 명시적이다(implicit 아님):
 *
 *   1) 공개 스냅샷(public/snapshots/latest.json)이 존재하면 → 그것을 프로필로 재구성해 사용한다(source="snapshot").
 *   2) 스냅샷이 없을 때만 → mock-data로 폴백한다(source="mock").
 *
 * 즉 스냅샷이 있으면 mock은 무시된다. go-live로 NEC 사실이 스냅샷에 실리면 추가 배선 없이 화면에 나타난다.
 * (현재 커밋된 공개 스냅샷은 mock 데이터다 → 재구성 결과도 동일 mock 내용. 단 *경로*가 스냅샷이라 NEC-ready.)
 *
 * 커버리지 사이드카(coverage.json)는 선택이다. 있으면 보류/범위밖 상태를 동반시키고, 없으면 carrier 없이 둔다
 * (불변 #3: 모르면 모른다를 타입으로 — 사이드카 부재 시 라벨을 지어내지 않는다). 공개 스냅샷 본문은 불변.
 *
 * SSG(빌드 시) 동기 파일 읽기. 환경변수 `PROFILE_SNAPSHOT_PATH`로 대체 스냅샷 경로를 주입할 수 있다
 * (내부 dry-run 스냅샷 대상 end-to-end 렌더링 점검용 — 공개 출력은 손대지 않는다).
 */

export type ProfileSourceKind = "snapshot" | "mock";

export interface ProfileSource {
  source: ProfileSourceKind;
  /** 어떤 스냅샷 파일을 읽었는지(snapshot일 때). mock 폴백이면 undefined. */
  snapshotPath?: string;
  profiles: PoliticianProfile[];
}

const DEFAULT_SNAPSHOT_PATH = join(process.cwd(), "public", "snapshots", "latest.json");

function readJsonIfPresent<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/**
 * 커버리지 사이드카 후보 경로(선택). 스냅샷 파일명 규약 두 가지를 본다(먼저 매칭되는 것 사용):
 *   1) `<snapshot-basename>-coverage.json` (예: snapshot-latest.json → snapshot-coverage.json 규약을 일반화:
 *       `latest.json` → `latest-coverage.json`; 또한 prefix 규약 `snapshot-latest`→`snapshot-coverage`도 본다)
 *   2) 같은 디렉터리의 `coverage.json`
 * 셋 다 없으면 carrier 없이 진행한다(불변 #3: 라벨을 지어내지 않는다).
 */
function coverageSidecarCandidates(snapshotPath: string): string[] {
  const lastSlash = Math.max(snapshotPath.lastIndexOf("/"), snapshotPath.lastIndexOf("\\"));
  const dir = lastSlash >= 0 ? snapshotPath.slice(0, lastSlash) : ".";
  const file = lastSlash >= 0 ? snapshotPath.slice(lastSlash + 1) : snapshotPath;
  const base = file.replace(/\.json$/i, "");
  const candidates = [
    join(dir, `${base}-coverage.json`),
    // dry-run 규약: snapshot-latest.json ↔ snapshot-coverage.json (basename 끝 토큰을 coverage로 치환).
    join(dir, `${base.replace(/-[^-]*$/, "")}-coverage.json`),
    join(dir, "coverage.json"),
  ];
  return [...new Set(candidates)];
}

let cached: ProfileSource | undefined;

export function loadProfilesSource(): ProfileSource {
  if (cached) return cached;

  const snapshotPath = process.env.PROFILE_SNAPSHOT_PATH?.trim() || DEFAULT_SNAPSHOT_PATH;
  const snapshot = readJsonIfPresent<PublicSnapshot>(snapshotPath);

  if (snapshot && Array.isArray(snapshot.verified_facts)) {
    let coverage: SnapshotCoverageSidecar | undefined;
    for (const candidate of coverageSidecarCandidates(snapshotPath)) {
      coverage = readJsonIfPresent<SnapshotCoverageSidecar>(candidate);
      if (coverage) break;
    }
    cached = {
      source: "snapshot",
      snapshotPath,
      profiles: reconstructProfilesFromSnapshot(snapshot, coverage),
    };
    return cached;
  }

  // 스냅샷이 없을 때만 폴백.
  cached = { source: "mock", profiles: mockPoliticians };
  return cached;
}

export function getProfiles(): PoliticianProfile[] {
  return loadProfilesSource().profiles;
}

export function getProfileById(politicianId: string): PoliticianProfile | undefined {
  return getProfiles().find((p) => p.politicianId === politicianId);
}
