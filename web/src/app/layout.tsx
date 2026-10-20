import type { Metadata } from "next";
import { JetBrains_Mono, Noto_Sans_KR } from "next/font/google";
import Link from "next/link";
import { HtmlLang, OnlyLang } from "@/components/Lang";
import { NameToggle, NAME_INIT } from "@/components/NameToggle";
import { BottomNav, NavTabs } from "@/components/NavTabs";
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
    <html lang="ko" className={`${noto.variable} ${mono.variable} antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NAME_INIT }} />
      </head>
      <body className="min-h-screen font-sans">
        <HtmlLang />
        <OnlyLang lang="en">
          <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
            <div className="mx-auto flex h-12 max-w-7xl items-center gap-4 px-4 text-sm sm:h-[52px]">
              <Link href="/en" className="mr-auto shrink-0 text-base font-bold tracking-tight">Investing Idea</Link>
              <Link href="/en#earnings" className="text-muted hover:text-fg">Earnings</Link>
              <Link href="/en#coverage" className="text-muted hover:text-fg">Coverage</Link>
              {process.env.X_HANDLE && <a href={`https://x.com/${process.env.X_HANDLE.replace("@", "")}`} className="text-muted hover:text-fg" target="_blank" rel="noreferrer">X</a>}
              <Link href="/" className="rounded-lg border border-line px-2 py-1 text-xs text-muted hover:text-fg">한국어</Link>
            </div>
          </header>
        </OnlyLang>
        <OnlyLang lang="ko">
        <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
          <div className="mx-auto flex h-12 max-w-7xl items-center gap-2 px-4 sm:h-[52px]">
            <Link href="/" className="mr-2 shrink-0 text-base font-bold tracking-tight">Investing Idea</Link>
            <nav className="flex min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap text-sm" aria-label="메뉴">
              <NavTabs admin={ADMIN_ENABLED} />
            </nav>
            <NameToggle />
            <Link href="/en" className="hidden shrink-0 rounded-lg border border-line px-2 py-1 text-xs text-muted hover:text-fg sm:inline" title="English">EN</Link>
          </div>
        </header>
        </OnlyLang>
        <main className="mx-auto max-w-7xl px-4 pt-5 pb-24 md:pb-10">{children}</main>
        <OnlyLang lang="en">
          <footer className="mx-auto max-w-7xl px-4 pb-10 text-xs leading-relaxed text-muted">
            Sources: U.S. Census Bureau, Japan Ministry of Finance (e-Stat), Korea Customs Service, SEC EDGAR, DART and other public data.
            Estimates are model outputs, not forecasts of any stock. Not investment advice.
          </footer>
        </OnlyLang>
        <OnlyLang lang="ko">
        <footer className="mx-auto max-w-7xl px-4 pb-28 text-xs leading-relaxed text-muted md:pb-10">
          출처: U.S. Census Bureau, 일본 재무성 무역통계(e-Stat), 한국 관세청, SEC EDGAR·DART, BLS, FRED, Vast.ai, OpenRouter 등. 투자 권유가 아닙니다.{" "}
          <Link href="/about" className="text-accent">운영·방법론 소개 →</Link> ·{" "}
          <a href="https://t.me/buywhenitgoesup" target="_blank" rel="noreferrer" className="text-accent">텔레그램 채널</a>
        </footer>
        <BottomNav />
        </OnlyLang>
      </body>
    </html>
  );
}
