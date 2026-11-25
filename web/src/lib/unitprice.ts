/** 단가를 볼 만한 시리즈(수량이 개수·kg으로 꾸준히 신고되는 것)와 수량 단위 */
export const UNIT_PRICE: Record<string, { unit: string; color: string }> = {
  jp_exp_mem_nat: { unit: "개", color: "#3b82f6" },
  kr_exp_flash: { unit: "kg", color: "#d95926" },
  kr_exp_dram: { unit: "kg", color: "#22c55e" },
  kr_exp_hbm: { unit: "kg", color: "#a78bfa" },
  us_imp_tw_dram: { unit: "개", color: "#f59e0b" },
  us_imp_all_ssd: { unit: "개", color: "#8a90ad" },
};

export type UnitSeries = { id: string; label: string; rows: { month: string; value: number; qty: number }[] };
