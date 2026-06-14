import { politicians as mockPoliticians } from "./mock-data";
import { reconstructProfilesFromSnapshot, type SnapshotCoverageSidecar } from "./snapshot-reader";
import type { PoliticianProfile, PublicSnapshot } from "./types";

/**
 * 상세/검색 화면의 **단일 진실 공급원** 선택. 명시적이다(implicit 아님):
 *
 *   1) 공개 스냅샷(public/snapshots/latest.json)이 존재하면 → 그것을 프로필로 재구성해 사용한다(source="snapshot").
 *   2) 스냅샷이 없을 때만 → mock-data로 폴백한다(source="mock").
 *
 * 정적 import를 사용해 번들러가 빌드 시점에 JSON을 포함시킨다.
 * (fs.readFileSync + process.cwd() 방식은 Vercel 정적 빌드에서 경로를 찾지 못해 mock으로 폴백되는 문제가 있었음)
 */

// 정적 import — 번들러가 빌드 시 포함, Vercel 정적 빌드에서도 경로 문제 없음.
import snapshotJson from "../../public/snapshots/latest.json";
import coverageJson from "../../public/snapshots/latest-coverage.json";

export type ProfileSourceKind = "snapshot" | "mock";

export interface ProfileSource {
  source: ProfileSourceKind;
  profiles: PoliticianProfile[];
}

let cached: ProfileSource | undefined;

export function loadProfilesSource(): ProfileSource {
  if (cached) return cached;

  const snapshot = snapshotJson as unknown as PublicSnapshot;

  if (snapshot && Array.isArray(snapshot.verified_facts)) {
    let coverage: SnapshotCoverageSidecar | undefined;
    try {
      coverage = coverageJson as unknown as SnapshotCoverageSidecar;
    } catch {
      // 커버리지 사이드카 없음 — 불변 #3: 라벨을 지어내지 않는다
    }
    cached = {
      source: "snapshot",
      profiles: reconstructProfilesFromSnapshot(snapshot, coverage),
    };
    return cached;
  }

  cached = { source: "mock", profiles: mockPoliticians };
  return cached;
}

export function getProfiles(): PoliticianProfile[] {
  return loadProfilesSource().profiles;
}

export function getProfileById(politicianId: string): PoliticianProfile | undefined {
  return getProfiles().find((p) => p.politicianId === politicianId);
}
