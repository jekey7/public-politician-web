import Link from "next/link";
import { HomeSearch } from "./home-search";

export default function HomePage() {
  return (
    <main className="page-shell">
      <section className="hero-grid">
        <div>
          <p className="eyebrow">PUBLIC SNAPSHOT / SOURCE-FIRST</p>
          <h1>대한민국 국회의원 공개정보를 출처별로 대조합니다.</h1>
        </div>
        <div className="hero-panel">
          <p>
            공개 스냅샷의 사실 값은 출처 메타데이터와 함께 제공되며, 출처 간 값이 다르면 병합하지 않고
            함께 드러냅니다.
          </p>
          <Link className="primary-button" href="/qa">
            ASK WITH CITATIONS
          </Link>
        </div>
      </section>

      <HomeSearch />
    </main>
  );
}
