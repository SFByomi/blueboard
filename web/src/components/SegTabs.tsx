"use client";

import { useState } from "react";

/** 같은 자리에서 보기를 바꾸는 탭 (차트 여러 장을 한 칸에) — 선택한 탭만 렌더 */
export function SegTabs({ tabs, initial = 0, size = "sm" }: { tabs: { key: string; label: React.ReactNode; content: React.ReactNode }[]; initial?: number; size?: "sm" | "xs" }) {
  const [i, setI] = useState(initial);
  const t = tabs[Math.min(i, tabs.length - 1)];
  return (
    <div className="min-w-0">
      <div className={`mb-3 flex gap-1 overflow-x-auto rounded-lg bg-panel2 p-1 ${size === "xs" ? "text-xs" : "text-sm"} [scrollbar-width:none]`} role="tablist">
        {tabs.map((x, k) => (
          <button key={x.key} type="button" role="tab" aria-selected={k === i} onClick={() => setI(k)}
            className={`shrink-0 rounded-md px-3 py-1 transition ${k === i ? "bg-panel font-bold text-fg shadow" : "text-muted hover:text-fg"}`}>
            {x.label}
          </button>
        ))}
      </div>
      <div key={t.key}>{t.content}</div>
    </div>
  );
}
