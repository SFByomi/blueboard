"use client";

import Link from "next/link";
import { T } from "@/components/Names";
import { usePathname } from "next/navigation";

const TABS: { href: string; label: string; en: string }[] = [
  { href: "/", label: "공급망 신호", en: "Signals" },
  { href: "/stocks", label: "종목", en: "Stocks" },
  { href: "/prices", label: "가격·지수", en: "Prices" },
  { href: "/surge", label: "급등 탐색", en: "Surge" },
  { href: "/calendar", label: "일정", en: "Calendar" },
  { href: "/about", label: "소개", en: "About" },
];

/** 상단 탭 — 현재 페이지 탭을 강조 (종목 상세 /stocks/MU 도 '종목' 탭) */
export function NavTabs({ admin, owner = false }: { admin: boolean; owner?: boolean }) {
  const path = usePathname();
  const mine = owner ? [...TABS.slice(0, -1), { href: "/credit", label: "신용 🔒", en: "Credit 🔒" }, TABS.at(-1)!] : TABS; // 본인만 보이는 탭
  const tabs = admin ? [...mine, { href: "/admin", label: "관리", en: "Admin" }] : mine;
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
