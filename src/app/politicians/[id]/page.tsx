import Link from "next/link";
import { notFound } from "next/navigation";
import { getProfileById, getProfiles } from "@/lib/profile-source";
import { allProfileEvidence } from "@/lib/snapshot";
import type { EvidenceValue, NecCoverage } from "@/lib/types";

export function generateStaticParams() {
  return getProfiles().map((politician) => ({ id: politician.politicianId }));
}

export default async function PoliticianDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const politician = getProfileById(id);
  if (!politician) notFound();
  const evidenceById = new Map(allProfileEvidence(politician).map((evidence) => [evidence.evidenceId, evidence]));

  return (
    <main className="page-shell detail-page">
      <Link className="back-link" href="/">
        BACK TO SEARCH
      </Link>

      <section className="detail-hero">
        <div>
          <p className="eyebrow">PUBLIC OFFICIAL PROFILE / SNAPSHOT</p>
          <h1>{politician.displayName}</h1>
          <p className="deck">
            모든 값은 출처 메타데이터와 함께 표시됩니다. 불일치는 병합하지 않고 같은 항목의 복수
            출처를 그대로 보여줍니다.
          </p>
        </div>
        <div className="discrepancy-tile">
          <span className="pill">DISCREPANCIES</span>
          <strong>{politician.discrepancies.length}</strong>
          <p>출처 간 차이가 탐지된 항목 수</p>
        </div>
      </section>

      {politician.necCoverage ? <NecCoverageNotice coverage={politician.necCoverage} /> : null}

      <section className="detail-grid">
        <FactSection
          title="인적사항"
          items={[...politician.party, ...politician.district, ...politician.position, ...politician.birthYear, ...politician.gender]}
        />
        <FactSection title="학력" items={politician.education} />
        <FactSection title="이력" items={[...politician.careers, ...politician.partyHistory, ...politician.elections]} />
        <FactSection
          title="의정활동"
          items={[...politician.activities.bills, ...politician.activities.votes, ...politician.activities.committees]}
        />
      </section>

      <section className="stream-section">
        <p className="section-label">DETECTED DIFFERENCES</p>
        {politician.discrepancies.length === 0 ? (
          <p className="empty-state">표시할 불일치가 없습니다.</p>
        ) : (
          <div className="story-stream">
            {politician.discrepancies.map((discrepancy) => (
              <article className="result-card warning-card" key={discrepancy.discrepancyId}>
                <div className="rail-time">{discrepancy.kind.toUpperCase()}</div>
                <div>
                  <p className="kicker">{discrepancy.category}</p>
                  <h2>{discrepancy.label}</h2>
                  <div className="evidence-list">
                    {discrepancy.evidenceIds.map((evidenceId) => {
                      const evidence = evidenceById.get(evidenceId);
                      if (!evidence) return <p key={evidenceId}>누락된 증거 ID: {evidenceId}</p>;

                      return (
                        <a href={evidence.source.sourceUrl} key={evidence.evidenceId} rel="noreferrer" target="_blank">
                          <span>{evidence.source.sourceOrg}</span>
                          <strong>{String(evidence.value)}</strong>
                          <small>
                            {evidence.reviewStatus} / {evidence.source.fetchedAt}
                          </small>
                        </a>
                      );
                    })}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="stream-section">
        <p className="section-label">RELATED NEWS</p>
        <div className="news-grid">
          {politician.news.length === 0 ? (
            <p className="empty-state">관련 자료 없음</p>
          ) : (
            politician.news.map((item) => (
              <a className="news-card" href={item.source.sourceUrl} key={item.newsId} rel="noreferrer" target="_blank">
              <span>{item.mediaKind.toUpperCase()}</span>
              <strong>{item.title}</strong>
              <small>
                {item.publisher} / {item.publishedAt} / {item.source.sourceOrg}
              </small>
            </a>
            ))
          )}
        </div>
      </section>
    </main>
  );
}

/**
 * NEC 교차검증 커버리지 상태(보류 / 범위 밖)를 정직하게 표시한다(불변 #3: 모르면 모른다).
 *
 * - ambiguous_withheld(보류): 동명이인 — 식별 불가. NEC 교차검증을 *수행하지 않았음*을 명시한다.
 *   "검증됨"으로도 "검수중"으로도 보이지 않게, 또 NEC 매칭이 된 것처럼 보이지 않게 한다(요구사항).
 * - out_of_scope(범위 밖): 비례대표 — 이 출처(NEC 지역구 당선인 API) 범위 밖. 미매칭(버그) 아님.
 *
 * 어느 쪽도 새 사실을 만들지 않는다. 쌍둥이를 가르기 위한 PII를 추가하지 않는다(불변 #7) — 보류가 정답 상태다.
 */
function NecCoverageNotice({ coverage }: { coverage: NecCoverage }) {
  const isWithheld = coverage.status === "ambiguous_withheld";
  const label = isWithheld ? "보류 — NEC 교차검증 식별 불가" : "범위 밖 — NEC 지역구 출처 대상 아님";
  const headline = isWithheld
    ? "NEC 교차검증을 보류했습니다."
    : "이 의원은 NEC 지역구 당선인 교차검증 범위 밖입니다.";
  const detail = isWithheld
    ? "안정적인 식별자가 없어 어느 NEC 당선인 레코드에 해당하는지 식별할 수 없습니다. 잘못된 매칭을 만들지 않기 위해 교차검증을 강제로 수행하지 않고 보류합니다. 이는 검증됨도 검수중도 아니며, NEC 매칭이 성립한 상태가 아닙니다."
    : "비례대표는 NEC 지역구 당선인 API의 대상이 아닙니다. 따라서 해당 출처와의 교차검증 대상이 아니며, 매칭 실패(버그)가 아닙니다.";

  return (
    <section className="stream-section">
      <p className="section-label">NEC CROSS-VERIFICATION STATUS</p>
      <article className="withheld-card" data-coverage-status={coverage.status}>
        <div className="rail-time">{label}</div>
        <h2>{headline}</h2>
        <p>{detail}</p>
        <p className="withheld-reason">사유: {coverage.reason}</p>
      </article>
    </section>
  );
}

function FactSection({ title, items }: { title: string; items: EvidenceValue<unknown>[] }) {
  return (
    <section className="fact-card">
      <h2>{title}</h2>
      <ul>
        {items.map((item) => (
          <li key={item.evidenceId}>
            <div>
              <span className="field-label">{item.field}</span>
              <strong>{String(item.value)}</strong>
              <p>
                {item.rawText} / {item.reviewStatus} / {item.source.fetchedAt}
              </p>
            </div>
            <a href={item.source.sourceUrl} rel="noreferrer" target="_blank">
              {item.source.sourceOrg}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
