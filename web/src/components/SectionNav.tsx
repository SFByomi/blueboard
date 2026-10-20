"use client";

import { useEffect, useRef, useState } from "react";

/** 긴 페이지 안 섹션 바로가기 — 상단에 붙는 칩, 지금 보는 섹션 강조 (섹션 id와 scroll-mt로 헤더만큼 띄움) */
export function SectionNav({ items }: { items: { id: string; label: string }[] }) {
  const [on, setOn] = useState(items[0]?.id);
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const els = items.map((i) => document.getElementById(i.id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver((ents) => {
      const vis = ents.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (vis[0]) setOn(vis[0].target.id);
    }, { rootMargin: "-120px 0px -55% 0px" });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [items]);
  useEffect(() => { // 강조된 칩이 가로 스크롤 밖이면 보이게
    const b = bar.current?.querySelector<HTMLElement>(`[data-id="${on}"]`);
    if (b && bar.current) bar.current.scrollTo({ left: b.offsetLeft - 16, behavior: "smooth" });
  }, [on]);
  return (
    <div className="sticky top-[49px] z-20 -mx-4 border-b border-line bg-bg/95 px-4 backdrop-blur sm:top-[53px]">
      <div ref={bar} className="flex gap-1 overflow-x-auto py-2 text-sm [scrollbar-width:none]">
        {items.map((i) => (
          <a key={i.id} data-id={i.id} href={`#${i.id}`}
            className={`shrink-0 rounded-full px-3 py-1 transition ${on === i.id ? "bg-accent/20 font-bold text-accent" : "text-muted hover:text-fg"}`}>
            {i.label}
          </a>
        ))}
      </div>
    </div>
  );
}
