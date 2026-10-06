import type { Metadata } from "next";
import { JetBrains_Mono, Noto_Sans_KR } from "next/font/google";
import Link from "next/link";
import { ADMIN_ENABLED } from "@/lib/db";
import "./globals.css";

const noto = Noto_Sans_KR({ variable: "--font-noto", subsets: ["latin"], weight: ["400", "500", "700"] });
const mono = JetBrains_Mono({ variable: "--font-mono-jb", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Yomin — 무역데이터로 보는 미국 주식",
  description: "글로벌 세관 무역 데이터를 종목에 매핑해 실적을 먼저 읽습니다.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`${noto.variable} ${mono.variable} antialiased`}>
      <body className="min-h-screen font-sans">
        <header className="sticky top-0 z-10 border-b border-line bg-bg/90 backdrop-blur">
          <nav className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3 text-sm">
            <Link href="/" className="text-base font-bold">Yomin</Link>
            <Link href="/" className="text-muted hover:text-fg">급등 탐색</Link>
            <Link href="/stocks" className="text-muted hover:text-fg">종목</Link>
            <Link href="/compute" className="text-muted hover:text-fg">GPU·토큰</Link>
            {ADMIN_ENABLED && <Link href="/admin" className="ml-auto text-muted hover:text-fg">관리</Link>}
          </nav>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-7xl px-4 pb-10 text-xs text-muted">
          출처: U.S. Census Bureau, 일본 재무성 무역통계(e-Stat), SEC EDGAR. 투자 권유가 아닙니다.
        </footer>
      </body>
    </html>
  );
}
