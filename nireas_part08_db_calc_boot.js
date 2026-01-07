/* ===================== DB READER (Firestore) ===================== */
window.__dbLastSamples = window.__dbLastSamples || [];

function __dbSetStatus(msg, isErr){
  const el = document.getElementById('dbStatus');
  if(!el) return;
  el.textContent = msg;
  el.style.color = isErr ? '#b00020' : '#6b7a86';
}

function __setLoadBtnState(btnOrId, state){
  const btn = (typeof btnOrId === 'string') ? document.getElementById(btnOrId) : btnOrId;
  if(!btn) return;
  btn.classList.remove('btn-gray','btn-on','btn-warn');
  if(state === 'ok') btn.classList.add('btn-on');
  else if(state === 'warn') btn.classList.add('btn-warn');
  else btn.classList.add('btn-gray'); // idle
}

function __setFilterBtnStyle(btnOrId, enabled){
  const btn = (typeof btnOrId === 'string') ? document.getElementById(btnOrId) : btnOrId;
  if(!btn) return;
  btn.textContent = enabled ? 'Φίλτρο: ON' : 'Φίλτρο: OFF';
  btn.classList.remove('btn-gray','btn-on','btn-live-off');
  btn.classList.add(enabled ? 'btn-on' : 'btn-live-off');
}

function __dbFmt(x, digits=1){
  if(x==null || x==='' || Number.isNaN(Number(x))) return '—';
  const n = Number(x);
  return Number.isFinite(n) ? n.toFixed(digits) : String(x);
}

function __dbSafeText(x){
  const s = (x==null) ? '' : String(x);
  return s.replace(/\s+/g,' ').trim();
}

function __dbGetViewMode(){
  if(!window.__dbViewMode){
    window.__dbViewMode = localStorage.getItem('nireas_db_view') || 'basic';
  }
  return window.__dbViewMode;
}

function __dbSetViewMode(mode){
  window.__dbViewMode = (mode === 'full') ? 'full' : 'basic';
  localStorage.setItem('nireas_db_view', window.__dbViewMode);

  const btn = document.getElementById('btnDbView');
  if(btn){
    btn.textContent = (window.__dbViewMode === 'full') ? 'Προβολή: FULL' : 'Προβολή: BASIC';
  }
  const btn2 = document.getElementById('btnSeriesView');
  if(btn2){
    btn2.textContent = (window.__dbViewMode === 'full') ? 'Προβολή: FULL' : 'Προβολή: BASIC';
  }

  renderDbHead();
  renderDbRows(window.__dbLastSamples || []);

  // also refresh Monitoring table (same column mode)
  if(typeof renderSeriesHead === 'function') renderSeriesHead();
  if(typeof renderSeriesRows === 'function') renderSeriesRows(window.__seriesLastSamples || []);
}

function __dbResolveMeta(r){
  // Best-effort station meta resolution:
  // 1) fields stored in sample (stationName/url/lat/lon/elev)
  // 2) derive from stationKey (url:..., open-meteo)
  // 3) fallback to in-page STATIONS_META by URL
  const sk = (r && r.stationKey != null) ? String(r.stationKey) : '';
  let url = (r && r.stationUrl) ? String(r.stationUrl) : '';
  if(!url && sk){
    if(sk.startsWith('url:')) url = sk.slice(4);
    else if(sk === 'open-meteo') url = (typeof OPEN_METEO_TOKEN !== 'undefined') ? OPEN_METEO_TOKEN : sk;
    else url = sk;
  }

  let meta = null;
  try{
    if(url && typeof getStationMeta === 'function') meta = getStationMeta(url);
  }catch(_){}

  const name = __dbSafeText(r.stationName || r.label || meta?.name || (sk === 'open-meteo' ? 'Open‑Meteo' : sk) || '—');
  const lat  = (typeof r.lat  === 'number') ? r.lat  : (typeof meta?.lat  === 'number' ? meta.lat  : null);
  const lon  = (typeof r.lon  === 'number') ? r.lon  : (typeof meta?.lon  === 'number' ? meta.lon  : null);
  const elev = (typeof r.elev === 'number') ? r.elev : (typeof meta?.elev === 'number' ? meta.elev : null);

  return { name, url, lat, lon, elev, stationKey: sk };
}

function __dbOpenUrl(url){
  const u = __dbSafeText(url);
  if(!u) return;
  window.open(u, "_blank");
}

function __dbFocusMap(lat, lon, label){
  if(!(typeof lat === 'number') || !(typeof lon === 'number')) return;

  // Ensure map is visible
  try{
    if(typeof openMapModal === 'function') openMapModal();
  }catch(_){}

  // Pan/zoom and drop a temporary marker
  setTimeout(()=>{
    try{
      if(!window.map || !window.L) return;
      window.map.setView([lat, lon], 15, { animate:true });
      try{
        if(window.__dbFocusMarker){
          window.map.removeLayer(window.__dbFocusMarker);
          window.__dbFocusMarker = null;
        }
      }catch(_){}
      try{
        window.__dbFocusMarker = window.L.marker([lat, lon]).addTo(window.map);
        const title = __dbSafeText(label);
        if(title) window.__dbFocusMarker.bindPopup(`<b>${title}</b><br>${lat.toFixed(4)}, ${lon.toFixed(4)}`).openPopup();
      }catch(_){}
    }catch(_){}
  }, 120);
}

function __dbGetFilteredRows(){
  const rows = window.__dbLastSamples || [];
  const cols = __dbCols();
  const filters = window.__dbFilters || {};
  const enabled = (window.__dbFiltersEnabled !== false);

  if(!enabled) return rows;

  // quick check: any filter set?
  const hasAny = Object.values(filters).some(v => __dbSafeText(v));
  if(!hasAny) return rows;

  const norm = (s)=> String(s||'').toLowerCase();

  const parseNumericExpr = (expr)=>{
    const e = __dbSafeText(expr);
    if(!e) return null;
    let m = e.match(/^(-?\d+(?:\.\d+)?)\s*(?:\-|\.\.)\s*(-?\d+(?:\.\d+)?)$/);
    if(m) return {type:'range', a:Number(m[1]), b:Number(m[2])};
    m = e.match(/^(>=|<=|>|<|=)\s*(-?\d+(?:\.\d+)?)$/);
    if(m) return {type:'cmp', op:m[1], n:Number(m[2])};
    const n = Number(e);
    if(Number.isFinite(n)) return {type:'eq', n};
    return {type:'text', s:norm(e)};
  };

  const matchNumeric = (val, exprObj)=>{
    const n = Number(val);
    if(!Number.isFinite(n)) return false;
    if(!exprObj) return true;
    if(exprObj.type === 'range'){
      const lo = Math.min(exprObj.a, exprObj.b);
      const hi = Math.max(exprObj.a, exprObj.b);
      return n >= lo && n <= hi;
    }
    if(exprObj.type === 'cmp'){
      const t = exprObj.n;
      if(!Number.isFinite(t)) return false;
      if(exprObj.op === '>=') return n >= t;
      if(exprObj.op === '<=') return n <= t;
      if(exprObj.op === '>')  return n > t;
      if(exprObj.op === '<')  return n < t;
      if(exprObj.op === '=')  return n === t;
    }
    if(exprObj.type === 'eq') return n === exprObj.n;
    if(exprObj.type === 'text') return norm(n).includes(exprObj.s);
    return true;
  };

  // Pre-parse numeric expressions once
  const parsed = {};
  cols.forEach(c=>{
    const fv = __dbSafeText(filters[c.k]);
    if(!fv) return;
    if(c.filterType === 'num') parsed[c.k] = parseNumericExpr(fv);
  });

  return rows.filter(r=>{
    for(const c of cols){
      const fv = __dbSafeText(filters[c.k]);
      if(!fv) continue;
      if(c.noFilter) continue;

      if(c.filterType === 'station'){
        const meta = __dbResolveMeta(r);
        if(meta.name !== fv) return false;
        continue;
      }

      if(c.filterType === 'num'){
        const raw = (typeof c.getRaw === 'function') ? c.getRaw(r) : r[c.k];
        if(!matchNumeric(raw, parsed[c.k])) return false;
        continue;
      }

      // text
      const txt = (typeof c.getFilterText === 'function')
        ? c.getFilterText(r)
        : ((typeof c.getText === 'function') ? c.getText(r) : '');
      if(!norm(txt).includes(norm(fv))) return false;
    }
    return true;
  });
}

function __dbCols(){
  const mode = __dbGetViewMode();

  const tsGetter = (r)=> __dbSafeText(r.tsText || (r.tsMs ? new Date(r.tsMs).toLocaleString('el-GR') : r.id));
  const stationGetter = (r)=> __dbResolveMeta(r).name;

  const colsBase = [
    {k:'ts', label:'Timestamp', left:true, filterType:'text', getText:tsGetter, getFilterText:tsGetter},
    {k:'station', label:'Station', left:true, filterType:'station', getText:stationGetter, getFilterText:stationGetter},
    {
      k:'link', label:'', cls:'db-col-icon', noFilter:true,
      render:(r)=>{
        const meta = __dbResolveMeta(r);
        const btn = document.createElement('button');
        btn.className = 'db-icon-btn';
        btn.title = 'Άνοιγμα URL σταθμού';
        btn.textContent = '🔗';
        btn.onclick = (e)=>{ e.preventDefault(); e.stopPropagation(); __dbOpenUrl(meta.url); };
        return btn;
      }
    },
    {
      k:'map', label:'', cls:'db-col-icon', noFilter:true,
      render:(r)=>{
        const meta = __dbResolveMeta(r);
        const btn = document.createElement('button');
        btn.className = 'db-icon-btn';
        btn.title = 'Εστίαση στον χάρτη';
        btn.textContent = '📍';
        btn.onclick = (e)=>{ e.preventDefault(); e.stopPropagation(); __dbFocusMap(meta.lat, meta.lon, meta.name); };
        return btn;
      }
    },
    {k:'elev', label:'Elev', filterType:'num', getRaw:(r)=> (__dbResolveMeta(r).elev), getText:(r)=> {
      const e = __dbResolveMeta(r).elev;
      return (typeof e === 'number' && Number.isFinite(e)) ? String(Math.round(e)) : '—';
    }}
  ];

  const metricsBasic = [
    {k:'temp',     label:'Temp',     filterType:'num', getRaw:(r)=>r.temp,     getText:(r)=> (typeof r.temp === 'number') ? __dbFmt(r.temp,1) : '—'},
    {k:'hum',      label:'Hum',      filterType:'num', getRaw:(r)=>r.hum,      getText:(r)=> (typeof r.hum === 'number') ? __dbFmt(r.hum,0) : '—'},
    {k:'dewPoint', label:'Dew',      filterType:'num', getRaw:(r)=>r.dewPoint, getText:(r)=> (typeof r.dewPoint === 'number') ? __dbFmt(r.dewPoint,1) : '—'},
    {k:'wind',     label:'Wind', left:true, cls:'col-wind', filterType:'text', getText:(r)=> __dbSafeText(r.wind || '—')},
    {k:'baro',     label:'Baro',     filterType:'num', getRaw:(r)=>r.baro,     getText:(r)=> (typeof r.baro === 'number') ? __dbFmt(r.baro,1) : '—'},
    {k:'today',    label:"Today's",  filterType:'num', getRaw:(r)=>r.today,    getText:(r)=> (typeof r.today === 'number') ? __dbFmt(r.today,1) : '—'},
    {k:'rainRate', label:'RainRate', filterType:'num', getRaw:(r)=>r.rainRate, getText:(r)=> (typeof r.rainRate === 'number') ? __dbFmt(r.rainRate,1) : '—'},
    {k:'storm',    label:'Storm',    filterType:'num', getRaw:(r)=>r.storm,    getText:(r)=> (typeof r.storm === 'number') ? __dbFmt(r.storm,1) : '—'},
    {k:'month',    label:'Month',    filterType:'num', getRaw:(r)=>r.month,    getText:(r)=> (typeof r.month === 'number') ? __dbFmt(r.month,1) : '—'},
    {k:'year',     label:'Year',     filterType:'num', getRaw:(r)=>r.year,     getText:(r)=> (typeof r.year === 'number') ? __dbFmt(r.year,1) : '—'},
    {k:'chill',    label:'Chill',    filterType:'num', getRaw:(r)=>r.chill,    getText:(r)=> (typeof r.chill === 'number') ? __dbFmt(r.chill,1) : '—'},
    {k:'heat',     label:'Heat',     filterType:'num', getRaw:(r)=>r.heat,     getText:(r)=> (typeof r.heat === 'number') ? __dbFmt(r.heat,1) : '—'},
    {k:'dp',       label:'ΔP',       filterType:'num', getRaw:(r)=>r.dp,       getText:(r)=> (typeof r.dp === 'number') ? __dbFmt(r.dp,1) : '—'},
    {k:'total',    label:'Total',    filterType:'num', getRaw:(r)=>r.total,    getText:(r)=> (typeof r.total === 'number') ? __dbFmt(r.total,1) : '—'}
  ];

  const metricsFullExtra = [
    {k:'sunrise', label:'Sunrise', filterType:'text', getText:(r)=> __dbSafeText(r.sunrise || '—')},
    {k:'sunset',  label:'Sunset',  filterType:'text', getText:(r)=> __dbSafeText(r.sunset  || '—')}
  ];

  const cols = colsBase.concat(metricsBasic);
  if(mode === 'full') cols.push(...metricsFullExtra);
  return cols;
}

// Monitoring (Primary History) uses same column set as DB, but WITHOUT link/map icon columns
function __seriesCols(){
  return __dbCols().filter(c => c && c.k !== 'link' && c.k !== 'map');
}

function renderDbHead(){
  const hr = document.getElementById('dbHeadRow');
  const fr = document.getElementById('dbFilterRow');
  if(!hr) return;

  const cols = __dbCols();
  hr.innerHTML = '';
  if(fr) fr.innerHTML = '';

  // Header row
  cols.forEach((c, idx)=>{
    const th = document.createElement('th');
    if(idx === 0 || c.left) th.style.textAlign = 'left';
    if(c.cls) th.className = c.cls;
    th.textContent = c.label || '';
    hr.appendChild(th);
  });

  // Filter row
  if(fr){
    const enabled = (window.__dbFiltersEnabled !== false);
    fr.style.display = enabled ? '' : 'none';

    cols.forEach((c, idx)=>{
      const th = document.createElement('th');
      if(idx === 0 || c.left) th.style.textAlign = 'left';
      if(c.cls) th.className = c.cls;
      if(!enabled || c.noFilter){
        th.innerHTML = '';
      }else if(c.filterType === 'station'){
        const sel = document.createElement('select');
        sel.innerHTML = '<option value="">(όλα)</option>';
        // populate from current data
        const uniq = new Set((window.__dbLastSamples||[]).map(r=>__dbResolveMeta(r).name).filter(Boolean));
        Array.from(uniq).sort((a,b)=>a.localeCompare(b,'el')).forEach(n=>{
          const o = document.createElement('option');
          o.value = n; o.textContent = n;
          sel.appendChild(o);
        });
        sel.value = __dbSafeText((window.__dbFilters||{})[c.k]);
        sel.onchange = ()=>{
          window.__dbFilters = window.__dbFilters || {};
          window.__dbFilters[c.k] = sel.value;
          renderDbRows(window.__dbLastSamples || []);
        };
        th.appendChild(sel);
      }else{
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.placeholder = (c.filterType === 'num') ? 'π.χ. >10 ή 10-20' : 'filter…';
        inp.value = __dbSafeText((window.__dbFilters||{})[c.k]);
        inp.oninput = ()=>{
          window.__dbFilters = window.__dbFilters || {};
          window.__dbFilters[c.k] = inp.value;
          renderDbRows(window.__dbLastSamples || []);
        };
        th.appendChild(inp);
      }
      fr.appendChild(th);
    });
  }
}

function renderDbRows(rows){
  const tb = document.getElementById('dbRows');
  if(!tb) return;

  const cols = __dbCols();
  const colspan = cols.length;

  const filtered = __dbGetFilteredRows();

  if(!filtered || !filtered.length){
    tb.innerHTML = `<tr><td colspan="${colspan}" style="color:#6b7a86;font-style:italic">—</td></tr>`;
    return;
  }

  tb.innerHTML = '';
  for(const r of filtered){
    const tr = document.createElement('tr');

    cols.forEach((c, idx)=>{
      const td = document.createElement('td');
      if(idx === 0 || c.left) td.style.textAlign = 'left';
      if(c.cls) td.className = c.cls;

      if(typeof c.render === 'function'){
        const node = c.render(r);
        if(node) td.appendChild(node);
        else td.textContent = '—';
      }else{
        td.textContent = (typeof c.getText === 'function') ? c.getText(r) : '—';
      }
      tr.appendChild(td);
    });

    tb.appendChild(tr);
  }
}

/* ===================== PRIMARY HISTORY TABLE (Monitoring) ===================== */
function __seriesSetStatus(msg, isErr){
  const el = document.getElementById('seriesStatus');
  if(!el) return;
  el.textContent = msg;
  el.style.color = isErr ? '#b00020' : '#6b7a86';
}

function __setLoadBtnState(btnOrId, state){
  const btn = (typeof btnOrId === 'string') ? document.getElementById(btnOrId) : btnOrId;
  if(!btn) return;
  btn.classList.remove('btn-gray','btn-on','btn-warn');
  if(state === 'ok') btn.classList.add('btn-on');
  else if(state === 'warn') btn.classList.add('btn-warn');
  else btn.classList.add('btn-gray'); // idle
}

function __setFilterBtnStyle(btnOrId, enabled){
  const btn = (typeof btnOrId === 'string') ? document.getElementById(btnOrId) : btnOrId;
  if(!btn) return;
  btn.textContent = enabled ? 'Φίλτρο: ON' : 'Φίλτρο: OFF';
  btn.classList.remove('btn-gray','btn-on','btn-live-off');
  btn.classList.add(enabled ? 'btn-on' : 'btn-live-off');
}

function __seriesBuildRowsFromBuffer(){
  const key = (typeof currentStationKey !== 'undefined' && currentStationKey) ? currentStationKey : 'open-meteo';
  const series = (typeof stationSeriesByKey !== 'undefined' && stationSeriesByKey[key]) ? stationSeriesByKey[key] : (window.stationSeries || []);
  const out = (series || []).map(s=>{
    const tsMs = (typeof s.tsMs === 'number') ? s.tsMs : ((typeof s.dateMs === 'number') ? s.dateMs : null);
    return {
      id: s.key,
      sampleKey: s.key,

      tsMs,
      tsText: s.tsText || (tsMs ? new Date(tsMs).toLocaleString('el-GR') : null),

      stationKey: key,
      stationName: s.stationName || s.label || null,

      rainRate: (typeof s.rainRate === 'number') ? s.rainRate : ((typeof s.val === 'number') ? s.val : null),
      dp: (typeof s.dp === 'number') ? s.dp : null,
      total: (typeof s.total === 'number') ? s.total : null,
      totalSrc: s.totalSrc || null,

      temp: (typeof s.temp === 'number') ? s.temp : null,
      hum: (typeof s.hum === 'number') ? s.hum : null,
      dewPoint: (typeof s.dewPoint === 'number') ? s.dewPoint : null,
      wind: (typeof s.wind === 'string' && s.wind.trim()) ? s.wind : null,
      baro: (typeof s.baro === 'number') ? s.baro : null,

      today: (typeof s.today === 'number') ? s.today : null,
      storm: (typeof s.storm === 'number') ? s.storm : null,
      month: (typeof s.month === 'number') ? s.month : null,
      year:  (typeof s.year  === 'number') ? s.year  : null,

      chill: (typeof s.chill === 'number') ? s.chill : null,
      heat:  (typeof s.heat  === 'number') ? s.heat  : null,
      sunrise: (typeof s.sunrise === 'string' && s.sunrise.trim()) ? s.sunrise : null,
      sunset:  (typeof s.sunset  === 'string' && s.sunset.trim())  ? s.sunset  : null
    };
  });

  out.sort((a,b)=> (b.tsMs||0) - (a.tsMs||0));
  window.__seriesLastSamples = out;
  return out;
}

function __seriesGetFilteredRows(){
  const rows = window.__seriesLastSamples || [];
  const cols = __seriesCols();
  const filters = window.__seriesFilters || {};
  const enabled = (window.__seriesFiltersEnabled !== false);

  if(!enabled) return rows;

  // quick check: any filter set?
  const hasAny = Object.values(filters).some(v => __dbSafeText(v));
  if(!hasAny) return rows;

  const norm = (s)=> String(s||'').toLowerCase();

  const parseNumericExpr = (expr)=>{
    const e = __dbSafeText(expr);
    if(!e) return null;
    const s = e.replace(/\s+/g,'').replace(',', '.');
    // ranges: a-b
    let m = s.match(/^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/);
    if(m) return {type:'range', a:parseFloat(m[1]), b:parseFloat(m[2])};
    // >=, <=, >, <, =
    m = s.match(/^(>=|<=|>|<|=)(-?\d+(?:\.\d+)?)$/);
    if(m) return {type:'cmp', op:m[1], x:parseFloat(m[2])};
    // plain number: treat as >=
    m = s.match(/^(-?\d+(?:\.\d+)?)$/);
    if(m) return {type:'cmp', op:'>=', x:parseFloat(m[1])};
    return {type:'text', raw: e};
  };

  const matchNumeric = (val, parsedExpr, rawText)=>{
    if(val==null || val==='' || Number.isNaN(val)) return false;
    const v = Number(val);
    if(!parsedExpr) return false;
    if(parsedExpr.type === 'range'){
      const lo = Math.min(parsedExpr.a, parsedExpr.b);
      const hi = Math.max(parsedExpr.a, parsedExpr.b);
      return v >= lo && v <= hi;
    }
    if(parsedExpr.type === 'cmp'){
      const x = parsedExpr.x;
      switch(parsedExpr.op){
        case '>':  return v > x;
        case '>=': return v >= x;
        case '<':  return v < x;
        case '<=': return v <= x;
        case '=':  return v === x;
      }
    }
    // fallback to substring match
    return norm(String(v)).includes(norm(rawText));
  };

  // Pre-parse numeric expressions once
  const parsed = {};
  cols.forEach(c=>{
    const fv = __dbSafeText(filters[c.k]);
    if(!fv) return;
    if(c.filterType === 'num') parsed[c.k] = parseNumericExpr(fv);
  });

  return rows.filter(r=>{
    for(const c of cols){
      const fv = __dbSafeText(filters[c.k]);
      if(!fv) continue;

      if(c.filterType === 'station'){
        const name = __dbResolveMeta(r).name;
        if(norm(name) !== norm(fv)) return false;
        continue;
      }

      if(c.filterType === 'num'){
        const expr = parsed[c.k];
        const val = (c.k === 'tsMs') ? r.tsMs : r[c.k];
        if(!matchNumeric(val, expr, fv)) return false;
        continue;
      }

      // text filter
      const txt = (typeof c.getFilterText === 'function') ? c.getFilterText(r)
                : (typeof c.getText === 'function') ? c.getText(r)
                : __dbSafeText(r[c.k]);
      if(!norm(txt).includes(norm(fv))) return false;
    }
    return true;
  });
}

function renderSeriesHead(){
  const hr = document.getElementById('seriesHeadRow');
  const fr = document.getElementById('seriesFilterRow');
  if(!hr) return;

  const cols = __seriesCols();
  hr.innerHTML = '';
  if(fr) fr.innerHTML = '';

  // Header row
  cols.forEach((c, idx)=>{
    const th = document.createElement('th');
    if(idx === 0 || c.left) th.style.textAlign = 'left';
    if(c.cls) th.className = c.cls;
    th.textContent = c.label || '';
    hr.appendChild(th);
  });

  // Filter row (Excel-like)
  if(fr){
    const enabled = (window.__seriesFiltersEnabled !== false);
    fr.style.display = enabled ? '' : 'none';

    cols.forEach((c, idx)=>{
      const th = document.createElement('th');
      if(idx === 0 || c.left) th.style.textAlign = 'left';
      if(c.cls) th.className = c.cls;

      if(!enabled || c.noFilter){
        th.innerHTML = '';
      }else if(c.filterType === 'station'){
        const sel = document.createElement('select');
        sel.innerHTML = '<option value="">(όλα)</option>';
        const uniq = new Set((window.__seriesLastSamples||[]).map(r=>__dbResolveMeta(r).name).filter(Boolean));
        Array.from(uniq).sort((a,b)=>a.localeCompare(b,'el-GR')).forEach(n=>{
          const o = document.createElement('option');
          o.value = n; o.textContent = n;
          sel.appendChild(o);
        });
        sel.value = __dbSafeText((window.__seriesFilters||{})[c.k]);
        sel.onchange = ()=>{
          window.__seriesFilters = window.__seriesFilters || {};
          window.__seriesFilters[c.k] = sel.value;
          renderSeriesRows(window.__seriesLastSamples || []);
        };
        th.appendChild(sel);
      }else{
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.placeholder = (c.filterType === 'num') ? 'π.χ. >10 ή 10-20' : 'filter…';
        inp.value = __dbSafeText((window.__seriesFilters||{})[c.k]);
        inp.oninput = ()=>{
          window.__seriesFilters = window.__seriesFilters || {};
          window.__seriesFilters[c.k] = inp.value;
          renderSeriesRows(window.__seriesLastSamples || []);
        };
        th.appendChild(inp);
      }

      fr.appendChild(th);
    });
  }
}

function renderSeriesRows(rows){
  const tb = document.getElementById('seriesRows');
  if(!tb) return;

  const cols = __seriesCols();
  const colspan = cols.length;

  const filtered = __seriesGetFilteredRows();

  if(!filtered || !filtered.length){
    tb.innerHTML = `<tr><td colspan="${colspan}" style="color:#6b7a86;font-style:italic">—</td></tr>`;
    return;
  }

  tb.innerHTML = '';
  for(const r of filtered){
    const tr = document.createElement('tr');
    cols.forEach((c, idx)=>{
      const td = document.createElement('td');
      if(idx === 0 || c.left) td.style.textAlign = 'left';
      if(c.cls) td.className = c.cls;
      if(typeof c.render === 'function'){
        const node = c.render(r);
        if(node) td.appendChild(node);
        else td.textContent = '—';
      }else{
        td.textContent = (typeof c.getText === 'function') ? c.getText(r) : '—';
      }
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  }
}

function __seriesMergeIncoming(incoming){
  const key = (typeof currentStationKey !== 'undefined' && currentStationKey) ? currentStationKey : 'open-meteo';
  const series = (stationSeriesByKey[key] || []);
  const existing = new Set(series.map(s=>s.key));
  let added = 0;

  (incoming||[]).forEach(s=>{
    if(!s || !s.key) return;
    if(existing.has(s.key)) return;
    existing.add(s.key);
    series.push(s);
    added++;
  });

  series.sort((a,b)=> (a.dateMs||0) - (b.dateMs||0));
  const __lim = getSeriesLimit();
  if(series.length > __lim){
    series.splice(0, series.length - __lim);
  }

  stationSeriesByKey[key] = series;
  stationLastKeyByKey[key] = series.length ? series[series.length-1].key : null;

  // update current pointers (if we are on the same context)
  stationSeries = series;
  stationLastKey = stationLastKeyByKey[key];

  return added;
}

async function loadSeriesHistoryFromDb(){
  __setLoadBtnState('btnSeriesLoad','idle');
  if(typeof window.fbFetchRecentSamples !== 'function'){
    __seriesSetStatus('Monitoring DB: δεν είναι διαθέσιμο (Firebase όχι έτοιμο)', true);
    __setLoadBtnState('btnSeriesLoad','warn');
    return;
  }

  const key = (typeof currentStationKey !== 'undefined' && currentStationKey) ? currentStationKey : 'open-meteo';
  __seriesSetStatus('Monitoring: DB φόρτωση…', false);

  try{
    const docs = await window.fbFetchRecentSamples(key, getSeriesLimit());
    const ordered = (docs||[]).slice().sort((a,b)=> (a.tsMs||0) - (b.tsMs||0));

    const incoming = ordered.map(r => ({
      key: r.sampleKey || r.id || ('t_' + (r.tsMs||Date.now())),
      tsText: r.tsText || (r.tsMs ? new Date(r.tsMs).toLocaleString('el-GR') : (r.id||'')),
      tsMs: (typeof r.tsMs === 'number') ? r.tsMs : Date.now(),

      val: (typeof r.rainRate === 'number') ? r.rainRate : null,
      rainRate: (typeof r.rainRate === 'number') ? r.rainRate : null,

      label: (r.stationName || r.label || null),
      stationName: (r.stationName || r.label || null),

      total: (typeof r.total === 'number') ? r.total : null,
      totalSrc: r.totalSrc || null,
      dp: (typeof r.dp === 'number') ? r.dp : null,
      dateMs: (typeof r.tsMs === 'number') ? r.tsMs : Date.now(),

      temp: (typeof r.temp === 'number') ? r.temp : null,
      hum: (typeof r.hum === 'number') ? r.hum : null,
      dewPoint: (typeof r.dewPoint === 'number') ? r.dewPoint : ((typeof r.dew === 'number') ? r.dew : null),
      wind: (typeof r.wind === 'string' && r.wind.trim()) ? r.wind : null,
      baro: (typeof r.baro === 'number') ? r.baro : null,

      today: (typeof r.today === 'number') ? r.today : null,
      storm: (typeof r.storm === 'number') ? r.storm : null,
      month: (typeof r.month === 'number') ? r.month : null,
      year:  (typeof r.year  === 'number') ? r.year  : null,

      chill: (typeof r.chill === 'number') ? r.chill : null,
      heat:  (typeof r.heat  === 'number') ? r.heat  : null,
      sunrise: (typeof r.sunrise === 'string' && r.sunrise.trim()) ? r.sunrise : null,
      sunset:  (typeof r.sunset  === 'string' && r.sunset.trim())  ? r.sunset  : null
    }));

    const added = __seriesMergeIncoming(incoming);
    updateStationReadouts();

    __setLoadBtnState('btnSeriesLoad', (docs && docs.length) ? 'ok' : 'warn');
    __seriesSetStatus(`Monitoring: DB OK • +${added}`, false);
  }catch(e){
    __setLoadBtnState('btnSeriesLoad','warn');
    __seriesSetStatus('Monitoring DB: ERROR • ' + (e && e.message ? e.message : String(e)), true);
  }
}

function exportSeriesCsv(){
  const all = window.__seriesLastSamples || [];
  if(!all.length){
    __seriesSetStatus('CSV: δεν υπάρχουν δεδομένα (monitoring)', true);
    return;
  }

  const rows = __seriesGetFilteredRows();

  const cols = [
    'tsMs','tsText','stationKey','stationName','stationUrl','lat','lon','elev',
    'rainRate','dp','total','totalSrc',
    'temp','hum','dewPoint','wind','baro',
    'today','storm','month','year','chill','heat','sunrise','sunset',
    'sampleKey','id'
  ];

  const escapeCsv = (v)=>{
    if(v==null) return '';
    const s = String(v);
    if(/[",\n]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
    return s;
  };

  const lines = [];
  lines.push(cols.join(','));

  rows
    .slice()
    .sort((a,b)=> (a.tsMs||0) - (b.tsMs||0))
    .forEach(r=>{
      const meta = __dbResolveMeta(r);
      const out = {
        ...r,
        stationName: meta.name,
        stationUrl: meta.url,
        lat: meta.lat,
        lon: meta.lon,
        elev: meta.elev
      };
      lines.push(cols.map(c=>escapeCsv(out[c])).join(','));
    });

  const csv = lines.join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `nireas_monitoring_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1500);

  __seriesSetStatus(`CSV: OK (${rows.length} rows)`, false);
}

function clearSeriesFiltersUI(){
  // Clear filters AND clear the visible table data (for space + clean slate)
  window.__seriesFilters = {};

  // Clear visible inputs/selects
  const fr = document.getElementById('seriesFilterRow');
  if(fr){
    fr.querySelectorAll('input').forEach(i=>{ i.value = ''; });
    fr.querySelectorAll('select').forEach(s=>{ s.value = ''; });
  }

  // Clear in-memory series for the current primary station context
  try{
    if(typeof currentStationKey !== 'undefined'){
      if(typeof stationSeriesByKey !== 'undefined'){
        stationSeriesByKey[currentStationKey] = [];
      }
      if(typeof stationLastKeyByKey !== 'undefined'){
        stationLastKeyByKey[currentStationKey] = null;
      }
      if(typeof stationSeries !== 'undefined'){
        stationSeries = [];
      }
      if(typeof stationLastKey !== 'undefined'){
        stationLastKey = null;
      }
    }
  }catch(_){}

  // Clear any cached last samples used by the renderer
  window.__seriesLastSamples = [];

  // Reset Load button visual state
  if(typeof __setLoadBtnState === 'function') __setLoadBtnState('btnSeriesLoad', 'idle');

  // Re-render as empty
  renderSeriesHead();
  renderSeriesRows([]);

  __seriesSetStatus('Monitoring: cleared', false);
}

function clearDbFiltersUI(){
  // Clear filters AND clear the visible table data
  window.__dbFilters = {};

  const fr = document.getElementById('dbFilterRow');
  if(fr){
    fr.querySelectorAll('input').forEach(i=>{ i.value = ''; });
    fr.querySelectorAll('select').forEach(s=>{ s.value = ''; });
  }

  // Clear cached DB rows currently shown
  window.__dbLastSamples = [];

  // Reset Load button visual state
  if(typeof __setLoadBtnState === 'function') __setLoadBtnState('btnDbLoad', 'idle');

  renderDbHead();
  renderDbRows([]);

  __dbSetStatus('DB: cleared', false);
}

function initSeriesReaderUI(){
  const saved = localStorage.getItem('nireas_series_filters');
  if(saved === 'off') window.__seriesFiltersEnabled = false;
  if(saved === 'on')  window.__seriesFiltersEnabled = true;

  const btnLoad = document.getElementById('btnSeriesLoad');
  const btnCsv  = document.getElementById('btnSeriesExport');
  const btnView = document.getElementById('btnSeriesView');
  const btnFilt = document.getElementById('btnSeriesFilters');
  const btnClr  = document.getElementById('btnSeriesClearFilters');

  if(btnClr){ btnClr.onclick = (e)=>{ e.preventDefault(); confirmAndClearSeriesFiltersUI(); }; }
  const inpLim  = document.getElementById('seriesLimit');

  if(btnLoad && !btnLoad.dataset.bound){
    btnLoad.dataset.bound = '1';
    btnLoad.addEventListener('click', (e)=>{ e.preventDefault(); loadSeriesHistoryFromDb(); });
  }
  if(btnCsv && !btnCsv.dataset.bound){
    btnCsv.dataset.bound = '1';
    btnCsv.addEventListener('click', (e)=>{ e.preventDefault(); exportSeriesCsv(); });
  }
  if(btnView){
    btnView.textContent = (__dbGetViewMode() === 'full') ? 'Προβολή: FULL' : 'Προβολή: BASIC';
    if(!btnView.dataset.bound){
      btnView.dataset.bound = '1';
      btnView.addEventListener('click', (e)=>{
        e.preventDefault();
        const next = (__dbGetViewMode() === 'full') ? 'basic' : 'full';
        __dbSetViewMode(next); // shared view mode across DB + Monitoring
      });
    }
  }
  if(btnFilt){
    __setFilterBtnStyle(btnFilt, (window.__seriesFiltersEnabled !== false));
    if(!btnFilt.dataset.bound){
      btnFilt.dataset.bound = '1';
      btnFilt.addEventListener('click', (e)=>{
        e.preventDefault();
        window.__seriesFiltersEnabled = !(window.__seriesFiltersEnabled !== false);
        localStorage.setItem('nireas_series_filters', (window.__seriesFiltersEnabled !== false) ? 'on' : 'off');
        __setFilterBtnStyle(btnFilt, (window.__seriesFiltersEnabled !== false));
        renderSeriesHead();
        renderSeriesRows(window.__seriesLastSamples || []);
      });
    }
  }
  // Clear handled via btnClr.onclick (single handler)

  // initial render
  try{
    __seriesBuildRowsFromBuffer();
    renderSeriesHead();
    renderSeriesRows(window.__seriesLastSamples || []);
    __seriesSetStatus(`Monitoring: ${(window.__seriesLastSamples||[]).length} δείγματα`, false);
  }catch(_e){}

  if(inpLim && !inpLim.dataset.bound){
    inpLim.dataset.bound = '1';
    const onLimChange = ()=>{
      const lim = getSeriesLimit();
      inpLim.value = lim;
      trimAllStationSeriesToLimit();
      renderStationSeriesList();
      __seriesSetStatus(`Monitoring: όριο = ${lim}`, false);
    };
    inpLim.addEventListener('change', (e)=>{ e.preventDefault(); onLimChange(); });
    inpLim.addEventListener('input',  (e)=>{ onLimChange(); });
  }

}

async function loadDbHistory(){
  __setLoadBtnState('btnDbLoad','idle');
  const name = document.getElementById('stationName')?.innerText?.trim() || '';
  const limEl = document.getElementById('dbLimit');
  const lim = Math.max(1, Math.min(500, Number(limEl?.value || 50)));

  __dbSetStatus('DB: φόρτωση…', false);

  try{
    let rows = [];
    if(window.fbFetchRecentSamplesAll){
      rows = await window.fbFetchRecentSamplesAll(lim);
      const sumEl = document.getElementById('dbSeriesSummaryName');
      if(sumEl) sumEl.textContent = '• ALL STATIONS';
    }else if(window.fbFetchRecentSamples){
      const key = (typeof currentStationKey !== 'undefined' && currentStationKey) ? currentStationKey : 'open-meteo';
      rows = await window.fbFetchRecentSamples(key, lim);
      const sname = name ? `(${name})` : '';
      const sumEl = document.getElementById('dbSeriesSummaryName');
      if(sumEl) sumEl.textContent = sname;
    }else{
      __dbSetStatus('DB: δεν είναι έτοιμο (Firestore reader missing)', true);
      __setLoadBtnState('btnDbLoad','warn');
      renderDbRows([]);
      return;
    }

    window.__dbLastSamples = rows || [];
    // ensure newest first (table feels like monitoring)
    window.__dbLastSamples.sort((a,b)=> (b.tsMs||0) - (a.tsMs||0));

    // reset station dropdown options by re-rendering head
    renderDbHead();
    renderDbRows(window.__dbLastSamples);

    __setLoadBtnState('btnDbLoad', (window.__dbLastSamples && window.__dbLastSamples.length) ? 'ok' : 'warn');
    __dbSetStatus(`DB: OK • ${window.__dbLastSamples.length} εγγραφές`, false);
  }catch(e){
    __setLoadBtnState('btnDbLoad','warn');
    const msg = (e && e.message) ? e.message : String(e);
    if(/permission|denied/i.test(msg)){
      __dbSetStatus('DB: permission-denied • χρειάζονται Firestore rules για READ', true);
    }else{
      __dbSetStatus('DB: ERROR • ' + msg, true);
    }
    window.__dbLastSamples = [];
    renderDbHead();
    renderDbRows([]);
  }
}

function importDbToHistory(){
  const rows = window.__dbLastSamples || [];
  if(!rows.length){
    __dbSetStatus('DB: δεν υπάρχουν δεδομένα (Load DB πρώτα)', true);
    return;
  }

  const key = (typeof currentStationKey !== 'undefined' && currentStationKey) ? currentStationKey : 'open-meteo';
  const stationRows = rows.filter(r => String(r.stationKey||'') === String(key));

  if(!stationRows.length){
    __dbSetStatus('DB → Ιστορικό: δεν βρέθηκαν εγγραφές για τον τρέχοντα σταθμό', true);
    return;
  }

  const ordered = stationRows.slice().sort((a,b)=> (a.tsMs||0) - (b.tsMs||0));
  const incoming = ordered.map(r => ({
    key: r.sampleKey || r.id || ('t_' + (r.tsMs||Date.now())),
    tsText: r.tsText || (r.tsMs ? new Date(r.tsMs).toLocaleString('el-GR') : (r.id||'')),
    tsMs: (typeof r.tsMs === 'number') ? r.tsMs : Date.now(),

    val: (typeof r.rainRate === 'number') ? r.rainRate : null,
    rainRate: (typeof r.rainRate === 'number') ? r.rainRate : null,

    label: (r.stationName || r.label || null),
    stationName: (r.stationName || r.label || null),

    total: (typeof r.total === 'number') ? r.total : null,
    totalSrc: r.totalSrc || null,
    dp: (typeof r.dp === 'number') ? r.dp : null,

    // extra metrics
    temp: (typeof r.temp === 'number') ? r.temp : null,
    hum: (typeof r.hum === 'number') ? r.hum : null,
    dewPoint: (typeof r.dewPoint === 'number') ? r.dewPoint : ((typeof r.dew === 'number') ? r.dew : null),
    wind: (typeof r.wind === 'string' && r.wind.trim()) ? r.wind : null,
    baro: (typeof r.baro === 'number') ? r.baro : null,

    today: (typeof r.today === 'number') ? r.today : null,
    storm: (typeof r.storm === 'number') ? r.storm : null,
    month: (typeof r.month === 'number') ? r.month : null,
    year:  (typeof r.year  === 'number') ? r.year  : null,

    chill: (typeof r.chill === 'number') ? r.chill : null,
    heat:  (typeof r.heat  === 'number') ? r.heat  : null,
    sunrise: (typeof r.sunrise === 'string' && r.sunrise.trim()) ? r.sunrise : null,
    sunset:  (typeof r.sunset  === 'string' && r.sunset.trim())  ? r.sunset  : null,

    dateMs: (typeof r.tsMs === 'number') ? r.tsMs : Date.now()
  }));

  try{
    const existing = (typeof stationSeriesByKey !== 'undefined' && stationSeriesByKey[key]) ? stationSeriesByKey[key] : [];
    const keySet = new Set(existing.map(s=>s.key));

    for(const it of incoming){
      if(!it || !it.key) continue;
      if(keySet.has(it.key)) continue;
      existing.push(it);
      keySet.add(it.key);
    }
    existing.sort((a,b)=> (a.dateMs||0) - (b.dateMs||0));
    const __lim2 = getSeriesLimit();
    if(existing.length > __lim2){
      existing.splice(0, existing.length - __lim2);
    }

    if(typeof stationSeriesByKey !== 'undefined'){
      stationSeriesByKey[key] = existing;
    }
    if(typeof stationLastKeyByKey !== 'undefined'){
      stationLastKeyByKey[key] = existing.length ? existing[existing.length-1].key : null;
    }
    if(typeof currentStationKey !== 'undefined' && key === currentStationKey){
      stationSeries = existing;
      stationLastKey = existing.length ? existing[existing.length-1].key : null;
      updateStationReadouts();
    }
    if(typeof renderStationSeries === 'function') renderStationSeries();
    __dbSetStatus(`DB → Ιστορικό: OK • +${incoming.length} (merge)`, false);
  }catch(e){
    __dbSetStatus('Import ERROR • ' + ((e&&e.message)?e.message:String(e)), true);
  }
}

function exportDbCsv(){
  const all = window.__dbLastSamples || [];
  if(!all.length){
    __dbSetStatus('CSV: δεν υπάρχουν δεδομένα (Load DB πρώτα)', true);
    return;
  }

  // Export filtered view (like Excel)
  const rows = __dbGetFilteredRows();

  const cols = [
    'tsMs','tsText','stationKey','stationName','stationUrl','lat','lon','elev',
    'rainRate','dp','total','totalSrc',
    'temp','hum','dewPoint','wind','baro',
    'today','storm','month','year','chill','heat','sunrise','sunset',
    'sampleKey','id'
  ];

  const escapeCsv = (v)=>{
    if(v==null) return '';
    const s = String(v);
    if(/[",\n]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
    return s;
  };

  const lines = [];
  lines.push(cols.join(','));

  rows
    .slice()
    .sort((a,b)=> (a.tsMs||0) - (b.tsMs||0))
    .forEach(r=>{
      const meta = __dbResolveMeta(r);
      const out = {
        ...r,
        stationName: meta.name,
        stationUrl: meta.url,
        lat: meta.lat,
        lon: meta.lon,
        elev: meta.elev
      };
      lines.push(cols.map(c=>escapeCsv(out[c])).join(','));
    });

  const csv = lines.join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `nireas_db_ALL_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1500);

  __dbSetStatus(`CSV: OK (${rows.length} rows)`, false);
}

function initDbReaderUI(){
  // Persist filter toggle
  const saved = localStorage.getItem('nireas_db_filters');
  if(saved === 'off') window.__dbFiltersEnabled = false;
  if(saved === 'on')  window.__dbFiltersEnabled = true;

  const btnLoad = document.getElementById('btnDbLoad');
  const btnImp  = document.getElementById('btnDbImport');
  const btnCsv  = document.getElementById('btnDbExport');
  const btnView = document.getElementById('btnDbView');
  const btnFilt = document.getElementById('btnDbFilters');
  const btnClr  = document.getElementById('btnDbClearFilters');

  if(btnClr){ btnClr.onclick = (e)=>{ e.preventDefault(); confirmAndClearDbFiltersUI(); }; }

  if(btnView){ btnView.textContent = (__dbGetViewMode() === 'full') ? 'Προβολή: FULL' : 'Προβολή: BASIC'; }

  if(btnLoad && !btnLoad.dataset.bound){
    btnLoad.dataset.bound = '1';
    btnLoad.addEventListener('click', (e)=>{ e.preventDefault(); loadDbHistory(); });
  }
  if(btnImp && !btnImp.dataset.bound){
    btnImp.dataset.bound = '1';
    btnImp.addEventListener('click', (e)=>{ e.preventDefault(); importDbToHistory(); });
  }
  if(btnCsv && !btnCsv.dataset.bound){
    btnCsv.dataset.bound = '1';
    btnCsv.addEventListener('click', (e)=>{ e.preventDefault(); exportDbCsv(); });
  }
  if(btnView && !btnView.dataset.bound){
    btnView.dataset.bound = '1';
    btnView.addEventListener('click', (e)=>{
      e.preventDefault();
      const next = (__dbGetViewMode() === 'full') ? 'basic' : 'full';
      __dbSetViewMode(next);
    });
  }

  if(btnFilt){
    __setFilterBtnStyle(btnFilt, (window.__dbFiltersEnabled !== false));
    if(!btnFilt.dataset.bound){
      btnFilt.dataset.bound = '1';
      btnFilt.addEventListener('click', (e)=>{
        e.preventDefault();
        window.__dbFiltersEnabled = !(window.__dbFiltersEnabled !== false);
        localStorage.setItem('nireas_db_filters', (window.__dbFiltersEnabled !== false) ? 'on' : 'off');
        __setFilterBtnStyle(btnFilt, (window.__dbFiltersEnabled !== false));
        renderDbHead();
        renderDbRows(window.__dbLastSamples || []);
      });
    }
  }

  // Clear handled via btnClr.onclick (single handler)

  // init view mode button + initial render
  __dbSetViewMode(__dbGetViewMode());
  __dbSetStatus('DB: —', false);
}
/* ===================== /DB READER ===================== */





/* ===================== CALCULATIONS (ver14-style) ===================== */
function calculateTc(L, H){
  // Guard: If Length or Height are missing/zero, return default 10 min
  if(!L || L <= 0 || !H || H <= 0) return 10;

  // Kirpich Formula (SI units): Tc = 0.0195 * (L^0.77) * S^-0.385
  // Where S = H/L
  const slope = H / L;
  // Safety check for very small slope to prevent Infinity
  if(slope < 0.00001) return 10; 

  return 0.0195 * Math.pow(L, 0.77) * Math.pow(slope, -0.385);
}

function runMasterCalculation(){
  const area   = getVal('area');
  const length = getVal('length');
  const height = getVal('height');
  const coef   = getVal('coef');

  const rainI  = getVal('rainI');
  const rainD  = getVal('rainD');

  const drains   = getVal('drains');
  const drainCap = getVal('drainCap');

  const strWidth = getVal('strWidth');
  const strZ     = getVal('strZ');
  const strDepth = getVal('strDepth');
  const strDrop  = getVal('strDrop');
  const strLen   = getVal('strLen');
  const strType  = getVal('strType');
  const strYEl   = document.getElementById('strY');

  if(!(area>0)){
    // still draw empty
    setTxt('res-slope','—');
    setTxt('res-tc','—');
    setTxt('res-qsel','—');
    setTxt('res-drains','—');
    setTxt('res-stream','—');
    setTxt('res-adequacy','—');
    document.getElementById('tableBody').innerHTML='';
    drawChannel(0);
    drawBasinPlan();
    return;
  }

  const A_km2 = area / 1e6;
  const S = (length>0 && height>0) ? (height/length) : 0.01;

  const Tc = calculateTc(length, height);
  const Dused = (rainD > 0) ? rainD : Math.max(5.0, Tc);

  const Qsel = 0.278 * coef * rainI * A_km2;

  const CapNet = drains * drainCap;

  // Stream slope
  const sLen = (strLen>0) ? strLen : (length>0 ? length : 0);
  const sDrop = (strDrop>0) ? strDrop : (height>0 ? height : 0);
  const sSlope = (sLen>0) ? (sDrop/sLen) : 0;

  // Manning trapezoid capacity + normal depth by bisection
  let CapStr = 0;
  let yCalc = 0;

  const calcQ = (d) => {
    if(!(strWidth>0) || !(sSlope>0) || !(strType>0) || d<=0) return 0;
    const A = (strWidth + strZ*d) * d;
    const P = strWidth + 2*d*Math.sqrt(1 + Math.pow(strZ,2));
    return (1/strType) * Math.pow(A, 5/3) * Math.pow(P, -2/3) * Math.sqrt(sSlope);
  };

  if(strWidth>0 && strDepth>0 && sSlope>0){
    CapStr = calcQ(strDepth);

    if(Qsel>0){
      let low=0, high=(strDepth*2)||20;
      for(let i=0;i<22;i++){
        const mid=(low+high)/2;
        if(calcQ(mid) < Qsel) low=mid;
        else high=mid;
      }
      yCalc = (low+high)/2;
    }
  }

  // Manual y logic: if user types, treat as manual until resetStrY()
  if(strYEl && strYEl.dataset.boundManual !== '1'){
    strYEl.dataset.boundManual = '1';
    strYEl.addEventListener('input', ()=>{ strYEl.dataset.manual='true'; if(typeof scheduleSaveUiState==='function') scheduleSaveUiState(); });
  }
  const isManual = strYEl?.dataset?.manual === 'true';
  const yMan = isManual ? num(strYEl.value) : 0;
  const finalY = isManual ? yMan : yCalc;

  // update y field if auto
  if(!isManual && document.activeElement !== strYEl){
    strYEl.value = (yCalc>0) ? yCalc.toFixed(2) : "";
  }

  // Stats
  setTxt('res-slope', (S*100).toFixed(1) + " %");

  // Tc display with min rule (like ver14 dual)
  const tcEl = document.getElementById('res-tc');
  if((!rainD || rainD<=0) && Tc < 5){
    tcEl.innerHTML = `<span style="color:#d35400;font-weight:900">5.0 min</span>
                      <div style="font-size:10px;color:#6b7a86">(calc: ${Tc.toFixed(2)})</div>`;
  }else{
    tcEl.textContent = Tc.toFixed(1) + " min";
  }

  setTxt('res-qsel', Qsel.toFixed(2) + " m³/s");
  setTxt('res-drains', (CapNet>0 ? CapNet.toFixed(2) : "0.00") + " m³/s");
  setTxt('res-stream', (CapStr>0 ? CapStr.toFixed(2) : "0.00") + " m³/s");

  // adequacy label
  let adq = "<span style='color:#6b7a86'>—</span>";
  if(CapNet>0 && CapStr>0) adq = "<span class='status-ok'>Διπλός έλεγχος</span>";
  else if(CapNet>0) adq = "<span class='status-fail'>Μόνο συλλογή</span>";
  else if(CapStr>0) adq = "<span class='status-fail'>Μόνο διόδευση</span>";
  else adq = "<span class='status-warn'>Χωρίς Qcap</span>";
  document.getElementById('res-adequacy').innerHTML = adq;
  // Rain: σύντομη εκτίμηση (μόνο για το σενάριο Βροχή)
  const _rainSumI = document.getElementById('rainSumI');
  if(_rainSumI){
    _rainSumI.textContent = (rainI!=null ? rainI.toFixed(1) : "—") + " mm/h";
    const _dEl = document.getElementById('rainSumDused');
    const _pEl = document.getElementById('rainSumP');
    const _qEl = document.getElementById('rainSumQpeak');
    const _rEl = document.getElementById('rainSumRisk');
    if(_dEl) _dEl.textContent = Dused.toFixed(1) + " min";
    if(_pEl) _pEl.textContent = (rainI * (Dused/60)).toFixed(1) + " mm";
    if(_qEl) _qEl.textContent = Qsel.toFixed(2) + " m³/s";

    const capMax = Math.max((CapNet||0), (CapStr||0));
    let rr = "<span style='color:#6b7a86'>—</span>";
    if(capMax>0){
      if(Qsel <= capMax*0.85) rr = "<span class='status-ok'>OK</span>";
      else if(Qsel <= capMax) rr = "<span class='status-warn'>Οριακό</span>";
      else rr = "<span class='status-fail'>Υπέρβαση</span>";
    }
    if(_rEl) _rEl.innerHTML = rr;
  }


  // Scenario table
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = "";

  const status = (Q, Cap) => {
    if(!(Cap>0)) return "<span class='status-fail' style='font-size:11px'>—</span>";
    if(Q <= Cap*0.85) return "<span class='status-ok'>OK</span>";
    if(Q <= Cap) return "<span class='status-warn'>Οριακό</span>";
    return "<span class='status-fail'>Υπέρβαση</span>";
  };

  for(let i=5;i<=200;i+=5){
    const P = i*(Dused/60);
    const Q = 0.278*coef*i*A_km2;
    const V = area*(P/1000)*coef;
    const Peq = P*coef;

    let cls="risk-safe", txt="Χαμηλή";
    if(Peq>=60){cls="risk-extreme";txt="Ακραία";}
    else if(Peq>=40){cls="risk-red";txt="Πολύ Υψηλή";}
    else if(Peq>=25){cls="risk-orange";txt="Υψηλή";}
    else if(Peq>=10){cls="risk-warn";txt="Μέτρια";}

    const tr = document.createElement('tr');
    tr.className = cls;
    tr.innerHTML = `
      <td><b>${i}</b></td>
      <td>${Dused.toFixed(1)}</td>
      <td>${P.toFixed(1)}</td>
      <td>${Q.toFixed(2)}</td>
      <td>${Math.round(V).toLocaleString('el-GR')}</td>
      <td>${txt}<br><span style="font-size:11px;color:#6b7a86">Peq=${Peq.toFixed(1)}</span></td>
      <td>${status(Q, CapNet)}</td>
      <td>${status(Q, CapStr)}</td>
    `;
    tbody.appendChild(tr);
  }

  drawChannel(finalY);
  drawBasinPlan();

  if(typeof scheduleSaveUiState==='function') scheduleSaveUiState();
}


function resetStrY(){
  const el = document.getElementById('strY');
  if(!el) return;
  el.value = "";
  delete el.dataset.manual;
  runMasterCalculation();
}

/* ===================== VISUALIZERS ===================== */
function drawBasinPlan(){
  const canvas = document.getElementById('basinCanvas');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);

  // background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0,0,w,h);

  // If we have GeoJSON rings, draw them; else schematic
  const gj = SELECTED_GEO;
  const rings = gj ? geojsonToRings(gj) : [];
  const style = basinStyleFromInputs();

  if(rings && rings.length && drawGeoRings(ctx, rings, w, h, style)){
    // label
    ctx.fillStyle = "#2c3e50";
    ctx.font = "bold 10px Arial";
    ctx.fillText("Περίγραμμα (GeoJSON)", 8, 14);
    drawBasinLegend(ctx, style);
    return;
  }

  // schematic fallback based on A & L
  const A = getVal('area'), L = getVal('length');
  if(!(A>0) || !(L>0)){
    ctx.fillStyle="#9aa6b2";
    ctx.font="12px Arial";
    ctx.textAlign="center";
    ctx.fillText("Ορίστε A & L ή φορτώστε λεκάνη", w/2, h/2);
    drawBasinLegend(ctx, style);
    return;
  }
  const W = A / L;
  const pad=14;
  const maxW=w-2*pad, maxH=h-2*pad;
  const scale = Math.min(maxW/(L||1), maxH/((W||1)));
  const Ls=L*scale, Ws=(W||1)*scale;
  const x=(w-Ls)/2, y=(h-Ws)/2;

  roundRect(ctx, x,y,Ls,Ws, Math.min(12, Ws/2, Ls/8));
  ctx.fillStyle = style.fill;
  ctx.fill();
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = style.lineWidth;
  ctx.stroke();

  ctx.fillStyle="#2c3e50";
  ctx.font="bold 10px Arial";
  ctx.textAlign="center";
  ctx.fillText(`L≈${Math.round(L)} m`, w/2, h-6);

  ctx.save();
  ctx.translate(10, h/2);
  ctx.rotate(-Math.PI/2);
  ctx.textAlign="center";
  ctx.fillText(`W≈${Math.round(W)} m`, 0, 0);
  ctx.restore();

  drawBasinLegend(ctx, style);
}

function basinStyleFromInputs(){
  const Qpeak = 0.278 * getVal('coef') * getVal('rainI') * (getVal('area')/1e6);
  const CapNet = getVal('drains') * getVal('drainCap');
  const CapStr = estimateStreamCap();
  // simple coloring: fill by Peq class, stroke by capacity stress
  const Dused = (getVal('rainD')>0) ? getVal('rainD') : Math.max(5, calculateTc(getVal('length'), getVal('height')));
  const P = getVal('rainI')*(Dused/60);
  const Peq = P*getVal('coef');

  let fill="#eafaf1";
  if(Peq>=60) fill="#ffd1d1";
  else if(Peq>=40) fill="#ffe0e0";
  else if(Peq>=25) fill="#ffe9d6";
  else if(Peq>=10) fill="#fff7e6";

  let stroke="#2c3e50";
  let lw=2;
  const netBad = (CapNet>0 && Qpeak>CapNet);
  const strBad = (CapStr>0 && Qpeak>CapStr);
  if(netBad || strBad){ stroke="#c0392b"; lw=3; }
  else if((CapNet>0 && Qpeak>CapNet*0.85) || (CapStr>0 && Qpeak>CapStr*0.85)){ stroke="#d35400"; lw=3; }

  return { fill, stroke, lineWidth: lw };
}

function estimateStreamCap(){
  const strWidth = getVal('strWidth');
  const strZ = getVal('strZ');
  const strDepth = getVal('strDepth');
  const strDrop = getVal('strDrop');
  const strLen = getVal('strLen');
  const strType = getVal('strType');
  const length = getVal('length');
  const height = getVal('height');

  const sLen = (strLen>0)? strLen : length;
  const sDrop = (strDrop>0)? strDrop : height;
  const sSlope = (sLen>0)? (sDrop/sLen) : 0;
  if(!(strWidth>0) || !(strDepth>0) || !(sSlope>0) || !(strType>0)) return 0;
  const A = (strWidth + strZ*strDepth)*strDepth;
  const P = strWidth + 2*strDepth*Math.sqrt(1+strZ*strZ);
  return (1/strType) * Math.pow(A, 5/3) * Math.pow(P, -2/3) * Math.sqrt(sSlope);
}

function drawBasinLegend(ctx, style){
  const x=8, y=ctx.canvas.height-16;
  ctx.fillStyle="#2c3e50";
  ctx.font="bold 10px Arial";
  ctx.textAlign="left";
  ctx.fillText("Fill=Peq, Stroke=Qcap stress", x, y);
  // swatches
  ctx.fillStyle = style.fill;
  ctx.fillRect(ctx.canvas.width-58, ctx.canvas.height-22, 18, 12);
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = style.lineWidth;
  ctx.strokeRect(ctx.canvas.width-30, ctx.canvas.height-22, 18, 12);
}

function roundRect(ctx, x, y, w, h, r){
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y, x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x, y+h, rr);
  ctx.arcTo(x, y+h, x, y, rr);
  ctx.arcTo(x, y, x+w, y, rr);
  ctx.closePath();
}

function geojsonToRings(gj){
  const rings = [];
  try{
    const feat = gj.features ? gj.features[0] : gj;
    const g = feat.geometry || feat;
    if(!g) return rings;

    const pushPoly = (poly) => {
      // poly: [ [ [lon,lat], ... ] , holes... ]
      if(Array.isArray(poly) && poly.length){
        rings.push(poly[0]);
      }
    };

    if(g.type === 'Polygon') pushPoly(g.coordinates);
    if(g.type === 'MultiPolygon'){
      for(const poly of g.coordinates) pushPoly(poly);
    }
  }catch(_){}
  return rings;
}

function drawGeoRings(ctx, rings, w, h, style){
  try{
    // safety limits (avoid UI freeze on huge/corrupted GeoJSON)
    const MAX_RINGS = 120;
    const MAX_POINTS = 15000;

    if(!Array.isArray(rings)) return false;
    if(rings.length > MAX_RINGS) rings = rings.slice(0, MAX_RINGS);

    let totalPoints = 0;
    rings = rings.map(r=>{
      if(!Array.isArray(r)) return null;
      const remain = MAX_POINTS - totalPoints;
      if(remain <= 0) return null;
      const take = Math.min(r.length, remain);
      totalPoints += take;
      return r.slice(0, take);
    }).filter(r=>r && r.length >= 3);

    if(!rings.length) return false;

    // find bounds
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    for(const r of rings){
      for(const [x,y] of r){
        if(x<minX) minX=x;
        if(y<minY) minY=y;
        if(x>maxX) maxX=x;
        if(y>maxY) maxY=y;
      }
    }
    if(!isFinite(minX) || !isFinite(maxX)) return false;

    const pad=14;
    const sx=(w-2*pad)/((maxX-minX)||1);
    const sy=(h-2*pad)/((maxY-minY)||1);
    const s=Math.min(sx,sy);

    const tx = (x)=> pad + (x-minX)*s;
    const ty = (y)=> h-pad - (y-minY)*s; // flip

    ctx.beginPath();
    for(const r of rings){
      for(let i=0;i<r.length;i++){
        const p = r[i];
        const X = tx(p[0]);
        const Y = ty(p[1]);
        if(i===0) ctx.moveTo(X,Y);
        else ctx.lineTo(X,Y);
      }
      ctx.closePath();
    }
    ctx.fillStyle = style.fill;
    ctx.fill();
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = style.lineWidth;
    ctx.stroke();
    return true;
  }catch(e){
    return false;
  }
}

function drawChannel(y_real){
  const canvas = document.getElementById('channelCanvas');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  const w=canvas.width, h=canvas.height;
  ctx.clearRect(0,0,w,h);

  const b = getVal('strWidth');
  const z = getVal('strZ');
  const H = getVal('strDepth');
  const y = y_real;

  if(b<=0 && H<=0){
    ctx.fillStyle="#9aa6b2";
    ctx.font="12px Arial";
    ctx.textAlign="center";
    ctx.fillText("Ορίστε b & h", w/2, h/2);
    return;
  }

  const maxH = Math.max(H, y);
  const topW = b + 2*(z*maxH);
  const pad=20;
  const scale = Math.min((w-pad)/(topW||1),(h-pad)/(maxH||1));
  const cx=w/2, cy=h-16;

  const gx = (wd)=>(wd*scale)/2;
  const gy = (d)=> cy - (d*scale);

  const drawPoly = (tw, d, fill, stroke, dash=[])=>{
    ctx.beginPath();
    ctx.moveTo(cx-gx(tw), gy(d));
    ctx.lineTo(cx-gx(b), cy);
    ctx.lineTo(cx+gx(b), cy);
    ctx.lineTo(cx+gx(tw), gy(d));
    ctx.closePath();
    if(fill){ ctx.fillStyle=fill; ctx.fill(); }
    if(stroke){
      ctx.strokeStyle=stroke;
      ctx.setLineDash(dash);
      ctx.lineWidth=2;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  };

  // banks outline
  if(H>0){
    drawPoly(b+2*z*H, H, null, "#5D4037");
  }
  // water
  if(y>0){
    const isOver = (H>0 && y>H);
    drawPoly(b+2*z*Math.min(y, H*1.5||y), Math.min(y, H*1.5||y),
      isOver ? "rgba(231,76,60,0.55)" : "rgba(52,152,219,0.55)",
      isOver ? "#c0392b" : "#2980b9",
      []
    );
    // waterline
    ctx.beginPath();
    ctx.moveTo(cx-gx(b+2*z*y), gy(y));
    ctx.lineTo(cx+gx(b+2*z*y), gy(y));
    ctx.strokeStyle="#2c3e50";
    ctx.lineWidth=1;
    ctx.stroke();

    ctx.fillStyle="#2c3e50";
    ctx.font="bold 10px Arial";
    ctx.textAlign="center";
    ctx.fillText(`y=${y.toFixed(2)}m`, cx, gy(y)-6);
  }

  ctx.fillStyle="#2c3e50";
  ctx.font="bold 10px Arial";
  ctx.textAlign="center";
  if(b>0) ctx.fillText(`b=${b}m`, cx, cy+12);
}

/* ===================== Inputs binding ===================== */
function bindInputs(){
  const ids = [
    'rainI','rainD','area','length','height','coef',
    'drains','drainCap',
    'strWidth','strZ','strDepth','strDrop','strLen','strType','strY'
  ];

  // avoid heavy recalcs while typing
  const debouncedCalc = debounce(()=>{ runMasterCalculation(); scheduleSaveUiState(); }, 140);

  ids.forEach(id=>{
    const el = document.getElementById(id);
    if(!el) return;

    // bind once
    if(el.dataset.boundCalc === '1') return;
    el.dataset.boundCalc = '1';

    el.addEventListener('input', debouncedCalc);
    el.addEventListener('change', ()=>{ runMasterCalculation(); scheduleSaveUiState(); });
  });

  // Make strY manual once user edits it (bind once)
  const strYEl = document.getElementById('strY');
  if(strYEl && strYEl.dataset.boundManual !== '1'){
    strYEl.dataset.boundManual = '1';
    strYEl.addEventListener('input', ()=>{ strYEl.dataset.manual='true'; scheduleSaveUiState(); });
  }
}


/* ===================== CO‑HAZARDS (Primary + Secondary) ===================== */
(function(){
  const LS_COH = 'NIREAS_CO_HAZARDS_V1';

  function hzName(hz){
    const map = { wind:'Άνεμος', rain:'Βροχή', heatwave:'Καύσωνας', frost_snow:'Παγετός' };
    return map[hz] || hz;
  }

  function getPrimaryScenario(){
    try{
      const sel = document.getElementById('modelScenario');
      return sel ? String(sel.value || '').trim() : (document.body.dataset.modelScenario || 'rain');
    }catch(_){ return (document.body.dataset.modelScenario || 'rain'); }
  }

  function getLatestSample(){
    try{
      if(window.stationSeries && Array.isArray(window.stationSeries) && window.stationSeries.length){
        return window.stationSeries[window.stationSeries.length-1];
      }
      // fallback (in case it's not on window)
      if(typeof stationSeries !== 'undefined' && Array.isArray(stationSeries) && stationSeries.length){
        return stationSeries[stationSeries.length-1];
      }
    }catch(_){}
    return null;
  }

  function numFromText(txt){
    if(txt == null) return null;
    const s = String(txt).replace(',', '.');
    const m = s.match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
  }
  function fmt(v, unit=''){
    if(v==null || !Number.isFinite(v)) return '—';
    const n = Math.round(v*10)/10;
    return n.toFixed(1) + unit;
  }

  // co‑hazards state
  const coHaz = new Set();

  function loadCoHazards(){
    try{
      const raw = localStorage.getItem(LS_COH);
      if(!raw) return;
      const arr = JSON.parse(raw);
      if(Array.isArray(arr)) arr.forEach(x=>coHaz.add(String(x)));
    }catch(_){}
  }
  function saveCoHazards(){
    try{ localStorage.setItem(LS_COH, JSON.stringify(Array.from(coHaz))); }catch(_){}
  }

  function syncCoHazardButtons(){
    const primary = getPrimaryScenario();
    const btns = document.querySelectorAll('#coHazards .cohz');
    btns.forEach(btn=>{
      const hz = btn.getAttribute('data-hz');
      const isPrimary = (hz === primary);
      if(isPrimary){
        coHaz.delete(hz); // never allow primary as secondary
      }
      btn.disabled = isPrimary;
      btn.classList.toggle('cohz-on', coHaz.has(hz));
    });
  }

  
  function syncCoHazardsContextFromGlobal(){
    const srcBadges = document.getElementById('coHazardsBadges');
    const srcMetrics = document.getElementById('coHazardsMetrics');
    const badgesHTML = srcBadges ? srcBadges.innerHTML : '';
    const metricsHTML = srcMetrics ? srcMetrics.innerHTML : '—';

    ['rain','wind','heatwave','frost_snow'].forEach(k=>{
      const b = document.getElementById(`coHazardsBadges_ctx_${k}`);
      const m = document.getElementById(`coHazardsMetrics_ctx_${k}`);
      if(b) b.innerHTML = badgesHTML;
      if(m) m.innerHTML = metricsHTML;
    });
  }

function renderCoHazardsGlobal(){
    const box = document.getElementById('coHazardsGlobal');
    const badges = document.getElementById('coHazardsBadges');
    const metrics = document.getElementById('coHazardsMetrics');
    if(!box || !badges || !metrics) return;

    const arr = Array.from(coHaz);

    // Keep the panel visible (consistent with other panels)
    box.style.display = '';

    if(!arr.length){
      badges.innerHTML = '';
      metrics.innerHTML = '<span style="color:#6b7a86">Επίλεξε Συνδυαστικά Φαινόμενα (π.χ. +Άνεμος, +Βροχή, +Καύσωνας, +Παγετός) για να εμφανιστούν δείκτες.</span>';
      syncCoHazardsContextFromGlobal();
      return;
    }
    badges.innerHTML = arr.map(hz=>`<span class="cohazards-badge cohz-badge-${hz}">+ ${hzName(hz)}</span>`).join('');

    const s = getLatestSample();
    if(!s){
      metrics.innerHTML = '<span style="color:#6b7a86">Φόρτωσε (Load) ή ενεργοποίησε Live για να εμφανιστούν δεδομένα.</span>';
      syncCoHazardsContextFromGlobal();
      return;
    }

    // common fields from sample
    const t = (typeof s.temp === 'number') ? s.temp : ((typeof s.temperature === 'number') ? s.temperature : numFromText(s.temp));
    const hi = (typeof s.heatIndex === 'number') ? s.heatIndex : ((typeof s.hi === 'number') ? s.hi : numFromText(s.heatIndex));
    const chill = (typeof s.chill === 'number') ? s.chill : numFromText(s.chill);
    const rr = (typeof s.rainRate === 'number') ? s.rainRate : ((typeof s.rr === 'number') ? s.rr : numFromText(s.rainRate));
    const storm = (typeof s.storm === 'number') ? s.storm : numFromText(s.storm);
    const windTxt = (s.wind != null) ? String(s.wind) : '';
    const wKmh = (typeof s.windKmh === 'number') ? s.windKmh : ((typeof s.wind_kmh === 'number') ? s.wind_kmh : numFromText(windTxt));

    // derive wind dir (simple parse)
    let wDir = '—';
    try{
      const parts = windTxt.trim().split(/\s+/);
      const last = parts[parts.length-1];
      if(last && /[A-ZΑ-Ω]{1,3}/i.test(last)) wDir = last;
    }catch(_){}

    // risk helpers using existing threshold inputs (if present)
    function windRisk(){
      const warnK = Number(document.getElementById('windWarnKmh')?.value);
      const highK = Number(document.getElementById('windHighKmh')?.value);
      if(!Number.isFinite(wKmh)) return '—';
      if(Number.isFinite(highK) && wKmh >= highK) return 'Υψηλός';
      if(Number.isFinite(warnK) && wKmh >= warnK) return 'Μέτριος';
      return 'Χαμηλός';
    }
    function heatRisk(){
      const warnHI = Number(document.getElementById('heatWarnHI')?.value);
      const highHI = Number(document.getElementById('heatHighHI')?.value);
      const x = Number.isFinite(hi) ? hi : t;
      if(!Number.isFinite(x)) return '—';
      if(Number.isFinite(highHI) && x >= highHI) return 'Υψηλός';
      if(Number.isFinite(warnHI) && x >= warnHI) return 'Μέτριος';
      return 'Χαμηλός';
    }
    function frostRisk(){
      const t0 = Number(document.getElementById('frostTemp0')?.value);
      const tHigh = Number(document.getElementById('frostTempHigh')?.value);
      if(!Number.isFinite(t)) return '—';
      if(Number.isFinite(tHigh) && t <= tHigh) return 'Υψηλός';
      if(Number.isFinite(t0) && t <= t0) return 'Μέτριος';
      if(t <= 2) return 'Χαμηλός';
      return 'Χαμηλός';
    }
    function iceRisk(){
      if(!Number.isFinite(t)) return '—';
      if(t <= 0 && Number.isFinite(rr) && rr > 0) return 'Υψηλός';
      if(t <= 1) return 'Μέτριος';
      return 'Χαμηλός';
    }

    const lines = [];
    arr.forEach(hz=>{
      if(hz === 'wind'){
        lines.push(`<li><b>Άνεμος</b>: ${fmt(wKmh,' km/h')} ${wDir !== '—' ? wDir : ''} — <span style="color:#6b7a86">Κίνδυνος:</span> <b>${windRisk()}</b></li>`);
      }else if(hz === 'rain'){
        lines.push(`<li><b>Βροχή</b>: ${Number.isFinite(rr) ? fmt(rr,' mm/h') : '—'} — <span style="color:#6b7a86">Storm:</span> ${Number.isFinite(storm) ? fmt(storm,' mm') : '—'}</li>`);
      }else if(hz === 'heatwave'){
        const hiTxt = Number.isFinite(hi) ? fmt(hi,' °C') : '—';
        lines.push(`<li><b>Καύσωνας</b>: T ${fmt(t,' °C')} — HI ${hiTxt} — <span style="color:#6b7a86">Κίνδυνος:</span> <b>${heatRisk()}</b></li>`);
      }else if(hz === 'frost_snow'){
        lines.push(`<li><b>Παγετός</b>: T ${fmt(t,' °C')} — Chill ${Number.isFinite(chill) ? fmt(chill,' °C') : '—'} — <span style="color:#6b7a86">Παγετός:</span> <b>${frostRisk()}</b>, <span style="color:#6b7a86">Πάγος:</span> <b>${iceRisk()}</b></li>`);
      }
    });

    metrics.innerHTML = `<ul>${lines.join('')}</ul>`;
  
    syncCoHazardsContextFromGlobal();
}

  // exposed API
  window.toggleCoHazard = function(hz){
    const primary = getPrimaryScenario();
    const x = String(hz || '').trim();
    if(!x || x === primary) return;
    if(coHaz.has(x)) coHaz.delete(x); else coHaz.add(x);
    saveCoHazards();
    syncCoHazardButtons();
    renderCoHazardsGlobal();
  };
// Clear all selected secondary hazards (used by the reset icon)
window.clearCoHazards = function(){
  try{
    coHaz.clear();
    saveCoHazards();
    syncCoHazardButtons();
    renderCoHazardsGlobal();
  }catch(e){
    console.warn('clearCoHazards failed', e);
  }
};


  window.initCoHazardsUI = function(){
    loadCoHazards();
    syncCoHazardButtons();
    renderCoHazardsGlobal();

    // keep UI in sync with primary scenario changes
    const sel = document.getElementById('modelScenario');
    if(sel){
      sel.addEventListener('change', ()=>{
        syncCoHazardButtons();
        renderCoHazardsGlobal();
      });
    }

    // hook into refreshScenarioPanels if available
    try{
      if(typeof window.refreshScenarioPanels === 'function' && !window.__cohazardsWrapped){
        const orig = window.refreshScenarioPanels;
        window.refreshScenarioPanels = function(){
          const r = orig.apply(this, arguments);
          try{ renderCoHazardsGlobal(); }catch(_){}
          return r;
        };
        window.__cohazardsWrapped = true;
      }
    }catch(_){}
  };
})();


/* ===================== BOOT ===================== */
/*
  NOTE:
  - The Firebase logger/reader is loaded via <script type="module"> earlier in the document and is deferred.
  - This boot waits until the required global init* functions exist before starting.
*/
(function(){
  const NEED = ['initAIAnalysisUI','initDbReaderUI','initSeriesReaderUI','initCoHazardsUI','init'];
  const MAX_TRIES = 80;      // 80 * 50ms = 4s worst-case
  const INTERVAL_MS = 50;

  function safeCall(fnName){
    try{
      const fn = window[fnName];
      if(typeof fn === 'function') fn();
    }catch(e){
      console.warn('BOOT:', fnName, 'failed:', e);
    }
  }

  function bindScenarioInputs(){
    try{
      ['windWarnKmh','windHighKmh','heatWarnHI','heatHighHI','frostWarnT','frostHighT']
        .forEach(id=>{
          const el = document.getElementById(id);
          if(!el) return;
          el.addEventListener('input', ()=>{
            try{ window.refreshScenarioPanels && window.refreshScenarioPanels(); }catch(_){}
          });
        });
    }catch(e){
      console.warn('BOOT: bindScenarioInputs failed:', e);
    }
  }

  // Global scenario auto-refresh: update mini-panels on ANY meaningful change (capture phase so it can't be blocked).
  let __scenarioRefreshTimer = null;
  function __scheduleScenarioRefresh(){
    try{
      if(__scenarioRefreshTimer) clearTimeout(__scenarioRefreshTimer);
      __scenarioRefreshTimer = setTimeout(()=>{ try{ refreshScenarioPanels(); }catch(_){ } }, 60);
    }catch(_){}
  }

  function bindGlobalScenarioAutoRefresh(){
    try{
      ['input','change'].forEach(ev=>{
        document.addEventListener(ev, __scheduleScenarioRefresh, true); // capture-phase
      });

      // clicks on buttons/selects often trigger state changes (Load, Reset, etc.)
      document.addEventListener('click', (e)=>{
        try{
          const t = e.target;
          if(!t) return;
          if(t.matches('button,select,option') || t.closest('button') || t.closest('select')){
            __scheduleScenarioRefresh();
          }
        }catch(_){}
      }, true);
    }catch(_){}

    // When switching primary station, clear scenario summary until a new fetch arrives
    try{
      const sel = document.getElementById('primaryStation');
      if(sel){
        sel.addEventListener('change', ()=>{
          try{ window.__PRIMARY_LATEST_SAMPLE = null; }catch(_){}
          try{ setScenarioSummaryPlaceholder(true); }catch(_){}
          __scheduleScenarioRefresh();
        }, true);
      }
    }catch(_){}
  }

  function boot(attempt){
    const missing = NEED.filter(n => typeof window[n] !== 'function');
    if(missing.length){
      if(attempt < MAX_TRIES){
        setTimeout(()=>boot(attempt+1), INTERVAL_MS);
      }else{
        console.warn('BOOT: missing functions after waiting:', missing);
      }
      return;
    }

    // init UI modules
    safeCall('initAIAnalysisUI');
    safeCall('initDbReaderUI');
    safeCall('initSeriesReaderUI');
    safeCall('initCoHazardsUI');

    bindScenarioInputs();
    try{ bindGlobalScenarioAutoRefresh(); }catch(e){ console.warn('BOOT: bindGlobalScenarioAutoRefresh failed:', e); }


    // start app
    safeCall('init');
  }

  // run after DOM is ready (module scripts execute before DOMContentLoaded)
  window.addEventListener('DOMContentLoaded', ()=>{
    boot(0);
  });})();

function initCollapsedCards(){
  // Ensure cards that start with a collapsed body also get rounded header corners
  document.querySelectorAll('.section-body.collapsed').forEach(body => {
    const card = body.closest('.panel-card');
    if(card) card.classList.add('is-collapsed');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initCollapsedCards();
});
