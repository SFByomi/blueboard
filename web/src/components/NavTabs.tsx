"use client";

import Link from "next/link";
import { T } from "@/components/Names";
import { usePathname } from "next/navigation";

const TABS: { href: string; label: string; en: string }[] = [
  { href: "/", label: "공급망 신호", en: "Signals" },
  { href: "/stocks", label: "종목", en: "Stocks" },
  { href: "/prices", label: "가격·지수", en: "Prices" },
  { href: "/surge", label: "급등 탐색", en: "Surge" },
  { href: "/about", label: "소개", en: "About" },
];

/** 상단 탭 — 현재 페이지 탭을 강조 (종목 상세 /stocks/MU 도 '종목' 탭) */
export function NavTabs({ admin }: { admin: boolean }) {
  const path = usePathname();
  const tabs = admin ? [...TABS, { href: "/admin", label: "관리", en: "Admin" }] : TABS;
  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  return (
    <>
      {tabs.map((t) => {
        const on = active(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={`shrink-0 rounded-lg px-3 py-1.5 transition ${
              on ? "bg-accent/20 font-bold text-accent" : "text-muted hover:bg-panel2 hover:text-fg"
            }`}
          >
            <T ko={t.label} en={t.en} />
          </Link>
        );
      })}
    </>
  );
}
