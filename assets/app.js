const $ = (sel)=>document.querySelector(sel);
const fmtNTD = new Intl.NumberFormat('zh-TW',{style:'currency',currency:'TWD',maximumFractionDigits:0});
const fmtNum = (n)=> (typeof n==='number') ? n.toFixed(2) : n;

let ITEMS=[], FILTER={q:'',crop:'',market:'',sort:'recent'};
let chart;

async function loadIndex(){
  try{
    const res = await fetch('data/index.json', {cache:'no-store'});
    if(!res.ok) throw new Error(res.status+' '+res.statusText);
    ITEMS = await res.json();
    initFilters(ITEMS);
    render();
    $('#hint').hidden = true;
  }catch(err){
    console.error(err);
    $('#hint').hidden = false;
    $('#hint').innerHTML = `讀取 <code>data/index.json</code> 失敗。請確認：<br>
    1) 已部署在 GitHub Pages（<b>不要用 file://</b>）。<br>
    2) <code>data/</code> 內有 <code>index.json</code> 與各品項的 <code>*.json</code>。`;
  }
}

function initFilters(items){
  const crops = [...new Set(items.map(x=>x.crop))].sort();
  const mkts  = [...new Set(items.map(x=>x.market))].sort();
  $('#cropFilter').innerHTML = '<option value=\"\">全部作物</option>' + crops.map(c=>`<option>${c}</option>`).join('');
  $('#marketFilter').innerHTML = '<option value=\"\">全部市場</option>' + mkts.map(m=>`<option>${m}</option>`).join('');

  const last = items.map(x=>x.last_obs_date).sort().slice(-1)[0] || '';
  $('#buildInfo').textContent = last ? `資料更新：${last}` : '';
}

function render(){
  const kw = FILTER.q.trim().toLowerCase();
  let rows = ITEMS.filter(it =>
    (!FILTER.crop || it.crop===FILTER.crop) &&
    (!FILTER.market || it.market===FILTER.market) &&
    (it.crop+it.market).toLowerCase().includes(kw)
  );

  if(FILTER.sort==='alpha') rows.sort((a,b)=> (a.crop+a.market).localeCompare(b.crop+b.market,'zh-TW'));
  if(FILTER.sort==='recent') rows.sort((a,b)=> (a.last_obs_date<b.last_obs_date?1:-1));
  if(FILTER.sort==='delta_desc') rows.sort((a,b)=> ( (b.forecast_price-b.last_price) - (a.forecast_price-a.last_price) ));
  if(FILTER.sort==='delta_asc')  rows.sort((a,b)=> ( (a.forecast_price-a.last_price) - (b.forecast_price-b.last_price) ));

  const list = $('#list');
  list.innerHTML = rows.map(it=>{
    const delta = (it.forecast_price ?? 0) - (it.last_price ?? 0);
    const dir = delta>=0 ? 'up' : 'down';
    const arrow = delta>=0 ? '▲' : '▼';
    return `<li class="card" onclick="renderDetail('${it.id}')">
      <div class="title">${it.crop} @ ${it.market}</div>
      <div class="meta">
        <span class="badge">觀測 ${it.last_obs_date}</span>
        <span class="badge">模型 ${it.best_model}</span>
      </div>
      <div class="meta" style="margin-top:4px">
        <span class="badge">最新 ${fmtNTD.format(it.last_price)}</span>
        <span class="badge ${dir}">${arrow} ${fmtNTD.format(Math.abs(delta))}</span>
        <span class="badge">D+7 ${fmtNTD.format(it.d7)}</span>
        <span class="badge">D+14 ${fmtNTD.format(it.d14)}</span>
      </div>
    </li>`;
  }).join('');

  $('#noResult').hidden = rows.length>0;
  $('#count').textContent = `${rows.length} 筆`;
}

async function renderDetail(id){
  const res = await fetch(`data/${id}.json`, {cache:'no-store'});
  const d = await res.json();

  const root = $('#detail');
  root.innerHTML = `
    <div class="panel">
      <h2 style="margin:0 0 6px">${d.crop} @ ${d.market}</h2>
      <div class="row">
        <div class="kv">最近觀測：<b>${d.last_obs_date}</b></div>
        <div class="kv">最新價格：<b>${fmtNTD.format(d.last_price)}</b></div>
        <div class="kv">預測天數：<b>${d.forecast_series?.length||1} 天</b></div>
        <div class="kv">模型：<b>${d.best_model}</b></div>
        <div class="kv">MAE：<b>${fmtNum(d.metrics.MAE)}</b>｜RMSE：<b>${fmtNum(d.metrics.RMSE)}</b></div>
      </div>
      <canvas id="priceChart" height="260"></canvas>
    </div>`;

  const labels = d.history.map(x => x.date).concat(d.forecast_series.map(x=>x.date));
  const hist = d.history.map(x => x.price).concat(d.forecast_series.map(_=>null));
  const pred = d.forecast_series.map(x=>x.price);
  const padPred = d.history.map(_ => null).concat(pred);

  const ctx = document.getElementById('priceChart').getContext('2d');
  chart && chart.destroy();
  chart = new Chart(ctx, {
    type:'line',
    data:{ labels, datasets:[
      {label:'歷史', data: hist, borderWidth:2, pointRadius:0},
      {label:'預測(14天)', data: padPred, borderWidth:2, borderDash:[6,4], pointRadius:3}
    ]},
    options:{ responsive:true, scales:{ x:{ticks:{maxTicksLimit:8}} } }
  });
}

// 綁定 UI
$('#q').addEventListener('input', e=>{ FILTER.q = e.target.value; render(); });
$('#cropFilter').addEventListener('change', e=>{ FILTER.crop = e.target.value; render(); });
$('#marketFilter').addEventListener('change', e=>{ FILTER.market = e.target.value; render(); });
$('#sortBy').addEventListener('change', e=>{ FILTER.sort = e.target.value; render(); });

// ---- Quick Forecast: 使用者臨時輸入（瀏覽器端計算，備用） ----
async function quickFetch(crop, market){
  const end = new Date(); const start = new Date(end.getTime() - 180*86400000);
  const roc = d => `${d.getFullYear()-1911}`.padStart(3,'0') + "." + `${d.getMonth()+1}`.padStart(2,'0') + "." + `${d.getDate()}`.padStart(2,'0');
  const url = `https://data.moa.gov.tw/Service/OpenData/FromM/FarmTransData.aspx?$top=1000&$skip=0&StartDate=${roc(start)}&EndDate=${roc(end)}&Market=${encodeURIComponent(market)}`;
  const raw = await fetch(url).then(r=>r.json());
  const rows = raw.filter(r=>r["作物名稱"]?.includes(crop) && +r["平均價"]>0 && +r["交易量"]>0);
  const map = new Map();
  for(const r of rows){
    const d = r["交易日期"].replace(/\./g,'-'); const p = +r["平均價"]; const v = +r["交易量"];
    if(!map.has(d)) map.set(d, {pv:0, v:0});
    const o = map.get(d); o.pv += p*v; o.v += v;
  }
  const hist = Array.from(map.entries()).map(([date,{pv,v}])=>({date, price: pv/v, volume: v})).sort((a,b)=>a.date.localeCompare(b.date));
  if(!hist.length) throw new Error("no data");

  const prices = hist.map(x=>x.price);
  const ma7 = (i)=> { const s=Math.max(0,i-6); const arr=prices.slice(s,i+1); return arr.reduce((a,b)=>a+b,0)/arr.length; };
  const n=prices.length, xs=[...Array(n).keys()], xbar=xs.reduce((a,b)=>a+b,0)/n, ybar=prices.reduce((a,b)=>a+b,0)/n;
  let num=0, den=0; for(let i=0;i<n;i++){ num += (xs[i]-xbar)*(prices[i]-ybar); den += (xs[i]-xbar)**2; }
  const slope = den? num/den : 0;
  const last = prices[prices.length-1];

  const fc = [];
  for(let h=1; h<=14; h++){
    const trend = last + slope*h;
    const base  = ma7(prices.length-1);
    fc.push({date: new Date(Date.parse(hist[hist.length-1].date)+h*86400000).toISOString().slice(0,10),
             price: +(0.5*trend + 0.5*base).toFixed(2)});
  }
  return {history: hist.slice(-120), forecast_series: fc, crop: crop+'（Quick）', market};
}

function renderQuickDetail(obj){
  const d = obj;
  const root = $('#detail');
  root.innerHTML = `
    <div class="panel">
      <h2 style="margin:0 0 6px">${d.crop} @ ${d.market}</h2>
      <div class="row">
        <div class="kv">最近觀測：<b>${d.history.slice(-1)[0].date}</b></div>
        <div class="kv">最新價格：<b>${fmtNTD.format(d.history.slice(-1)[0].price)}</b></div>
        <div class="kv">預測天數：<b>${d.forecast_series.length} 天</b></div>
        <div class="kv">模型：<b>Quick(前端)</b></div>
      </div>
      <canvas id="priceChart" height="260"></canvas>
    </div>`;

  const labels = d.history.map(x=>x.date).concat(d.forecast_series.map(x=>x.date));
  const hist = d.history.map(x=>x.price).concat(d.forecast_series.map(_=>null));
  const pred = d.history.map(_=>null).concat(d.forecast_series.map(x=>x.price));

  const ctx = document.getElementById('priceChart').getContext('2d');
  chart && chart.destroy();
  chart = new Chart(ctx, {
    type:'line',
    data:{ labels, datasets:[
      {label:'歷史', data: hist, borderWidth:2, pointRadius:0},
      {label:'預測(14天)', data: pred, borderWidth:2, borderDash:[6,4], pointRadius:3}
    ]},
    options:{ responsive:true, scales:{ x:{ticks:{maxTicksLimit:8}} } }
  });
}

$('#quickBtn').addEventListener('click', async ()=>{
  const q = ($('#q').value || '').trim();
  if(!q){ alert('請在搜尋框輸入關鍵字（如：甘藍 台北一）'); return; }
  const m = q.split(/\s+/); const crop=m[0], market=m[1]||'台北一';
  try{
    $('#detail').innerHTML = '<div class="panel">計算中…</div>';
    const r = await quickFetch(crop, market);
    renderQuickDetail(r);
  }catch(e){
    console.error(e); alert('抓不到資料，請確認作物名稱/市場是否正確（例如：甘藍 台北一）');
  }
});

$('#q').addEventListener('input', e=>{ FILTER.q = e.target.value; render(); });
$('#cropFilter').addEventListener('change', e=>{ FILTER.crop = e.target.value; render(); });
$('#marketFilter').addEventListener('change', e=>{ FILTER.market = e.target.value; render(); });
$('#sortBy').addEventListener('change', e=>{ FILTER.sort = e.target.value; render(); });

loadIndex();
