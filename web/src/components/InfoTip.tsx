"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** ⓘ 버튼 — 누르면(데스크톱은 올려도) 설명이 뜨는 작은 창. 화면 가장자리에 붙지 않게 위치를 맞춤.
 *  방법론·정의처럼 '궁금할 때만 보는' 글을 본문에서 빼는 용도 */
export function InfoTip({ children, label = "설명 보기", wide = false }: { children: React.ReactNode; label?: string; wide?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const hover = useRef(false);

  useLayoutEffect(() => {
    if (!open || !btn.current || !box.current) return;
    const r = btn.current.getBoundingClientRect(), w = box.current.offsetWidth, h = box.current.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), vw - w - 8);
    const top = r.bottom + 6 + h > vh - 8 && r.top - 6 - h > 8 ? r.top - 6 - h : r.bottom + 6;
    setPos({ left, top });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.type === "keydown" && (e as KeyboardEvent).key !== "Escape") return;
      if (e.type === "pointerdown" && (box.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node))) return;
      setOpen(false);
    };
    const opts = { capture: true, passive: true };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", close);
    window.addEventListener("scroll", close, opts);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", close);
      window.removeEventListener("scroll", close, opts);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btn} type="button" aria-label={label} aria-expanded={open}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
        onPointerEnter={(e) => { if (e.pointerType === "mouse") { hover.current = true; setOpen(true); } }}
        onPointerLeave={(e) => { if (e.pointerType === "mouse" && hover.current) { hover.current = false; setTimeout(() => !hover.current && setOpen(false), 120); } }}
        className={`inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border align-middle font-serif text-[11px] font-bold italic leading-none transition ${open ? "border-accent bg-accent/20 text-accent" : "border-line text-muted hover:border-accent hover:text-accent"}`}
      >
        i
      </button>
      {open && (
        <div
          ref={box} role="tooltip"
          onPointerEnter={() => { hover.current = true; }}
          onPointerLeave={(e) => { if (e.pointerType === "mouse") { hover.current = false; setOpen(false); } }}
          style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
          className={`fixed z-50 ${wide ? "w-[26rem]" : "w-72"} max-w-[calc(100vw-16px)] space-y-1.5 rounded-xl border border-line bg-panel2 p-3 text-left text-xs font-normal not-italic leading-relaxed text-[#c9cde3] shadow-2xl shadow-black/50`}
        >
          {children}
        </div>
      )}
    </>
  );
}
