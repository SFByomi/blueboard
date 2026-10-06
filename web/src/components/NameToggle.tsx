"use client";

import { useSyncExternalStore } from "react";

const KEY = "names";
type Lang = "ko" | "en";

// 상태의 원본은 <html data-names> (CSS가 이걸로 한/영을 보임·숨김) → 그대로 구독
const read = (): Lang => (document.documentElement.getAttribute("data-names") === "en" ? "en" : "ko");
const subscribe = (cb: () => void) => {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-names"] });
  return () => mo.disconnect();
};
function setLang(l: Lang) {
  document.documentElement.setAttribute("data-names", l);
  try {
    localStorage.setItem(KEY, l);
  } catch {}
}

/** 품목·국가명 한국어/영어 전환 (브라우저에 기억) */
export function NameToggle() {
  const lang = useSyncExternalStore(subscribe, read, () => "ko" as Lang);
  return (
    <div className="flex shrink-0 rounded-lg border border-line p-0.5 text-xs" role="group" aria-label="품목명 언어">
      {(["ko", "en"] as const).map((l) => (
        <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l}
          className={`rounded-md px-2 py-1 ${lang === l ? "bg-accent/20 font-bold text-accent" : "text-muted hover:text-fg"}`}>
          {l === "ko" ? "한" : "EN"}
        </button>
      ))}
    </div>
  );
}

/** 첫 페인트 전에 저장된 선택 적용 (깜빡임 방지) — layout <head>에 인라인 */
export const NAME_INIT = `try{if(localStorage.getItem("${KEY}")==="en")document.documentElement.setAttribute("data-names","en")}catch(e){}`;
