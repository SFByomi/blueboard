import { ctyKo } from "@/lib/format";

/** 품목명 한/영 — 둘 다 렌더하고 html[data-names]로 하나만 보임 (정적 렌더·ISR 유지, 전환은 NameToggle) */
export function HsName({ ko, en, hs }: { ko: string | null; en: string | null; hs?: string }) {
  const k = ko ?? en ?? hs ?? "";
  const e = en ?? ko ?? hs ?? "";
  if (k === e) return <>{k}</>;
  return (
    <>
      <span className="nm-ko">{k}</span>
      <span className="nm-en">{e}</span>
    </>
  );
}

/** Census 국가명(영문 대문자) → 한/영 */
export function CtyName({ name }: { name: string | null }) {
  return <HsName ko={ctyKo(name)} en={name} />;
}

/** UI 문구 한/영 (탭·제목·표 머리) — 토글은 품목명과 같은 html[data-names] */
export function T({ ko, en }: { ko: string; en: string }) {
  return <HsName ko={ko} en={en} />;
}
