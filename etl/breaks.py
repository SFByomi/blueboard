"""통계 단절 자동 탐지 → alerts 테이블.

세번 재분류·신고 기준 변경은 '진짜 업황 변화'와 달리 한 달 사이에 수준이 계단식으로 바뀌고 그대로 유지된다.
- price_break : 단가(금액/수량)가 직전 6개월 중앙값 대비 ×3 이상 변했는데 수량은 ×1.5 이내 → 재분류 의심
- level_break : (수량 없는 시리즈) 금액 수준이 ×3 이상 바뀌어 유지
- gap         : 앞뒤로 값이 있는데 0/결측인 달이 2개월 이상 연속 (세관 경유 변경 등)
변화 후 수준이 최소 2개월 유지돼야 경고(일시적 급등락은 급등 탐지가 담당).
"""
import numpy as np
import pandas as pd

RATIO = 3.0
QTY_STABLE = 1.5


def _shift(before: pd.Series, after: pd.Series):
    b, a = before[before > 0].median(), after[after > 0].median()
    if not (b > 0 and a > 0):
        return None
    return a / b


def detect(df: pd.DataFrame) -> list[dict]:
    """df: [month, value_usd, qty] 월 순서. 반환: [{month, kind, detail}]"""
    df = df.sort_values("month").reset_index(drop=True)
    v = df["value_usd"].fillna(0)
    q = df["qty"] if "qty" in df and df["qty"].notna().sum() > len(df) * 0.8 else None
    out = []
    for i in range(6, len(df) - 1):
        win_b, win_a = slice(i - 6, i), slice(i, min(i + 3, len(df)))
        if win_a.stop - win_a.start < 2:
            continue
        if q is not None:
            price = v / q.replace(0, np.nan)
            pr = _shift(price.iloc[win_b], price.iloc[win_a])
            qr = _shift(q.iloc[win_b], q.iloc[win_a])
            if pr and qr and (pr >= RATIO or pr <= 1 / RATIO) and 1 / QTY_STABLE <= qr <= QTY_STABLE:
                out.append({"month": df["month"].iloc[i], "kind": "price_break",
                            "detail": f"단가 ×{pr:.2f} (수량 ×{qr:.2f}) — 세번 재분류·신고기준 변경 의심"})
        else:
            lr = _shift(v.iloc[win_b], v.iloc[win_a])
            if lr and (lr >= RATIO or lr <= 1 / RATIO):
                out.append({"month": df["month"].iloc[i], "kind": "level_break",
                            "detail": f"금액 수준 ×{lr:.2f} 계단식 변화 — 실제 변화인지 통계 변경인지 확인 필요"})
    # 연속된 달에 같은 단절이 반복 감지되면 첫 달만
    dedup, last = [], None
    for a in out:
        m = pd.Period(a["month"], freq="M")
        if not (last and last[0] == a["kind"] and (m - last[1]).n <= 3):
            dedup.append(a)
        last = (a["kind"], m)
    # 결측 구간
    zero = (v <= 0).values
    i = 0
    while i < len(zero):
        if zero[i]:
            j = i
            while j < len(zero) and zero[j]:
                j += 1
            if i > 0 and j < len(zero) and j - i >= 2:
                dedup.append({"month": df["month"].iloc[i], "kind": "gap",
                              "detail": f"{j - i}개월 연속 0 — 세관 경유·신고 지역 변경 가능성"})
            i = j
        else:
            i += 1
    return dedup


def scan(con, log=print) -> int:
    con.execute("DELETE FROM alerts")
    n = 0
    for (sid,) in con.execute("SELECT id FROM series").fetchall():
        df = pd.read_sql("SELECT month, value_usd, qty FROM observations WHERE series_id=? ORDER BY month", con, params=(sid,))
        if len(df) < 9:
            continue
        for a in detect(df):
            con.execute("INSERT INTO alerts (series_id, month, kind, detail) VALUES (?,?,?,?)", (sid, a["month"], a["kind"], a["detail"]))
            n += 1
            log(f"  ⚠ {sid} {a['month']} {a['detail']}")
    return n
