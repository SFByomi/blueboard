"""0단계 검증: 미국 Census 무역 흐름 ↔ 회사 분기 매출(SEC) 비교.

실행: .venv/Scripts/python verify/run.py
산출: reports/verification.md, reports/verification.json (차트용)
"""
import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from etl import census, estat, sec  # noqa: E402

C = {"TH": "5490", "MY": "5570", "CN": "5700", "JP": "5880", "TW": "5830", "WORLD": "-"}

# 흐름 정의: (id, 설명, dataset, hs, filters, 역할)
SERIES = {
    "th_transceiver": ("🇹🇭→🇺🇸 태국산 광통신장비(트랜시버 포함) 수입", "imports/hs", "8517620090", {"CTY_CODE": C["TH"]}, "회사출하"),
    "ca_laser_export": ("🇺🇸 캘리포니아 LED·레이저다이오드 수출", "exports/statehs", "854141", {"STATE": "CA", "CTY_CODE": C["WORLD"]}, "생산출하"),
    "sf_jp_wafer": ("🇯🇵→샌프란시스코 기타 화합물 웨이퍼(InP 등) 수입", "imports/hs", ["3818000090", "3818000091", "3818000095"], {"CTY_CODE": C["JP"], "DISTRICT": "28"}, "생산투입"),
    "my_ssd": ("🇲🇾→🇺🇸 말레이시아산 SSD 수입", "imports/hs", "8523510000", {"CTY_CODE": C["MY"]}, "회사출하"),
    "cn_ssd": ("🇨🇳→🇺🇸 중국산 SSD 수입", "imports/hs", "8523510000", {"CTY_CODE": C["CN"]}, "회사출하"),
    "all_ssd": ("🌐→🇺🇸 전체 SSD 수입", "imports/hs", "8523510000", {"CTY_CODE": C["WORLD"]}, "최종수요"),
}
# 일본 e-Stat 흐름: (설명, 수출입, HS9 목록, 세관 목록, 상대국코드, 역할)
JP_SERIES = {
    "jp_mem_to_my": ("🇯🇵 간사이공항·나리타 → 🇲🇾 말레이시아 메모리IC 수출", "export", ["854232100"], ["関西空港", "成田"], "50113", "생산출하"),
    "jp_mem_all": ("🇯🇵 간사이공항·나리타 메모리IC 수출 (전체 상대국)", "export", ["854232100"], ["関西空港", "成田"], None, "생산출하"),
    "jp_kure_mem": ("🇯🇵 구레(히로시마) → 메모리IC 수출", "export", ["854232100"], ["呉"], None, "생산출하"),
}

COMPANIES = {
    "LITE": ["th_transceiver", "ca_laser_export", "sf_jp_wafer"],
    "FN": ["th_transceiver"],  # Fabrinet: 태국 위탁생산 본체 — 대조군
    "COHR": ["th_transceiver", "ca_laser_export"],
    "SNDK": ["jp_mem_to_my", "jp_mem_all", "my_ssd", "all_ssd"],
    "MU": ["jp_kure_mem", "jp_mem_to_my", "my_ssd", "all_ssd"],  # 대조군: 말레이시아 SSD가 누구 물량인지 비교
}


def to_quarters(monthly: pd.DataFrame, q: pd.DataFrame) -> pd.Series:
    """월(15일 기준)이 회계분기 [start, end] 안에 들면 합산. 3개월 다 있어야 유효."""
    mid = monthly["month"].dt.to_timestamp() + pd.Timedelta(days=14)
    out = []
    for _, r in q.iterrows():
        m = monthly[(mid >= r["start"]) & (mid <= r["end"])]
        out.append(m["value_usd"].sum() if len(m) == 3 else None)
    return pd.Series(out, index=q.index, dtype="float")


def main():
    data = {k: census.fetch(ds, hs, f) for k, (_, ds, hs, f, _) in SERIES.items()}
    for k, (name, flow, hs9, offices, cty, role) in JP_SERIES.items():
        data[k] = estat.monthly_usd(flow, hs9, offices, cty)
        SERIES[k] = (name, "estat", "+".join(hs9), {}, role)
    lines = ["# 0단계 검증 리포트 — 미국 Census 무역 ↔ 분기 매출", ""]
    latest = max(d["month"].max() for d in data.values())
    lines += [f"- 무역 데이터 최신월: **{latest}**", "- 매출: SEC EDGAR 10-Q/10-K (회계분기 기준, 4분기는 연간−3개 분기)",
              "- 상관계수: 분기 합산 기준. `레벨`=금액 자체, `YoY`=전년동기비, `YoY(1Q 선행)`=무역이 한 분기 앞설 때", ""]

    js = {"series": {}, "companies": {}}
    for k, df in data.items():
        js["series"][k] = {"name": SERIES[k][0], "role": SERIES[k][4], "hs": SERIES[k][2] if isinstance(SERIES[k][2], str) else "+".join(SERIES[k][2]),
                           "month": df["month"].astype(str).tolist(), "value": df["value_usd"].tolist(),
                           "qty": df["qty"].tolist() if "qty" in df else None,
                           "unit": df["unit"].iloc[0] if "unit" in df and len(df) else None}

    for t, keys in COMPANIES.items():
        try:
            q = sec.quarterly_revenue(t)
        except Exception as e:  # noqa: BLE001
            lines += [f"## {t}", f"매출 수집 실패: {e}", ""]
            continue
        q = q[q["end"] >= "2021-01-01"].reset_index(drop=True)
        lines += [f"## {t}", f"매출 분기 {len(q)}개 ({q['end'].min():%Y-%m} ~ {q['end'].max():%Y-%m})", "",
                  "| 흐름 | 역할 | 레벨 상관 | YoY 상관 | YoY(1Q 선행) | 분기 수 |", "|---|---|---|---|---|---|"]
        comp = {"quarters": q["end"].dt.strftime("%Y-%m-%d").tolist(), "revenue": q["revenue"].tolist(), "flows": {}}
        rev_yoy = q["revenue"].pct_change(4)
        for k in keys:
            tq = to_quarters(data[k], q)
            comp["flows"][k] = tq.tolist()
            ok = tq.notna()
            lvl = q["revenue"][ok].corr(tq[ok])
            ty = tq.pct_change(4, fill_method=None)
            yy = rev_yoy.corr(ty)
            lead = rev_yoy.corr(ty.shift(1))
            f = lambda v: "-" if pd.isna(v) else f"{v:+.2f}"  # noqa: E731
            lines.append(f"| {SERIES[k][0]} | {SERIES[k][4]} | {f(lvl)} | {f(yy)} | {f(lead)} | {ok.sum()} |")
        js["companies"][t] = comp
        lines.append("")

    out = ROOT / "reports"
    out.mkdir(exist_ok=True)
    (out / "verification.md").write_text("\n".join(lines), encoding="utf-8")
    (out / "verification.json").write_text(json.dumps(js, ensure_ascii=False), encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
