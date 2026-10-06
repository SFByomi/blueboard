---
name: add-stock
description: 새 종목을 공급망 추적 방식으로 추가한다 — 생산거점 조사, HS코드·무역 흐름 탐색, 매출 상관 검증, curation.json 등록. "종목 추가", "XX 매핑해줘", "공급망 데이터 붙여줘" 요청 시 사용.
---

# 종목 추가 절차 (공급망 추적)

원칙: 수요 이야기가 아니라 **실제 출하**를 본다. 회사 말보다 한 단계 아래 — 어느 공장에서 만들고, 그 지역 수출이 늘고, 미국으로 실제 들어오는지.

## 1. 생산거점 조사
- 10-K "Properties"·"Manufacturing" 절, 실적 콜, 위탁생산사(EMS) 공시로 공장 위치·생산품목 파악
- 위탁생산이면 위탁사 거점이 곧 회사 거점 (예: LITE → Fabrinet 태국)
- 결과는 companies.sites (`[{"name","country","what"}]`)

## 2. 흐름 후보 찾기 (공급망 단계 = 매핑 role)
| 단계 | role | 예 |
|---|---|---|
| ① 부품 조달 | 생산투입 | 공장 지역으로 들어가는 부품 수입, 재공품 선행 |
| ② 생산거점 출하 | 생산출하 | 공장 지역(일본 세관·한국 시군구·미국 주)의 수출 |
| ③ 고객향 반입 | 회사출하 | 미국 수입 — 생산국 × HS10 (× 세관구역 DISTRICT) |
| ④ 수요·업황 | 최종수요 | 업계 전체 수입 (회사 물량 아님) |
| ⑤ 가격·경쟁사 | 가격벤치마크 | 경쟁사 흐름·단가 사이클 |

- HS10 품목 설명 검색: Census API `get=I_COMMODITY,I_COMMODITY_LDESC,GEN_VAL_MO&COMM_LVL=HS10&I_COMMODITY=8471*&time=2026-06`
- 국가코드(CTY_CODE): 멕시코 2010, 캐나다 1220, 중국 5700, 대만 5830, 한국 5800, 일본 5880, 태국 5490, 말레이시아 5570, 베트남 5520, 싱가포르 5590, 필리핀 5650, 인도 5330
- 회사 비중이 큰 좁은 흐름(국가×HS10×세관)일수록 좋다. 업계 합산이면 role=최종수요·합산 제외
- **후보 자동 탐색**: 품목만 정하면 상대국(또는 미국 주) 전부를 한 번에 훑어 매출 상관 순으로 보여준다
  ```bash
  .venv/bin/python -m etl.discover TICKER --sec TICKER --hs 847150 847170          # 미국 수입 × 상대국
  .venv/bin/python -m etl.discover TICKER --sec TICKER --hs 902780+902789 --state CA  # 주 수출 × 상대국 (+는 분할 세번 합산)
  .venv/bin/python -m etl.discover TICKER --hs 850132 --by state [--cty 5800]     # 주별 수출
  ```
  결과 상위는 우연일 수 있다(수십 조합 중 최고). 생산거점·고객 구조로 설명되는 흐름만 3단계로 가져간다.

## 3. 검증 — 반드시 숫자로
```bash
.venv/bin/python -m etl.check TICKER --sec TICKER \
  --probe census '{"dataset":"imports/hs","hs":"8471500150","filters":{"CTY_CODE":"2010"}}'
```
- 출력: 등급, 표본, 금액 상관, 전년비 상관(무역 0·+1·+2분기 선행), 최근 8분기 (정의: etl/scores.py)
- **A(≥0.7)·B(≥0.5)** → 회사출하/생산출하, include_in_total 후보
- **C(0.3~0.5)** → 업황 프록시(합산 제외)
- **D** → 근거(rationale)에 그 사실을 적고 신뢰도 낮음, 또는 매핑하지 않음
- 금액 상관만 높고 전년비가 낮으면 같은 추세일 뿐 — 연동 아님. 최근 8분기가 급락하면 관계가 깨지는 중
- 등록 후에는 빌드마다 `flow_scores`로 자동 재채점 → 종목 페이지 '매출 연관도'·종목 목록 '연관도' 배지
- HS 세번 분할·재분류가 흔하다: 끊긴 시계열은 `"hs": [옛 코드, 새 코드]` 리스트 합산

## 4. 등록 (data/curation.json — git이 원본)
- companies: ticker, name, name_ko, market, sector, grp(GROUPS 중 하나), thesis, sec_ticker, fy_note, sort, sites
- series: id(`us_imp_<국가>_<품목>` 식), label, source, reporter, flow, region, hs, partner, spec(JSON 문자열)
- mappings: ticker, series_id, role, confidence(높음/중간/낮음), rationale(검증 수치 포함), caveat, include_in_total, sort
- hs_tags: 급등 탐지 연결용 HS6 앞자리
- 로컬 관리 페이지(/admin)로 넣어도 되고 json을 직접 고쳐도 된다. json 직접 수정 시 왕복 확인:
  `curation.load → curation.export` 결과가 바이트 동일해야 함 (키 순서·LF)

## 5. 반영
- `python -m etl.build` → 로컬 사이트에서 종목 페이지 확인 → commit·push → main 머지 시 Actions가 수집·게시

## 새 데이터 소스(나라)를 붙일 때
etl/sources.py 의 FETCHERS에 등록 (대만 재정부·홍콩·중국 해관 등). 시리즈 spec만 맞추면 위 절차 그대로.
