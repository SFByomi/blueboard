import type { Metadata } from "next";
import { EconCalendar } from "@/components/EconCalendar";
import { T } from "@/components/Names";
import { econEvents } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "주요 일정", description: "미국 물가·고용·GDP·FOMC, 한국 수출입, 추적 종목 실적 발표 일정 (한국 시간)" };

export default async function CalendarPage() {
  const events = await econEvents();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold"><T ko="주요 일정" en="Calendar" /></h1>
        <p className="mt-1 text-sm text-muted">미국 물가·고용·GDP·FOMC, 무역 통계, 추적 종목 실적 발표 — 한국 시간</p>
      </div>
      {events.length ? <EconCalendar events={events} today={today} /> : <div className="card text-sm text-muted">일정 데이터가 아직 없습니다. 다음 데이터 갱신 때 채워집니다.</div>}
      <p className="text-xs leading-relaxed text-muted">
        출처: BLS(CPI·PPI·고용) · BEA(GDP·PCE·무역수지) · 연준(FOMC 성명, 회의 둘째 날 14:00 미국 동부) · Census(상품무역 속보) · 산업부·관세청(수출입) · 실적 발표일은 회사 확정일(야후),
        아직 일정을 안 낸 회사는 작년 같은 분기 발표일 기준 추정(~). 한국 1~10일·1~20일 수출은 매월 11일·21일(주말이면 월요일) 규칙 기반이라 ~ 표시. 미국 무역수지 발표일이 이 사이트의 미국 무역 데이터가 새 달로 바뀌는 날입니다.
      </p>
    </div>
  );
}
