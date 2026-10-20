"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/** 영어 페이지(/en…)인지 — 레이아웃의 한국어/영어 머리·꼬리를 고르는 데 씀 */
const isEn = (p: string | null) => !!p && (p === "/en" || p.startsWith("/en/"));

export function OnlyLang({ lang, children }: { lang: "ko" | "en"; children: React.ReactNode }) {
  const en = isEn(usePathname());
  return (lang === "en") === en ? <>{children}</> : null;
}

/** <html lang> 를 영어 페이지에서 en으로 (루트 레이아웃은 경로를 몰라 ko 고정) */
export function HtmlLang() {
  const en = isEn(usePathname());
  useEffect(() => { document.documentElement.lang = en ? "en" : "ko"; }, [en]);
  return null;
}
