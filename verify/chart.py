"""reports/verification.json → reports/verification.html (실데이터 차트, 단일 파일)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
data = (ROOT / "reports" / "verification.json").read_text(encoding="utf-8")

HTML = """<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>0단계 검증 차트</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/echarts/5.5.0/echarts.min.js"></script>
<style>
body{margin:0;background:#0b0e1c;color:#e6e8f2;font-family:'Noto Sans KR',system-ui,sans-serif}
.wrap{max-width:1200px;margin:0 auto;padding:20px 16px}
.card{background:#141830;border:1px solid #272d4d;border-radius:14px;padding:16px;margin-bottom:16px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:0 0 4px}.m{color:#8a90ad;font-size:12px;margin-bottom:10px}
.c{height:340px}
</style></head><body><div class="wrap">
<h1>0단계 검증 — 미국 Census 무역 vs 분기 매출 (실데이터)</h1>
<div class="m">막대 = 회사 분기 매출(SEC, USD M) · 선 = 같은 회계분기에 합산한 무역 금액(USD M, 우축). 출처: U.S. Census Bureau, SEC EDGAR</div>
<div id="root"></div>
<div class="card"><h2>월별 원시 시계열</h2><div class="m">흐름별 월 금액 (USD M)</div><div class="c" id="raw" style="height:420px"></div></div>
</div><script>
const D=__DATA__;
const ax={axisLine:{lineStyle:{color:'#3a4166'}},axisLabel:{color:'#8a90ad',fontSize:11},splitLine:{lineStyle:{color:'#1f2442'}}};
const COL=['#22d3ee','#f59e0b','#a78bfa','#f472b6'];
const M=v=>v==null?null:+(v/1e6).toFixed(1);
const base={backgroundColor:'transparent',tooltip:{trigger:'axis',backgroundColor:'#1a1f3a',borderColor:'#2c3358',textStyle:{color:'#e6e8f2',fontSize:12}},
  legend:{bottom:0,textStyle:{color:'#aab0cc',fontSize:11}},grid:{left:60,right:60,top:20,bottom:90}};
const root=document.getElementById('root'),charts=[];
for(const [t,c] of Object.entries(D.companies)){
  const el=document.createElement('div');el.className='card';
  el.innerHTML=`<h2>${t}</h2><div class="m">회계분기 종료일 기준</div><div class="c"></div>`;root.appendChild(el);
  const ch=echarts.init(el.querySelector('.c'));charts.push(ch);
  ch.setOption({...base,xAxis:{type:'category',data:c.quarters,...ax,splitLine:{show:false}},
    yAxis:[{type:'value',name:'매출',nameTextStyle:{color:'#8a90ad'},...ax},{type:Object.keys(c.flows).length>1?'log':'value',name:Object.keys(c.flows).length>1?'무역(로그)':'무역',nameTextStyle:{color:'#8a90ad'},...ax,splitLine:{show:false}}],
    series:[{name:'분기 매출',type:'bar',barMaxWidth:18,itemStyle:{color:'#3b82f6'},data:c.revenue.map(M)},
      ...Object.entries(c.flows).map(([k,v],i)=>({name:D.series[k].name,type:'line',yAxisIndex:1,symbolSize:5,lineStyle:{width:2,color:COL[i]},itemStyle:{color:COL[i]},data:v.map(M)}))]});
}
const raw=echarts.init(document.getElementById('raw'));charts.push(raw);
const months=[...new Set(Object.values(D.series).flatMap(s=>s.month))].sort();
raw.setOption({...base,xAxis:{type:'category',data:months,...ax,splitLine:{show:false}},yAxis:{type:'value',...ax},
  series:Object.values(D.series).map(s=>{const m=Object.fromEntries(s.month.map((x,i)=>[x,s.value[i]]));
    return{name:s.name,type:'line',symbol:'none',data:months.map(x=>M(m[x]))}})});
addEventListener('resize',()=>charts.forEach(c=>c.resize()));
</script></body></html>"""

(ROOT / "reports" / "verification.html").write_text(HTML.replace("__DATA__", data), encoding="utf-8")
print("reports/verification.html")
