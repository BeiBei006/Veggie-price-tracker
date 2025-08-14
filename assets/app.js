const $ = (sel)=>document.querySelector(sel);
const fmtNTD = new Intl.NumberFormat('zh-TW',{style:'currency',currency:'TWD',maximumFractionDigits:0});

let ITEMS=[];          // 資料庫 index.json
let chart;
let quickReqId = 0;  // 用來識別最新的一次即時查詢請求


/* =========================
   載入資料庫（預先產生）
   ========================= */
async function loadIndex(){
  try{
    const res = await fetch('data/index.json', {cache:'no-store'});
    ITEMS = await res.json();
    initFilters(ITEMS);
    renderLibraryList();
    $('#hint').hidden = true;
  }catch(err){
    console.error(err);
    $('#hint').hidden = false;
    $('#hint').innerHTML = `讀取 <code>data/index.json</code> 失敗。請確認<br>
      1) 網站部署在 GitHub Pages（不要用 file://）。<br>
      2) <code>data</code> 內有 <code>index.json</code> 與各品項的 <code>*.json</code>。`;
  }
}

function showLoading() {
  $('#detail').innerHTML = '<div class="panel">資料擷取中…</div>';
}

function initFilters(items){
  const crops=[...new Set(items.map(x=>x.crop))].sort();
  const mkts =[...new Set(items.map(x=>x.market))].sort();
  $('#cropFilter').innerHTML='<option value="">全部作物</option>'+crops.map(c=>`<option>${c}</option>`).join('');
  $('#marketFilter').innerHTML='<option value="">全部市場</option>'+mkts.map(m=>`<option>${m}</option>`).join('');
  const last = items.map(x=>x.last_obs_date).sort().slice(-1)[0] || '';
  $('#buildInfo').textContent = last ? `資料更新：${last}` : '';
}

/* =========================
   資料庫清單 + 詳細（保留14天預測 & 全部歷史）
   ========================= */
function renderLibraryList(){
  const kw = ($('#qLib').value||'').trim().toLowerCase();
  const cropSel   = $('#cropFilter').value;
  const marketSel = $('#marketFilter').value;
  const sortBy    = $('#sortBy').value;

  let rows = ITEMS.filter(it =>
    (!cropSel   || it.crop===cropSel) &&
    (!marketSel || it.market===marketSel) &&
    (it.crop+it.market).toLowerCase().includes(kw)
  );

  if(sortBy==='alpha')  rows.sort((a,b)=>(a.crop+a.market).localeCompare(b.crop+b.market,'zh-TW'));
  if(sortBy==='recent') rows.sort((a,b)=>(a.last_obs_date<b.last_obs_date?1:-1));

  $('#list').innerHTML = rows.map(it=>`
    <li class="card" onclick="renderLibraryDetail('${it.id}')">
      <div class="title">${it.crop}｜${it.market}</div>
      <div class="meta">
        <span class="badge">最近：${it.last_obs_date}</span>
        <span class="badge">最新 ${fmtNTD.format(it.last_price)}</span>
        <span class="badge">含 14 天預測</span>
      </div>
    </li>`).join('');

  $('#count').textContent = `${rows.length} 筆`;
  $('#noResult').hidden   = rows.length>0;
}

async function renderLibraryDetail(id){
  const r  = await fetch(`data/${id}.json`, {cache:'no-store'});
  const d  = await r.json();

  const title = `${d.crop}在${d.market}市場的平均交易行情（含 14 天預測）`;

  // 完整歷史（不截斷 150 天），再接上 14 天預測
  const hist = d.history;                     // [{date, price, volume}, ...] 150 天
  const fc   = d.forecast_series || [];       // [{date, price}, ...] 14 天

  renderPanel({
    title,
    tag: '資料庫',
    history: hist,
    forecast: fc
  });
}

/* ---------- 即時查詢（近 3 個交易日） ---------- */

/* CORS 幫手：直接抓失敗就換代理重試（保留原樣） */
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

// 近 3 個「交易日」：抓近 180 天，彙整每個有成交的日期，取最後 3 天
async function quickFetch3TradingDays(crop, market){
  const end = new Date(); end.setHours(0,0,0,0);
  const start = new Date(end); start.setDate(end.getDate()-180);

  const roc = d => `${d.getFullYear()-1911}`.padStart(3,'0') + "." + `${d.getMonth()+1}`.padStart(2,'0') + "." + `${d.getDate()}`.padStart(2,'0');
  const url = `https://data.moa.gov.tw/Service/OpenData/FromM/FarmTransData.aspx?$top=1000&$skip=0&StartDate=${roc(start)}&EndDate=${roc(end)}&Market=${encodeURIComponent(market)}`;

  const raw = await fetchJSONWithCors(url);

  // 過濾同品名；把每個「交易日期」的交易量加權平均價彙整
  const rows = raw.filter(r => r["作物名稱"]?.includes(crop) && +r["平均價"]>0 && +r["交易量"]>0);
  const map = new Map(); // key: '114-08-13'（ROC-YYYY-MM-DD），value: {pv, v}
  for(const r of rows){
    const d = r["交易日期"].replace(/\./g,'-');      // e.g., 114-08-13
    const p = +r["平均價"], v = +r["交易量"];
    if(!map.has(d)) map.set(d,{pv:0,v:0});
    const o = map.get(d); o.pv += p*v; o.v += v;
  }

  // 轉為陣列並依日期排序後取最後 3 天（交易日）
  const all = Array.from(map.entries())
                   .map(([date,{pv,v}]) => ({date, price: pv/v}))
                   .sort((a,b)=> a.date.localeCompare(b.date));
  const history = all.slice(-3);

  if(!history.length) throw new Error('no data');
  return {crop, market, history};
}

/* ---------- 渲染：通用面板照舊（用現有的 renderPanel） ---------- */

// 即時查詢：按鈕事件（加請求序號 + 上鎖，避免舊請求覆寫）
$('#quickRunBtn').addEventListener('click', async ()=>{
  const crop   = ($('#quickCrop').value||'').trim();
  const market = ($('#quickMarket').value||'').trim() || '台北一';
  if(!crop){ alert('請輸入作物名稱'); return; }

  const req = ++quickReqId;           // 這次請求的序號
  $('#quickRunBtn').disabled = true;  // 上鎖避免重複點
  showLoading();                      // 立刻顯示「資料擷取中…」

  try{
    const d = await quickFetch3TradingDays(crop, market);
    if (req !== quickReqId) return;   // 已有更新的查詢在進行中，丟棄舊結果
    const title = `${d.crop}在${d.market}市場的平均交易行情（近 3 個交易日）`;
    renderPanel({title, tag:'即時查詢', history:d.history, forecast:null});
  }catch(e){
    console.error(e);
    if (req !== quickReqId) return;   // 舊請求的錯誤，不覆寫新畫面
    $('#detail').innerHTML = '<div class="panel">查無資料，請確認作物/市場名稱。</div>';
  }finally{
    if (req === quickReqId) $('#quickRunBtn').disabled = false; // 只在最新請求結束時解鎖
  }
});


// Enter 快捷維持不變
$('#quickCrop').addEventListener('keydown', e=>{ if(e.key==='Enter') $('#quickRunBtn').click(); });
$('#quickMarket').addEventListener('keydown', e=>{ if(e.key==='Enter') $('#quickRunBtn').click(); });


/* =========================
   通用：可信度 + 圖表渲染
   ========================= */
function computeConfidence(history){
  const vals = history.map(x=>x.price).filter(v=>v!=null);
  const coverage = Math.round( (vals.length / history.length) * 100 ); // 完整度 %
  let stability = 0;
  if(vals.length>=2){
    const mean = vals.reduce((a,b)=>a+b,0)/vals.length;
    const std  = Math.sqrt(vals.map(x=>(x-mean)**2).reduce((a,b)=>a+b,0)/vals.length);
    const cv   = mean>0 ? std/mean : 1;
    stability  = +(1/(1+cv)).toFixed(2); // 0~1
  }
  const score = Math.round( 100*(0.6*(coverage/100) + 0.4*stability) );
  return {score, coverage, cv: (stability? +( (1/stability -1).toFixed(2) ): null)};
}

function renderPanel({title, tag, history, forecast=null}){
  const root = $('#detail');
  const conf = computeConfidence(history);

  const startStr = history.find(x=>x.price!=null)?.date || history[0].date;
  const endStr   = [...history].reverse().find(x=>x.price!=null)?.date || history[history.length-1].date;

  root.innerHTML = `
    <div class="panel">
      <h2 style="margin:0 0 6px">${title}</h2>
      <div class="row">
        <div class="kv">資料來源：<b>${tag}</b></div>
        <div class="kv">區間：<b>${startStr} ~ ${endStr}</b></div>
        <div class="kv">可信度：<b>${conf.score}</b>（完整度 ${conf.coverage}%${conf.cv!=null ? `、穩定度指標 ${conf.cv}`:''}）</div>
      </div>
      <canvas id="priceChart" height="260"></canvas>
    </div>`;

  // 準備資料
  let labels = history.map(x=>x.date);
  let histData = history.map(x=>x.price);

  let predDataPadded = null;
  if(forecast && forecast.length){
    const pred = forecast.map(x=>x.price);
    labels = labels.concat(forecast.map(x=>x.date));
    predDataPadded = history.map(_=>null).concat(pred);  // 讓預測線接在後段
  }

  const ctx = document.getElementById('priceChart').getContext('2d');
  chart && chart.destroy();
  chart = new Chart(ctx,{
    type:'line',
    data:{
      labels,
      datasets:[
        {label:'平均交易行情（NTD/kg）', data: histData, borderWidth:2, pointRadius:2, spanGaps:true},
        ...(predDataPadded ? [{label:'14 天預測', data: predDataPadded, borderWidth:2, borderDash:[6,4], pointRadius:3}] : [])
      ]
    },
    options:{
      responsive:true,
      scales:{
        x:{ ticks:{ color:getComputedStyle(document.documentElement).getPropertyValue('--tick') },
            grid :{ color:getComputedStyle(document.documentElement).getPropertyValue('--grid') } },
        y:{ ticks:{ color:getComputedStyle(document.documentElement).getPropertyValue('--tick') },
            grid :{ color:getComputedStyle(document.documentElement).getPropertyValue('--grid') } }
      },
      plugins:{ legend:{ labels:{ color:getComputedStyle(document.documentElement).getPropertyValue('--legend') } } }
    }
  });
}

/* =========================
   事件綁定
   ========================= */
// 資料庫搜尋
$('#qLib').addEventListener('input', renderLibraryList);
$('#cropFilter').addEventListener('change', renderLibraryList);
$('#marketFilter').addEventListener('change', renderLibraryList);
$('#sortBy').addEventListener('change', renderLibraryList);

// 即時查詢（近 30 天）
$('#quickRunBtn').addEventListener('click', async ()=>{
  const crop   = ($('#quickCrop').value||'').trim();
  const market = ($('#quickMarket').value||'').trim() || '台北一';
  if(!crop){ alert('請輸入作物名稱'); return; }

  $('#detail').innerHTML = '<div class="panel">資料擷取中…</div>';
  try{
    const d = await quickFetch30d(crop, market);
    const title = `${d.crop}在${d.market}市場的平均交易行情（近 30 天）`;
    renderPanel({title, tag:'即時查詢', history:d.history, forecast:null});
  }catch(e){
    console.error(e);
    $('#detail').innerHTML = '<div class="panel">查無資料，請確認作物/市場名稱。</div>';
  }
});
$('#quickCrop').addEventListener('keydown', e=>{ if(e.key==='Enter') $('#quickRunBtn').click(); });
$('#quickMarket').addEventListener('keydown', e=>{ if(e.key==='Enter') $('#quickRunBtn').click(); });

/* 啟動 */
loadIndex();
