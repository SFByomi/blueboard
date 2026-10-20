"""네오클라우드 업황: GPU 렌탈가(Vast.ai 마켓플레이스) + 프런티어 모델 토큰 가격(OpenRouter) 일별 스냅샷.

- 과거 이력은 소스에 없음 → 매일 수집해 쌓는다. 이력의 원본은 Supabase(etl.publish가 이 테이블만 누적 저장).
- Vast.ai: 실제 대여 가능한 온디맨드 매물의 GPU당 시간당 가격. 매물(호스트) 단위 중앙값 — GPU 수로 가중하면
  8장짜리 큰 매물 하나가 값을 좌우해서 매물마다 한 표로 센다. n은 대여 가능한 GPU 총수(공급량 참고).
  IREN·NBIS의 장기계약 단가가 아니라 '스팟 수급' 신호.
- OpenRouter: 모델별 정가(USD / 100만 토큰). ~latest 별칭으로 각 회사 최신 플래그십을 따라간다.
- Nebius 스팟(선점형) 가격: NBIS가 직접 공시하는 지역별 GPU 스팟가(nebius.com/spot-prices, 공개 API). 시간 단위 이력이 최근 30일만
  제공돼 매번 30일치를 받아 하루 평균으로 덮어쓰고, 그보다 오래된 날은 Supabase에 누적된 값이 남는다.
  item = 기종, stat = avg(지역 평균) · min(가장 싼 지역) · r:<지역>(지역별), n = 지역 수.
"""
import json
from datetime import date

import requests

VAST = "https://console.vast.ai/api/v0/bundles/"
GPUS = ["A100 SXM4", "A100 PCIE", "H100 SXM", "H100 NVL", "H200", "H200 NVL", "B200", "B300"]

OPENROUTER = "https://openrouter.ai/api/v1/models"
TOKENS = {  # 표시 이름: OpenRouter 모델 ID (최신 플래그십 별칭)
    "Claude Opus": "~anthropic/claude-opus-latest",
    "Claude Fable": "~anthropic/claude-fable-latest",
    "GPT Astra": "~openai/gpt-astra-latest",
    "DeepSeek Pro": "~deepseek/deepseek-pro-latest",
}


def _quantile(xs: list[float], q: float) -> float:
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(q * len(xs)))] if q != 0.5 else (xs[(len(xs) - 1) // 2] + xs[len(xs) // 2]) / 2


def gpu_prices() -> list[tuple]:
    rows = []
    for g in GPUS:
        q = {"gpu_name": {"eq": g}, "rentable": {"eq": True}, "type": "on-demand", "limit": 1000}
        offers = requests.get(VAST, params={"q": json.dumps(q)}, timeout=60).json().get("offers", [])
        offers = [o for o in offers if o.get("num_gpus")]
        if not offers:
            continue
        per_gpu = [o["dph_total"] / o["num_gpus"] for o in offers]
        n = sum(o["num_gpus"] for o in offers)
        rows += [("gpu", g, "median", _quantile(per_gpu, 0.5), n, f"vast.ai 매물 {len(offers)}개"),
                 ("gpu", g, "p25", _quantile(per_gpu, 0.25), n, f"vast.ai 매물 {len(offers)}개")]
    return rows


NEBIUS = "https://api.nebius.cloud/billing/v1alpha1/spot-price/list-series"


def nebius_spot() -> list[tuple]:
    """→ (date, 'nebius', 기종, stat, $/GPU·h, 지역 수, detail) — 최근 30일 하루 평균 (UTC)"""
    from datetime import datetime, timedelta, timezone
    start = (datetime.now(timezone.utc) - timedelta(days=29)).strftime("%Y-%m-%dT00:00:00Z")
    r = requests.get(NEBIUS, timeout=60, params={"filters.startTime": start, "aggregation.granularity": "GRANULARITY_HOUR_1",
                                                 "aggregation.method": "METHOD_LAST_PRICE"})
    r.raise_for_status()
    by: dict[tuple[str, str], dict[str, float]] = {}  # (기종, 날짜) → 지역 → 하루 평균
    for it in r.json().get("items", []):
        gpu = it["productTitle"].replace("Preemptible", "").replace("NVIDIA®", "").replace("NVLink", "").strip()
        plat = it.get("computeInstance", {}).get("platform", "")
        region = it["region"] + ("-a" if plat.endswith("-a") else "")  # 같은 지역에 다른 플랫폼(예: B200 sxm·sxm-a)
        days: dict[str, list[float]] = {}
        for pt in it.get("points", []):
            days.setdefault(pt["timestamp"][:10], []).append(float(pt["value"]))
        for d, vs in days.items():
            by.setdefault((gpu, d), {})[region] = sum(vs) / len(vs)
    rows = []
    for (gpu, d), regs in by.items():
        cheap = min(regs, key=regs.get)
        rows += [(d, "nebius", gpu, "avg", sum(regs.values()) / len(regs), len(regs), None),
                 (d, "nebius", gpu, "min", regs[cheap], len(regs), cheap)]
        rows += [(d, "nebius", gpu, f"r:{k}", v, 1, None) for k, v in regs.items()]
    return rows


def _resolve(models: dict, alias: str) -> str:
    """~latest 별칭이 가리키는 실제 모델 — 같은 계열(예: anthropic/claude-opus-*) 중 가장 최근 모델로 추정"""
    family = alias.lstrip("~").removesuffix("-latest") + "-"
    cands = [m for i, m in models.items() if i.startswith(family) and ":" not in i]
    return max(cands, key=lambda m: m.get("created", 0))["id"] if cands else models[alias].get("name", alias)


def token_prices() -> list[tuple]:
    models = {m["id"]: m for m in requests.get(OPENROUTER, timeout=60).json()["data"]}
    rows = []
    for name, mid in TOKENS.items():
        m = models.get(mid)
        if not m:
            continue
        p = m["pricing"]
        detail = _resolve(models, mid)
        rows += [("token", name, "input", float(p["prompt"]) * 1e6, None, detail),
                 ("token", name, "output", float(p["completion"]) * 1e6, None, detail)]
    return rows


def collect(con, log=print, day: str | None = None) -> int:
    day = day or date.today().isoformat()
    n = 0
    for label, fn in (("GPU 렌탈가", gpu_prices), ("토큰 가격", token_prices)):
        try:
            rows = fn()
        except Exception as e:  # noqa: BLE001 — 가격 소스 장애가 전체 빌드를 막지 않게
            log(f"  ✗ {label}: {e}")
            continue
        con.executemany("INSERT OR REPLACE INTO price_snapshots (date, kind, item, stat, value, n, detail) VALUES (?,?,?,?,?,?,?)",
                        [(day, *r) for r in rows])
        log(f"  ✓ {label}: {len(rows) // 2}개")
        n += len(rows)
    try:  # Nebius는 날짜를 스스로 가짐(30일 백필)
        rows = nebius_spot()
        con.executemany("INSERT OR REPLACE INTO price_snapshots (date, kind, item, stat, value, n, detail) VALUES (?,?,?,?,?,?,?)", rows)
        log(f"  ✓ Nebius 스팟: {len({r[2] for r in rows})}기종 · {len({r[0] for r in rows})}일")
        n += len(rows)
    except Exception as e:  # noqa: BLE001
        log(f"  ✗ Nebius 스팟: {e}")
    con.commit()
    return n
