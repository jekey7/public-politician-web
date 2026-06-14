import type { Metadata } from "next";
import Link from "next/link";
import { publicArtifactLinks } from "@/lib/public-artifacts";
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
            <a href="https://github.com/" rel="noreferrer" target="_blank">
              OPEN SOURCE
            </a>
          </nav>
        </header>
        {children}
        <footer className="site-footer">
          <div>
            <p className="section-label">PUBLIC DATA</p>
            <p>목 데이터 기준 공개 스냅샷 산출물입니다. 실제 데이터 릴리스 전까지 사실로 해석하지 마세요.</p>
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
