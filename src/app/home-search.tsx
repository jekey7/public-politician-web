"use client";

import Link from "next/link";
import React, { useMemo, useState } from "react";
import type { PoliticianSummary } from "@/lib/politician-summary";

export type { PoliticianSummary } from "@/lib/politician-summary";

interface HomeSearchClientProps {
  politicians: PoliticianSummary[];
}

export function HomeSearchClient({ politicians }: HomeSearchClientProps) {
  const [query, setQuery] = useState("");
  const [party, setParty] = useState("all");
  const [region, setRegion] = useState("all");

  const parties = useMemo(
    () => Array.from(new Set(politicians.map((p) => p.party).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ko")),
    [politicians],
  );

  const regions = useMemo(
    () =>
      Array.from(new Set(politicians.map((p) => p.district.split(" ")[0] ?? p.district).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, "ko"),
      ),
    [politicians],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return politicians.filter((p) => {
      if (q && !`${p.displayName} ${p.party} ${p.district}`.toLowerCase().includes(q)) return false;
      if (party !== "all" && p.party !== party) return false;
      if (region !== "all" && !p.district.startsWith(region)) return false;
      return true;
    });
  }, [politicians, query, party, region]);

  return (
    <>
      <div className="filter-strip">
        <label>
          <span>이름 · 정당 · 지역구</span>
          <input
            placeholder="검색"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          <span>정당</span>
          <select value={party} onChange={(e) => setParty(e.target.value)}>
            <option value="all">전체</option>
            {parties.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>지역</span>
          <select value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="all">전체</option>
            {regions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <p className="result-count">{filtered.length}명</p>
      </div>

      <section className="stream-section">
        <p className="section-label">SEARCH RESULTS</p>
        {filtered.length === 0 ? (
          <p className="empty-state">검색 결과가 없습니다.</p>
        ) : (
          <div className="politician-grid">
            {filtered.map((p) => (
              <Link className="politician-card" href={`/politicians/${p.politicianId}`} key={p.politicianId}>
                <strong>{p.displayName}</strong>
                <span className="politician-meta">
                  {p.party}
                  {p.district ? ` · ${p.district}` : ""}
                </span>
                {p.discrepancyCount > 0 && (
                  <span className="discrepancy-badge">{p.discrepancyCount} 불일치</span>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

