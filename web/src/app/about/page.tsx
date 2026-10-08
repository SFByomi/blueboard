import type { Metadata } from "next";
import Link from "next/link";
import { T } from "@/components/Names";

export const metadata: Metadata = { title: "소개", description: "Investing Idea 운영자·방법론·갱신 주기·한계" };

function Sec({ ko, en, children }: { ko: string; en: string; children: React.ReactNode }) {
  return (
    <section className="card space-y-2 text-sm leading-relaxed">
      <h2 className="text-lg font-bold"><T ko={ko} en={en} /></h2>
      {children}
    </section>
  );
}

export default function About() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold"><T ko="소개" en="About" /></h1>
        <p className="mt-1 text-sm text-muted">세관 무역 데이터로 AI·반도체 공급망의 물동량을 추적해 종목 매출과 연결합니다.</p>
      </div>

      <Sec ko="운영" en="Operator">
        <p>텔레그램 채널 <a className="font-bold text-accent" href="https://t.me/buywhenitgoesup" target="_blank" rel="noreferrer">Investing Idea (@buywhenitgoesup)</a> 운영자가 개인적으로 만들고 운영합니다. 한국 투자자를 위해 미국·일본·한국 세관 통계를 모아 AI·반도체 종목에 매핑합니다.</p>
      </Sec>

      <Sec ko="방법론" en="Methodology">
        <ol className="list-decimal space-y-1.5 pl-5">
          <li><b>흐름 매핑</b> — 종목별로 생산거점·고객 구조를 근거로 품목(HS 코드) × 국가(미국은 주 단위까지) 무역 흐름을 연결합니다. 출하(수출)뿐 아니라 공장으로 들어오는 부품·원자재(생산 투입)도 추적합니다.</li>
          <li><b>매출 연관도</b> — 매일 모든 흐름을 분기 매출과 비교해 전년비 상관(무역이 0~2분기 앞설 때 중 최고)으로 등급을 매깁니다. A ≥0.7 직접 연동 · B ≥0.5 연동 · C ≥0.3 업황 참고 · D &lt;0.3 연관 약함.</li>
          <li><b>진행 분기 매출 추정</b> — A·B 흐름으로 전년비 회귀·금액 회귀와 각각의 편향 보정판, 두 계열 평균 중 백테스트(그 분기 이전 데이터만으로 예측) 오차가 가장 작은 모델을 고릅니다.</li>
          <li><b>신뢰도 (%)</b> — 최근 8~12분기를 그 분기 이전 데이터만으로 예측해 본 백테스트에서 실제 매출이 추정 ±5% 안에 들어온 비율입니다(표본이 적으면 (적중+1)÷(분기+2)로 보수적으로 깎음). 오차범위는 같은 백테스트 오차의 80% 범위.</li>
          <li><b>신뢰 / 보통 / 참고</b> — 신뢰도 70% 이상이면서 &lsquo;직전 성장률 유지&rsquo;보다 정확 · 근거 흐름 R² 0.4 이상 · 과거 범위 안 · 최근 2년 금액 단절 없음이면 &lsquo;신뢰&rsquo;, 신뢰도 50% 이상이면서 단순 추세보다 정확하면 &lsquo;보통&rsquo;, 그 밖은 &lsquo;참고&rsquo;(이유 표시).</li>
          <li><b>컨센서스 괴리</b> — 추정 ÷ 애널리스트 컨센서스 − 1. 컨센 금액은 제공처 약관상 공개하지 않고 괴리율만 보여줍니다. 괴리가 오차범위 안이면 의미 있는 차이로 보지 않습니다.</li>
          <li><b>주목 신호</b> — 신뢰 추정이면서 괴리 10% 이상(오차범위 밖)이고 실적 발표가 30일 이내일 때 표시합니다. 매수·매도 판단은 직접 하세요.</li>
          <li><b>급등 탐색</b> — 미국 수출입 전 품목(HS6)에서 최근 3개월 전년비가 큰 품목을 찾습니다. 전년 금액이 작으면 기저효과로 수백 %가 나올 수 있어 *로 표시합니다.</li>
        </ol>
      </Sec>

      <Sec ko="데이터 출처" en="Sources">
        <ul className="list-disc space-y-1 pl-5">
          <li>미국 Census Bureau 수출입(국가·주 단위), 일본 재무성 무역통계(e-Stat, 엔→달러), 한국 관세청(시군구 단위)</li>
          <li>매출: SEC EDGAR(미국), DART(한국, 부문 매출 XBRL) · 실적 발표일: Yahoo Finance</li>
          <li>가격: BLS 생산자물가·수출입 가격지수, Vast.ai GPU 매물, OpenRouter 토큰 가격</li>
        </ul>
      </Sec>

      <Sec ko="갱신 주기" en="Update cycle">
        <p>매일 오전 06:17(KST)에 자동 수집·계산 후 게시합니다. 세관 통계는 월 단위라 미국은 약 5주, 일본은 약 4주, 한국은 약 2주 늦게 공개됩니다. 가격(GPU·토큰)은 매일 쌓입니다.</p>
      </Sec>

      <Sec ko="한계" en="Limitations">
        <ul className="list-disc space-y-1 pl-5">
          <li>무역 흐름은 회사 전체가 아니라 특정 품목·경로입니다. 대만·중국 등 데이터가 없는 국가의 생산·판매는 빠집니다.</li>
          <li>HS 코드 분할·재분류, 수량 단위 변경이 실제로 자주 일어납니다. 감지되면 종목 화면에 경고를 표시합니다.</li>
          <li>여러 조합을 훑으면 우연히 높은 상관이 나올 수 있어, 생산거점·고객 근거가 있는 흐름만 씁니다. 그래도 과거 관계가 앞으로 유지된다는 보장은 없습니다.</li>
        </ul>
      </Sec>

      <Sec ko="면책" en="Disclaimer">
        <p>이 사이트의 모든 내용은 정보 제공용이며 투자 권유가 아닙니다. 데이터·추정에 오류가 있을 수 있고, 투자 판단과 결과의 책임은 투자자 본인에게 있습니다.</p>
        <p><Link href="/" className="text-accent">← 공급망 신호로</Link></p>
      </Sec>
    </div>
  );
}
