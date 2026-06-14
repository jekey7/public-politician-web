"use client";

import React from "react";
import { publicArtifactLinks } from "@/lib/public-artifacts";
import { publicReleaseSummary } from "@/lib/public-release";

export const SEARCH_GATE_ENABLED = true;
export const SEARCH_GATE_NOTICE =
  "공개 데이터 산출물은 배포되어 있습니다. 홈 검색 UI만 스냅샷 기반 재작성 전까지 닫아 둡니다.";

export function HomeSearch() {
  if (SEARCH_GATE_ENABLED) {
    return <SearchGateNotice />;
  }

  return (
    <>
      <section className="stream-section">
        <p className="section-label">SEARCH RESULTS</p>
        <p className="empty-state">검색 기능을 불러올 수 없습니다.</p>
      </section>
    </>
  );
}

function SearchGateNotice() {
  return (
    <section className="search-gate" aria-label="검색 기능 안내">
      <p className="section-label">DATA RELEASED / SEARCH UI PAUSED</p>
      <p className="release-notice">{SEARCH_GATE_NOTICE}</p>
      <dl className="release-summary" aria-label="공개 스냅샷 요약">
        <div>
          <dt>FACTS</dt>
          <dd>{publicReleaseSummary.facts.toLocaleString("ko-KR")}</dd>
        </div>
        <div>
          <dt>DISCREPANCIES</dt>
          <dd>{publicReleaseSummary.discrepancies.toLocaleString("ko-KR")}</dd>
        </div>
        <div>
          <dt>GENERATED</dt>
          <dd>{publicReleaseSummary.generatedAt}</dd>
        </div>
      </dl>
      <div className="release-links" aria-label="공개 데이터 바로가기">
        {publicArtifactLinks.map((link) => (
          <a href={link.href} key={link.href}>
            {link.label}
          </a>
        ))}
      </div>
    </section>
  );
}
