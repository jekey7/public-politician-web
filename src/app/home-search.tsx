"use client";

import React from "react";

export const SEARCH_GATE_ENABLED = true;
export const SEARCH_GATE_NOTICE = "검색 기능은 현재 개발 중이며, 복구되는 대로 제공할 예정입니다.";

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
      <p className="section-label">SEARCH TEMPORARILY UNAVAILABLE</p>
      <p>{SEARCH_GATE_NOTICE}</p>
    </section>
  );
}
