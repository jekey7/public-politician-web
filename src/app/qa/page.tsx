import { Suspense } from "react";
import { QaClient } from "./qa-client";

export default function QaPage() {
  return (
    <main className="page-shell qa-page">
      <section className="hero-grid">
        <div>
          <p className="eyebrow">RAG / CITATIONS ONLY</p>
          <h1>근거가 없으면 답하지 않는 질의응답</h1>
        </div>
        <p className="hero-panel">
          현재는 목 코퍼스에서 질문 단어와 일치하는 출처 스니펫만 반환합니다. LLM 도입 시에도 출처
          없는 응답은 &quot;관련 자료 없음&quot;으로 고정됩니다.
        </p>
      </section>

      <Suspense fallback={<p className="empty-state">질의응답 인터페이스를 불러오는 중입니다.</p>}>
        <QaClient />
      </Suspense>
    </main>
  );
}
