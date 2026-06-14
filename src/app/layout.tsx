import type { Metadata } from "next";
import Link from "next/link";
import { publicArtifactLinks } from "@/lib/public-artifacts";
import { publicReleaseSummary } from "@/lib/public-release";
import "./globals.css";

export const metadata: Metadata = {
  title: "국회의원 공개정보 검증 플랫폼 MVP",
  description: "출처 기반 대한민국 국회의원 정보 교차검증 MVP",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        <header className="site-header">
          <Link className="wordmark" href="/">
            PUBLIC ASSEMBLY
          </Link>
          <nav className="top-nav" aria-label="주요 메뉴">
            <Link href="/">SEARCH</Link>
            <Link href="/qa">RAG Q&A</Link>
            <a href="https://github.com/jekey7/public-politician-web" rel="noreferrer" target="_blank">
              OPEN SOURCE
            </a>
          </nav>
        </header>
        {children}
        <footer className="site-footer">
          <div>
            <p className="section-label">PUBLIC DATA</p>
            <p>
              열린국회정보 기반 공개 스냅샷 산출물입니다. 사실 {publicReleaseSummary.facts.toLocaleString("ko-KR")}건,
              불일치 {publicReleaseSummary.discrepancies.toLocaleString("ko-KR")}건을 출처 메타데이터와 함께 제공합니다.
            </p>
          </div>
          <nav aria-label="공개 데이터 링크">
            {publicArtifactLinks.map((link) => (
              <a href={link.href} key={link.href}>
                {link.label}
              </a>
            ))}
          </nav>
        </footer>
      </body>
    </html>
  );
}
