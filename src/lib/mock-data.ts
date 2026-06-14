import { mockSyncVerifier } from "./ai";
import { detectProfileDiscrepanciesSync } from "./cross-verification";
import type { EvidenceValue, NewsItem, PoliticianProfile, SourceMeta } from "./types";

const fetchedAt = "2026-06-11T00:00:00.000Z";

const mockSource = (sourceId: string, sourceOrg: string, urlPath: string): SourceMeta => ({
  sourceId,
  sourceKind: "mock",
  sourceOrg,
  sourceUrl: `https://example.invalid/mock/${urlPath}`,
  fetchedAt,
  licenseNote: "MOCK DATA ONLY - replace with public source metadata before production exposure",
});

const evidence = <T,>(
  evidenceId: string,
  field: string,
  value: T,
  rawText: string,
  source: SourceMeta,
  category: EvidenceValue<T>["category"] = "identity",
): EvidenceValue<T> => ({
  evidenceId,
  category,
  field,
  value,
  rawText,
  source,
  reviewStatus: "reviewing",
});

const openAssembly = mockSource("mock-open-assembly", "열린국회정보 목", "open-assembly");
const rokps = mockSource("mock-rokps", "헌정회 목", "rokps");
const nec = mockSource("mock-nec", "중앙선거관리위원회 목", "nec");
const newsSource = mockSource("mock-news", "뉴스 검색 목", "news");

const news: NewsItem[] = [
  {
    newsId: "news-001",
    politicianId: "mock-001",
    title: "[목 기사] 국회 상임위 활동 공개 자료 점검",
    publisher: "목 언론사",
    publishedAt: "2026-06-01",
    source: newsSource,
    mediaKind: "article",
  },
  {
    newsId: "news-002",
    politicianId: "mock-001",
    title: "[목 영상] 공개 회의 발언 원문 링크",
    publisher: "목 채널",
    publishedAt: "2026-05-18",
    source: mockSource("mock-video", "영상 검색 목", "video"),
    mediaKind: "video",
  },
];

const rawPoliticians: PoliticianProfile[] = [
  {
    politicianId: "mock-001",
    displayName: "김공개",
    party: [
      evidence("ev-party-oa", "party", "가상정당", "가상정당", openAssembly),
      evidence("ev-party-nec", "party", "가상정당", "가상정당", nec),
    ],
    district: [evidence("ev-district-oa", "district", "서울 목구갑", "서울 목구갑", openAssembly)],
    position: [evidence("ev-position-oa", "position", "제22대 국회의원", "제22대 국회의원", openAssembly)],
    // mock 프로필에는 위원회 직책 값이 없다 → 빈 배열(JOB_RES_NM null과 동일하게 무 사실). 출처 없는 값 미생성.
    committeeRole: [],
    contact: [],
    birthYear: [evidence("ev-birth-rokps", "birthYear", 1978, "1978년 출생", rokps)],
    gender: [evidence("ev-gender-rokps", "gender", "비공개", "공개 출처에 표시 없음", rokps)],
    education: [
      evidence("ev-edu-oa", "education", "한국공개대학교 행정학과 졸업", "한국공개대학교 행정학과 졸업", openAssembly, "education"),
      evidence("ev-edu-rokps", "education", "한국공개대학교 행정학 학사", "한국공개대학교 행정학 학사", rokps, "education"),
      evidence("ev-edu-nec", "education", "한국공개대학교 정치외교학과 졸업", "한국공개대학교 정치외교학과 졸업", nec, "education"),
    ],
    careers: [
      evidence("ev-career-oa", "career", "국회 공개정책연구회 연구위원", "국회 공개정책연구회 연구위원", openAssembly, "career"),
      evidence("ev-career-rokps", "career", "공개정책연구회 연구위원", "공개정책연구회 연구위원", rokps, "career"),
    ],
    partyHistory: [
      evidence("ev-party-history-nec", "partyHistory", "2024 가상정당 입당", "2024 가상정당 입당", nec, "party_history"),
    ],
    elections: [
      evidence("ev-election-nec", "elections", "2024 제22대 국회의원선거 서울 목구갑 당선", "2024 제22대 국회의원선거 서울 목구갑 당선", nec, "election"),
    ],
    activities: {
      bills: [evidence("ev-bill-oa", "bills", "공공데이터 출처표시 강화법안 대표발의", "공공데이터 출처표시 강화법안 대표발의", openAssembly, "bill")],
      votes: [evidence("ev-vote-oa", "votes", "공개회의 표결: 찬성", "공개회의 표결: 찬성", openAssembly, "vote")],
      committees: [
        evidence("ev-committee-oa", "committees", "데이터투명성특별위원회", "데이터투명성특별위원회", openAssembly, "committee"),
        evidence("ev-committee-rokps", "committees", "자료투명성특별위원회", "자료투명성특별위원회", rokps, "committee"),
      ],
    },
    // 불일치는 사전 작성하지 않고 cross-verification 탐지로 채운다(아래 detect 패스 참고).
    discrepancies: [],
    news,
  },
  {
    politicianId: "mock-002",
    displayName: "이투명",
    party: [evidence("ev2-party-oa", "party", "샘플정당", "샘플정당", openAssembly)],
    district: [evidence("ev2-district-oa", "district", "부산 예시구을", "부산 예시구을", openAssembly)],
    position: [evidence("ev2-position-oa", "position", "제22대 국회의원", "제22대 국회의원", openAssembly)],
    committeeRole: [],
    contact: [],
    birthYear: [evidence("ev2-birth-rokps", "birthYear", 1982, "1982년 출생", rokps)],
    gender: [evidence("ev2-gender-rokps", "gender", "비공개", "공개 출처에 표시 없음", rokps)],
    education: [evidence("ev2-edu-oa", "education", "샘플대학교 법학과 졸업", "샘플대학교 법학과 졸업", openAssembly, "education")],
    careers: [evidence("ev2-career-oa", "career", "공개입법센터 자문위원", "공개입법센터 자문위원", openAssembly, "career")],
    partyHistory: [evidence("ev2-party-history-nec", "partyHistory", "2024 샘플정당 입당", "2024 샘플정당 입당", nec, "party_history")],
    elections: [evidence("ev2-election-nec", "elections", "2024 제22대 국회의원선거 부산 예시구을 당선", "2024 제22대 국회의원선거 부산 예시구을 당선", nec, "election")],
    activities: {
      bills: [evidence("ev2-bill-oa", "bills", "공개회의록 접근성 개선안 공동발의", "공개회의록 접근성 개선안 공동발의", openAssembly, "bill")],
      votes: [evidence("ev2-vote-oa", "votes", "공개회의 표결: 기권", "공개회의 표결: 기권", openAssembly, "vote")],
      committees: [evidence("ev2-committee-oa", "committees", "공공정보위원회", "공공정보위원회", openAssembly, "committee")],
    },
    discrepancies: [],
    news: [],
  },
];

// 정적 mock 데이터의 불일치도 cross-verification 탐지로 생성한다(사전 작성 금지, 불변 원칙 #1·#4).
// async 파이프라인(runVerificationPipeline)과 동일한 탐지 로직(detectProfileDiscrepanciesSync)을 공유한다.
export const politicians: PoliticianProfile[] = rawPoliticians.map((profile) => ({
  ...profile,
  discrepancies: detectProfileDiscrepanciesSync(profile, mockSyncVerifier, { detectedAt: fetchedAt }),
}));

export const getPoliticianById = (politicianId: string) =>
  politicians.find((politician) => politician.politicianId === politicianId);
