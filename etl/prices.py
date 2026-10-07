"""네오클라우드 업황: GPU 렌탈가(Vast.ai 마켓플레이스) + 프런티어 모델 토큰 가격(OpenRouter) 일별 스냅샷.

- 과거 이력은 소스에 없음 → 매일 수집해 쌓는다. 이력의 원본은 Supabase(etl.publish가 이 테이블만 누적 저장).
- Vast.ai: 실제 대여 가능한 온디맨드 매물의 GPU당 시간당 가격. 매물(호스트) 단위 중앙값 — GPU 수로 가중하면
  8장짜리 큰 매물 하나가 값을 좌우해서 매물마다 한 표로 센다. n은 대여 가능한 GPU 총수(공급량 참고).
  IREN·NBIS의 장기계약 단가가 아니라 '스팟 수급' 신호.
- OpenRouter: 모델별 정가(USD / 100만 토큰). ~latest 별칭으로 각 회사 최신 플래그십을 따라간다.
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
    con.commit()
    return n
