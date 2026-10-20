"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { T } from "@/components/Names";

type Tab = { href: string; label: string; en: string; icon: keyof typeof ICONS };
/** 메뉴 — 데스크톱은 상단에 모두, 모바일은 하단 막대(앞 4개 + 더보기) */
const TABS: Tab[] = [
  { href: "/", label: "브리핑", en: "Briefing", icon: "home" },
  { href: "/stocks", label: "종목", en: "Stocks", icon: "list" },
  { href: "/earnings", label: "실적 추정", en: "Earnings", icon: "target" },
  { href: "/prices", label: "업황", en: "Industry", icon: "pulse" },
  { href: "/macro", label: "매크로", en: "Macro", icon: "globe" },
  { href: "/credit", label: "신용", en: "Credit", icon: "shield" },
  { href: "/surge", label: "무역 탐색", en: "Trade", icon: "ship" },
  { href: "/calendar", label: "일정", en: "Calendar", icon: "cal" },
];
const MORE: Tab[] = [...TABS.slice(4), { href: "/plants", label: "공장 지도", en: "Plants", icon: "pin" }, { href: "/about", label: "소개·방법론", en: "About", icon: "info" }];

const ICONS = {
  home: <path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" />,
  list: <path d="M4 6h16M4 12h16M4 18h10" />,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.5" /></>,
  pulse: <path d="M3 12h4l2.5-6 4 12 2.5-6H21" />,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" /></>,
  shield: <path d="M12 3 4.5 6v6c0 4.5 3.2 7.8 7.5 9 4.3-1.2 7.5-4.5 7.5-9V6z" />,
  ship: <path d="M3 17l2 3h14l2-3M5 17V10l7-3 7 3v7M12 7V3" />,
  cal: <><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  pin: <><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></>,
  more: <><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></>,
};
const Icon = ({ k, className = "h-5 w-5" }: { k: keyof typeof ICONS; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>{ICONS[k]}</svg>
);

const useActive = () => {
  const path = usePathname();
  return (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
};

/** 데스크톱 상단 탭 (종목 상세 /stocks/MU 도 '종목' 탭) */
export function NavTabs({ admin }: { admin: boolean }) {
  const active = useActive();
  const tabs = admin ? [...TABS, { href: "/admin", label: "관리", en: "Admin", icon: "list" as const }] : TABS;
  return (
    <div className="hidden items-center gap-0.5 md:flex">
      {tabs.map((t) => {
        const on = active(t.href);
        return (
          <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined}
            className={`shrink-0 rounded-lg px-2.5 py-1.5 transition lg:px-3 ${on ? "bg-accent/20 font-bold text-accent" : "text-muted hover:bg-panel2 hover:text-fg"}`}>
            <T ko={t.label} en={t.en} />
          </Link>
        );
      })}
    </div>
  );
}

/** 모바일 하단 막대 — 자주 쓰는 4개 + 더보기(나머지 메뉴 시트) */
export function BottomNav() {
  const active = useActive();
  const path = usePathname();
  const [openAt, setOpenAt] = useState<string | null>(null); // 연 경로 — 다른 페이지로 가면 저절로 닫힘
  const open = openAt === path;
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => setOpenAt((typeof v === "function" ? v(open) : v) ? path : null);
  const moreOn = MORE.some((t) => active(t.href));
  return (
    <>
      {open && <button aria-label="닫기" className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setOpen(false)} />}
      {open && (
        <div className="fixed inset-x-0 bottom-[60px] z-40 mx-3 mb-2 rounded-2xl border border-line bg-panel p-2 shadow-2xl md:hidden">
          <div className="grid grid-cols-3 gap-1">
            {MORE.map((t) => (
              <Link key={t.href} href={t.href} className={`flex flex-col items-center gap-1 rounded-xl px-2 py-3 text-xs ${active(t.href) ? "bg-accent/20 font-bold text-accent" : "text-fg hover:bg-panel2"}`}>
                <Icon k={t.icon} /><T ko={t.label} en={t.en} />
              </Link>
            ))}
          </div>
        </div>
      )}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="메뉴">
        <div className="grid h-[60px] grid-cols-5">
          {TABS.slice(0, 4).map((t) => {
            const on = active(t.href);
            return (
              <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined}
                className={`flex flex-col items-center justify-center gap-0.5 text-[11px] ${on ? "font-bold text-accent" : "text-muted"}`}>
                <Icon k={t.icon} /><T ko={t.label} en={t.en} />
              </Link>
            );
          })}
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
            className={`flex flex-col items-center justify-center gap-0.5 text-[11px] ${open || moreOn ? "font-bold text-accent" : "text-muted"}`}>
            <Icon k="more" /><T ko="더보기" en="More" />
          </button>
        </div>
      </nav>
    </>
  );
}
