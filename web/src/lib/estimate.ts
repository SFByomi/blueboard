/** 최근 3개월 합 / 전년 같은 3개월 합 − 1 (마지막 값이 있는 달 기준) */
export function yoy3m(values: (number | null)[]) {
  const i = values.findLastIndex((v) => v != null);
  if (i < 14) return { value: null, index: i };
  const win = (k: number) => [k - 2, k - 1, k].map((j) => values[j]);
  const now = win(i), prev = win(i - 12);
  if ([...now, ...prev].some((v) => v == null) || !prev.reduce((a, b) => a! + b!, 0)) return { value: null, index: i };
  return { value: now.reduce((a, b) => a! + b!, 0)! / prev.reduce((a, b) => a! + b!, 0)! - 1, index: i };
}
// 진행 분기 매출 추정은 ETL(etl/estimates.py)이 계산해 revenue_estimates 테이블로 → queries.latestEstimates
