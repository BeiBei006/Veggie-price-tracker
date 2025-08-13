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
    1) 這個頁面已部署在 GitHub Pages / Netlify / 任何靜態主機（<b>不要直接用本機 file:// 開</b>）。<br>
    2) <code>site/data</code> 內存在 <code>index.json</code> 與各品項的 <code>*.json</code>。`;
  }
}

function initFilters(items){
  // 填入作物 / 市場下拉
  const crops = [...new Set(items.map(x=>x.crop))].sort();
  const mkts  = [...new Set(items.map(x=>x.market))].sort();
  $('#cropFilter').innerHTML = '<option value=\"\">全部作物</option>' + crops.map(c=>`<option>${c}</option>`).join('');
  $('#marketFilter').innerHTML = '<option value=\"\">全部市場</option>' + mkts.map(m=>`<option>${m}</option>`).join('');

  // 估計資料生成資訊
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

  // 排序
  if(FILTER.sort==='alpha') rows.sort((a,b)=> (a.crop+a.market).localeCompare(b.crop+b.market,'zh-TW'));
  if(FILTER.sort==='recent') rows.sort((a,b)=> (a.last_obs_date<b.last_obs_date?1:-1));
  if(FILTER.sort==='delta_desc') rows.sort((a,b)=> ( (b.forecast_price-b.last_price) - (a.forecast_price-a.last_price) ));
  if(FILTER.sort==='delta_asc')  rows.sort((a,b)=> ( (a.forecast_price-a.last_price) - (b.forecast_price-b.last_price) ));

  // 清單
  const list = $('#list');
  list.innerHTML = rows.map(it=>{
    const delta = (it.forecast_price ?? 0) - (it.last_price ?? 0);
    const pct = (it.last_price>0) ? (delta/it.last_price*100) : 0;
    const dir = delta>=0 ? 'up' : 'down';
    const arrow = delta>=0 ? '▲' : '▼';
    return `<li class="card" onclick="renderDetail('${it.id}')">
      <div class="title">${it.crop} @ ${it.market}</div>
      <div class="meta">
        <span class="badge">觀測 ${it.last_obs_date}</span>
        <span class="badge">預測 ${it.forecast_date}</span>
        <span class="badge">模型 ${it.best_model}</span>
      </div>
      <div class="meta" style="margin-top:4px">
        <span class="badge">最新 ${fmtNTD.format(it.last_price)}</span>
        <span class="badge ${dir}">${arrow} ${fmtNTD.format(Math.abs(delta))}（${pct.toFixed(1)}%）</span>
        <span class="badge">預測 ${fmtNTD.format(it.forecast_price)}</span>
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
  const delta = d.forecast_price - d.last_price;
  const dir = delta>=0 ? 'up' : 'down';
  const arrow = delta>=0 ? '▲' : '▼';

  root.innerHTML = `
    <div class="panel">
      <h2 style="margin:0 0 6px">${d.crop} @ ${d.market}</h2>
      <div class="row">
        <div class="kv">最近觀測：<b>${d.last_obs_date}</b></div>
        <div class="kv">最新價格：<b>${fmtNTD.format(d.last_price)}</b></div>
        <div class="kv">預測日期：<b>${d.forecast_date}</b></div>
        <div class="kv">預測價格：<b>${fmtNTD.format(d.forecast_price)}</b></div>
        <div class="kv">模型：<b>${d.best_model}</b></div>
        <div class="kv">MAE：<b>${fmtNum(d.metrics.MAE)}</b>｜RMSE：<b>${fmtNum(d.metrics.RMSE)}</b></div>
        <div class="kv ${dir}">${arrow} 變動：<b>${fmtNTD.format(Math.abs(delta))}</b></div>
      </div>
      <canvas id="priceChart" height="250"></canvas>
    </div>`;

  const labels = d.history.map(x => x.date).concat([d.forecast_date]);
  const hist = d.history.map(x => x.price).concat([null]);
  const pred = d.history.map(_ => null).concat([d.forecast_price]);

  const ctx = document.getElementById('priceChart').getContext('2d');
  chart && chart.destroy();
  chart = new Chart(ctx, {
    type:'line',
    data:{
      labels,
      datasets:[
        {label:'歷史價格', data: hist, borderWidth:2, pointRadius:0},
        {label:'預測', data: pred, borderWidth:2, borderDash:[6,4], pointRadius:5}
      ]
    },
    options:{
      responsive:true,
      scales:{ x:{ticks:{maxTicksLimit:8}}, y:{beginAtZero:false} },
      plugins:{ legend:{display:true} }
    }
  });
}

// 綁定 UI
$('#q').addEventListener('input', e=>{ FILTER.q = e.target.value; render(); });
$('#cropFilter').addEventListener('change', e=>{ FILTER.crop = e.target.value; render(); });
$('#marketFilter').addEventListener('change', e=>{ FILTER.market = e.target.value; render(); });
$('#sortBy').addEventListener('change', e=>{ FILTER.sort = e.target.value; render(); });

loadIndex();
