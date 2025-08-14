const $ = (sel)=>document.querySelector(sel);
const fmtNTD = new Intl.NumberFormat('zh-TW',{style:'currency',currency:'TWD',maximumFractionDigits:0});
let ITEMS=[], FILTER={q:'',crop:'',market:'',sort:'recent'};
let chart;

/* ---------- 共用：抓 index.json（資料庫） ---------- */
async function loadIndex(){
  try{
    const res = await fetch('data/index.json', {cache:'no-store'});
    if(!res.ok) throw new Error(res.status+' '+res.statusText);
    ITEMS = await res.json();
    initFilters(ITEMS);
    renderLibraryList();
    $('#hint').hidden = true;
  }catch(err){
    console.error(err);
    $('#hint').hidden = false;
    $('#hint').innerHTML = `讀取 <code>data/index.json</code> 失敗。請確認：<br>
    1) 網站已部署在 GitHub Pages（<b>不要用 file://</b>）。<br>
    2) 存在 <code>data/index.json</code> 與各品項的 <code>*.json</code>。`;
  }
}

function initFilters(items){
  const crops=[...new Set(items.map(x=>x.crop))].sort();
  const mkts =[...new Set(items.map(x=>x.market))].sort();
  $('#cropFilter').innerHTML='<option value="">全部作物</option>'+crops.map(c=>`<option>${c}</option>`).join('');
  $('#marketFilter').innerHTML='<option value="">全部市場</option>'+mkts.map(m=>`<option>${m}</option>`).join('');
  const last = items.map(x=>x.last_obs_date).sort().slice(-1)[0] || '';
  $('#buildInfo').textContent = last ? `資料更新：${last}` : '';
}

/* ---------- 資料庫清單 + 詳細 ---------- */
function renderLibraryList(){
  const kw = ($('#qLib').value||'').trim().toLowerCase();
  let rows = ITEMS.filter(it =>
    (!$('#cropFilter').value || it.crop===$('#cropFilter').value) &&
    (!$('#marketFilter').value || it.market===$('#marketFilter').value) &&
    (it.crop+it.market).toLowerCase().includes(kw)
  );
  if($('#sortBy').value==='alpha')  rows.sort((a,b)=>(a.crop+a.market).localeCompare(b.crop+b.market,'zh-TW'));
  if($('#sortBy').value==='recent') rows.sort((a,b)=>(a.last_obs_date<b.last_obs_date?1:-1));

  $('#list').innerHTML = rows.map(it=>`
    <li class="card" onclick="renderLibraryDetail('${it.id}')">
      <div class="title">${it.crop}｜${it.market}</div>
      <div class="meta">
        <span class="badge">最近：${it.last_obs_date}</span>
        <span class="badge">最新 ${fmtNTD.format(it.last_price)}</span>
      </div>
    </li>`).join('');
  $('#count').textContent = `${rows.length} 筆`;
  $('#noResult').hidden = rows.length>0;
}

async function renderLibraryDetail(id){
  const r = await fetch(`data/${id}.json`, {cache:'no-store'});
  const d = await r.json();
  // 只顯示近 30 天歷史，不顯示預測
  const hist = d.history.slice(-30);
  const title = `${d.crop}在${d.market}市場的平均交易行情`;

  renderPanel({
    title,
    tag: '資料庫',
    history: hist
  });
}

/* ---------- 即時查詢（近30天），不做預測 ---------- */

/* CORS 幫手：失敗時改用代理 */
async function fetchJSONWithCors(url){
  try{
    const r = await fetch(url, {cache:'no-store'});
    if(!r.ok) throw new Error(r.status+' '+r.statusText);
    return await r.json();
  }catch(e){
    const proxies = [
      u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
      u => `https://cors.isomorphic-git.org/${u}`
    ];
    for(const to of proxies){
      try{
        const r = await fetch(to(url), {cache:'no-store'});
        if(r.ok){ const t = await r.text(); return JSON.parse(t); }
      }catch(_){}
    }
    throw e;
  }
}

async function quickFetch30d(crop, market){
  const end = new Date();
  const start = new Date(end.getTime()-180*86400000);
  const roc = d => `${d.getFullYear()-1911}`.padStart(3,'0') + "." + `${d.getMonth()+1}`.padStart(2,'0') + "." + `${d.getDate()}`.padStart(2,'0');
  const url = `https://data.moa.gov.tw/Service/OpenData/FromM/FarmTransData.aspx?$top=1000&$skip=0&StartDate=${roc(start)}&EndDate=${roc(end)}&Market=${encodeURIComponent(market)}`;
  const raw = await fetchJSONWithCors(url);

  // 彙整「交易量加權平均價」
  const rows = raw.filter(r => r["作物名稱"]?.includes(crop) && +r["平均價"]>0 && +r["交易量"]>0);
  const map = new Map();
  for(const r of rows){
    const d = r["交易日期"].replace(/\./g,'-');
    const p = +r["平均價"], v = +r["交易量"];
    if(!map.has(d)) map.set(d,{pv:0,v:0});
    const o = map.get(d); o.pv += p*v; o.v += v;
  }
  let hist = Array.from(map.entries()).map(([date,{pv,v}])=>({date, price: pv/v, volume: v}))
                 .sort((a,b)=>a.date.localeCompare(b.date));
  // 取近 30 天
  hist = hist.slice(-30);
  if(!hist.length) throw new Error('no data');
  return {crop, market, history: hist};
}

/* ---------- 渲染：通用面板 + 圖表（強化網格色） ---------- */
function computeConfidence(history){
  // 覆蓋率：近 30 天有幾天有資料
  const coverage = Math.min(history.length,30)/30;  // 0~1
  // 穩定度：CV 越低越穩（轉換成 0~1）
  const prices = history.map(x=>x.price);
  const mean = prices.reduce((a,b)=>a+b,0)/prices.length;
  const std  = Math.sqrt(prices.map(x=>(x-mean)**2).reduce((a,b)=>a+b,0)/prices.length);
  const cv = mean>0 ? std/mean : 1;
  const stability = 1/(1+cv); // 0~1
  const score = Math.round(100*(0.6*coverage + 0.4*stability));
  return {score, coverage:Math.round(coverage*100), cv:+cv.toFixed(2)};
}

function renderPanel({title, tag, history}){
  const root = $('#detail');
  const conf = computeConfidence(history);

  root.innerHTML = `
    <div class="panel">
      <h2 style="margin:0 0 6px">${title}</h2>
      <div class="row">
        <div class="kv">資料來源：<b>${tag}</b></div>
        <div class="kv">區間：<b>${history[0].date} ~ ${history[history.length-1].date}</b></div>
        <div class="kv">可信度：<b>${conf.score}</b>（完整度 ${conf.coverage}%、穩定度指標 ${conf.cv}）</div>
      </div>
      <canvas id="priceChart" height="260"></canvas>
    </div>`;

  const labels = history.map(x=>x.date);
  const series = history.map(x=>x.price);

  const ctx = document.getElementById('priceChart').getContext('2d');
  chart && chart.destroy();
  chart = new Chart(ctx,{
    type:'line',
    data:{ labels,
      datasets:[{label:'平均交易行情（NTD/kg）', data: series, borderWidth:2, pointRadius:2}]
    },
    options:{
      responsive:true,
      scales:{
        x:{ ticks:{ color:getComputedStyle(document.documentElement).getPropertyValue('--tick') },
            grid:{ color:getComputedStyle(document.documentElement).getPropertyValue('--grid') } },
        y:{ ticks:{ color:getComputedStyle(document.documentElement).getPropertyValue('--tick') },
            grid:{ color:getComputedStyle(document.documentElement).getPropertyValue('--grid') } }
      },
      plugins:{ legend:{ labels:{ color:getComputedStyle(document.documentElement).getPropertyValue('--legend') } } }
    }
  });
}

/* ---------- 事件綁定 ---------- */
// 資料庫搜尋
$('#qLib').addEventListener('input', renderLibraryList);
$('#cropFilter').addEventListener('change', renderLibraryList);
$('#marketFilter').addEventListener('change', renderLibraryList);
$('#sortBy').addEventListener('change', renderLibraryList);

// 即時查詢
$('#quickRunBtn').addEventListener('click', async ()=>{
  const crop = ($('#quickCrop').value||'').trim();
  const market = ($('#quickMarket').value||'').trim() || '台北一';
  if(!crop){ alert('請輸入作物名稱'); return; }
  $('#detail').innerHTML = '<div class="panel">資料擷取中…</div>';
  try{
    const d = await quickFetch30d(crop, market);
    const title = `${d.crop}在${d.market}市場的平均交易行情（近 30 天）`;
    renderPanel({title, tag:'即時查詢', history:d.history});
  }catch(e){
    console.error(e);
    $('#detail').innerHTML = '<div class="panel">查無資料，請確認作物/市場名稱。</div>';
  }
});
// Enter 快捷
$('#quickCrop').addEventListener('keydown', e=>{ if(e.key==='Enter') $('#quickRunBtn').click(); });
$('#quickMarket').addEventListener('keydown', e=>{ if(e.key==='Enter') $('#quickRunBtn').click(); });

loadIndex();
