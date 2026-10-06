import type { Metadata } from "next";
import { JetBrains_Mono, Noto_Sans_KR } from "next/font/google";
import Link from "next/link";
import { ADMIN_ENABLED } from "@/lib/db";
import "./globals.css";

const noto = Noto_Sans_KR({ variable: "--font-noto", subsets: ["latin"], weight: ["400", "500", "700"] });
const mono = JetBrains_Mono({ variable: "--font-mono-jb", subsets: ["latin"] });

const DESC = "미국·일본·한국 세관 데이터와 가격지수로 AI·반도체 공급망의 흐름을 추적합니다.";

export const metadata: Metadata = {
  metadataBase: new URL("https://buywhenitgoesup.vercel.app"),
  title: { default: "Investing Idea — Supply Chain Intelligence", template: "%s · Investing Idea" },
  description: DESC,
  openGraph: { title: "Investing Idea — Supply Chain Intelligence", description: DESC, siteName: "Investing Idea", locale: "ko_KR", type: "website" },
  twitter: { card: "summary_large_image", title: "Investing Idea — Supply Chain Intelligence", description: DESC },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`${noto.variable} ${mono.variable} antialiased`}>
      <body className="min-h-screen font-sans">
        <header className="sticky top-0 z-10 border-b border-line bg-bg/90 backdrop-blur">
          <nav className="mx-auto flex max-w-7xl items-center gap-x-5 gap-y-1 overflow-x-auto whitespace-nowrap px-4 py-3 text-sm">
            <Link href="/" className="text-base font-bold">Investing Idea</Link>
            <Link href="/stocks" className="text-muted hover:text-fg">종목</Link>
            <Link href="/prices" className="text-muted hover:text-fg">가격·지수</Link>
            <Link href="/surge" className="text-muted hover:text-fg">급등 탐색</Link>
            {ADMIN_ENABLED && <Link href="/admin" className="ml-auto text-muted hover:text-fg">관리</Link>}
          </nav>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-7xl px-4 pb-10 text-xs text-muted">
          출처: U.S. Census Bureau, 일본 재무성 무역통계(e-Stat), 한국 관세청, SEC EDGAR·DART, BLS, Vast.ai, OpenRouter. 투자 권유가 아닙니다.
        </footer>
      </body>
    </html>
  );
}
