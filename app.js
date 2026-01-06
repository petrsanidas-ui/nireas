/* extracted inline content from <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"> */

/* ===================== STARTUP ===================== */
// Δεν "πρέπει" να ξεκινάει με εικόνα — αυτό είναι απλά ένα μικρό logo splash.
// Αν θέλεις να μην εμφανίζεται καθόλου, βάλε: false
const STARTUP_SPLASH_ENABLED = true;

function collapseAllPanelsOnStartup(){
  try{
    // Collapse ALL collapsible panel bodies
    document.querySelectorAll('.section-body').forEach(body => {
      body.classList.add('collapsed');
      body.setAttribute('aria-hidden','true');

      const card = body.closest('.panel-card');
      if(card) card.classList.add('is-collapsed');

      // Match the +/− button to the collapsed state
      const section = body.closest('.section');
      const btn = section ? section.querySelector('.panel-topbar .hdr-right .icon-btn') : null;
      if(btn) btn.textContent = '+';
    });

    // Close all <details> blocks (e.g. "Επιπλέον σταθμοί") unless explicitly opted-out
    document.querySelectorAll('details').forEach(d => {
      if(d.hasAttribute('data-start-open')) return;
      d.open = false;
    });

    // Also collapse any panel driven by toggleCollapse('id', this)
    // (covers main panels like "Δεδομένα", "Επιχειρησιακό Σενάριο", etc.)
    document.querySelectorAll('button[onclick*="toggleCollapse("]').forEach(btn => {
      const js = btn.getAttribute('onclick') || '';
      const m = js.match(/toggleCollapse\(['\"]([^'\"]+)['\"]/);
      if(!m) return;
      const id = m[1];
      const el = document.getElementById(id);
      if(!el) return;
      el.classList.add('collapsed');
      try{ el.setAttribute('aria-hidden','true'); }catch(_){ }
      btn.textContent = '+';
      const card = btn.closest('.panel-card') || el.closest('.panel-card');
      if(card) card.classList.add('is-collapsed');
    });
  }catch(e){
    console.warn('STARTUP: collapseAllPanelsOnStartup failed:', e);
  }
}

function initStartupSplash(){
  if(!STARTUP_SPLASH_ENABLED) return;
  const splash = document.getElementById('startupSplash');
  if(!splash) return;

  let closed = false;
  const close = () => {
    if(closed) return;
    closed = true;
    splash.classList.add('is-hidden');
    setTimeout(() => { try{ splash.remove(); }catch(_){} }, 420);
  };

  splash.addEventListener('click', close, { passive: true });
  window.addEventListener('keydown', close, { once: true });
}

document.addEventListener('DOMContentLoaded', () => {
  collapseAllPanelsOnStartup();

  // Ensure collapsed cards have unified rounded headers
  document.querySelectorAll('.section-body.collapsed').forEach(body => {
    const card = body.closest('.panel-card');
    if(card) card.classList.add('is-collapsed');
  });

  initStartupSplash();
});


/* ===================== CONFIG ===================== */
const GH_USER   = 'petrsanidas-ui';
const GH_REPO   = 'nireas';
const GH_BRANCH = 'main';
const API_TREE  = `https://api.github.com/repos/${GH_USER}/${GH_REPO}/git/trees/${GH_BRANCH}?recursive=1`;
const RAW_URL   = `https://raw.githubusercontent.com/${GH_USER}/${GH_REPO}/${GH_BRANCH}/`;

let DATA_GROUPS = { boundaries: [], streams: [], basins: [] }; // NOTE ORDER

// Admin areas registry (for AOI & boundaries typing)
let ADMIN_AREAS_REGISTRY = [];
let ADMIN_AREAS_BY_KEY = new Map();
let ADMIN_AREAS_BY_FILE = new Map();

let SELECTED_GEO = null;
let SELECTED_BASIN_KEY = null;
let SELECTED_ZONE_KEY = null;
let SELECTED_ZONE_NAME = null;
let SELECTED_ZONE_KIND = null; // 'basin' | 'boundary'
let SELECTED_BOUNDARY_KEY = null;
let SELECTED_BOUNDARY_NAME = null;
let SELECTED_BOUNDARY_GEO = null;
let SELECTED_STREAM_KEY = null;
let SELECTED_STREAM_NAME = null;
let SELECTED_STREAM_GEO = null;
let STATION_SELECT_BOUND = false; // bind dropdown change listener once
let MULTI_DETAILS_OPEN = false; // remember collapse state for "Επιπλέον σταθμοί" (start closed)


let MULTI_RESULTS_BY_URL = new Map(); // url -> last fetched result (for per-station refresh)
/* ===== Map state (multi-layer) ===== */
let map = null;
let baseLayer = null;
const GEO_CACHE = new Map();       // path -> geojson
const LAYER_CACHE = new Map();     // path -> leaflet layer
const VISIBLE = new Set();         // paths currently "On"

/* ===== AOI (Area of Interest / Περιοχή Ενδιαφέροντος) ===== */
let AOI_STATE = { type: 'municipality', selected: emptyAoiSelected(), expanded: emptyAoiSelected(), paths: [], names: [] };
let AOI_LAYER_GROUP = null;

let PREVIEW_LAYER = null;          // temporary layer for Map button preview

/* ===== Selected Meteo Stations layer (map) ===== */
const STATIONS_META = new Map();   // url -> {name,url,lat,lon,elev}
let METEO_PRIMARY_VISIBLE = false;
let METEO_WATCH_VISIBLE = false;
let METEO_STATIONS_LAYER = null;  // persistent selected markers layer
let METEO_STATIONS_PREVIEW = null;// preview-only layer (Map button)
const METEO_MARKERS = new Map();  // url -> Leaflet marker (persistent)

function getSelectedStationUrls(){
  const out = [];
  const p = getPrimaryStationUrl ? getPrimaryStationUrl() : '';
  if(p) out.push(p);
  try{
    if(typeof watchlist !== 'undefined' && watchlist && watchlist.size){
      for(const u of watchlist.keys()) out.push(u);
    }
  }catch(_){}
  return Array.from(new Set(out));
}

function meteoIcons(){
  // cache once
  if(meteoIcons._cache) return meteoIcons._cache;
  const extra = L.divIcon({
    className:'station-divicon',
    html:'<div class="station-pin-wrap"><div class="station-pin"></div></div>',
    iconSize:[16,16],
    iconAnchor:[8,8]
  });
  const primary = L.divIcon({
    className:'station-divicon',
    html:'<div class="station-pin-wrap"><div class="station-pin primary"></div></div>',
    iconSize:[18,18],
    iconAnchor:[9,9]
  });
  meteoIcons._cache = { extra, primary };
  return meteoIcons._cache;
}

function ensureMeteoStationsLayer(){
  if(!METEO_STATIONS_LAYER) METEO_STATIONS_LAYER = L.layerGroup();
  return METEO_STATIONS_LAYER;
}

function clearMeteoStationsPreview(){
  if(METEO_STATIONS_PREVIEW && map && map.hasLayer(METEO_STATIONS_PREVIEW)){
    map.removeLayer(METEO_STATIONS_PREVIEW);
  }
  METEO_STATIONS_PREVIEW = null;
}

async function refreshSelectedMeteoMarkers(){
  // Build / update persistent marker cache for:
  // - Primary station (if selected)
  // - Watchlist stations
  const primaryUrl = (getPrimaryStationUrl ? getPrimaryStationUrl() : '') || '';

  // Watchlist URLs (exclude primary if duplicated)
  let watchUrls = [];
  try{
    if(watchlist && watchlist.size){
      watchUrls = Array.from(watchlist.keys()).filter(u => u && u !== primaryUrl);
    }
  }catch(_){}

  const urls = Array.from(new Set([ ...(primaryUrl ? [primaryUrl] : []), ...watchUrls ]));
  const keep = new Set(urls);

  // remove stale markers from cache + layer
  for(const [u, mk] of Array.from(METEO_MARKERS.entries())){
    if(!keep.has(u)){
      try{ ensureMeteoStationsLayer().removeLayer(mk); }catch(_){}
      METEO_MARKERS.delete(u);
    }
  }

  const icons = meteoIcons();

  // add missing markers to cache (NOT necessarily visible)
  for(const u of urls){
    if(METEO_MARKERS.has(u)) continue;

    // special fallback for Open‑Meteo token (shows approx Chalandri)
    let meta = STATIONS_META.get(u);
    if(!meta && u === OPEN_METEO_TOKEN){
      meta = { name:'Open‑Meteo (Χαλάνδρι)', url:u, lat:38.0237, lon:23.8007, elev:null };
    }
    if(!meta || meta.lat == null || meta.lon == null) continue;

    const icon = (u === primaryUrl) ? icons.primary : icons.extra;
    const mk = L.marker([meta.lat, meta.lon], { icon });

    const elevTxt = (meta.elev != null && !Number.isNaN(meta.elev)) ? `${meta.elev} m` : '—';
    mk.bindPopup(`<b>${meta.name || 'Σταθμός'}</b><br/>Υψόμετρο: ${elevTxt}<br/><a href="${meta.url === OPEN_METEO_TOKEN ? '#' : meta.url}" target="_blank">Άνοιγμα link</a>`);

    METEO_MARKERS.set(u, mk);
  }

  // sync marker membership inside the persistent layer (based on independent On/Off)
  const layer = ensureMeteoStationsLayer();
  for(const [u, mk] of METEO_MARKERS.entries()){
    const isPrimary = (primaryUrl && u === primaryUrl);
    const shouldShow = isPrimary ? !!METEO_PRIMARY_VISIBLE : !!METEO_WATCH_VISIBLE;
    try{
      if(shouldShow){
        if(!layer.hasLayer(mk)) layer.addLayer(mk);
      }else{
        if(layer.hasLayer(mk)) layer.removeLayer(mk);
      }
    }catch(_){}
  }

  // if map open, add/remove whole layer depending on any visibility
  if(map){
    const anyVisible = !!METEO_PRIMARY_VISIBLE || !!METEO_WATCH_VISIBLE;
    if(anyVisible){
      if(!map.hasLayer(layer)) layer.addTo(map);
    }else{
      if(map.hasLayer(layer)) map.removeLayer(layer);
    }
  }
}


function setOnOffBtn(btn, on){
  if(!btn) return;
  btn.innerHTML = `<span class="ico-eye">👁</span> ${on ? "On" : "Off"}`;
  btn.classList.toggle("btn-on", !!on);
  btn.classList.toggle("btn-off", !on);
  btn.classList.add("map-only-btn");
}


  function updateMeteoPrimaryOnOffBtn(){
  const btn = document.getElementById('btn-onoff-meteoStations-2');
  if(btn) setOnOffBtn(btn, !!METEO_PRIMARY_VISIBLE);
}
function updateMeteoWatchOnOffBtn(){
  const btn = document.getElementById('btn-onoff-meteoStations');
  if(btn) setOnOffBtn(btn, !!METEO_WATCH_VISIBLE);
}

// Backward-compatible helper name used elsewhere
function updateMeteoStationsRowButton(){
  updateMeteoPrimaryOnOffBtn();
  updateMeteoWatchOnOffBtn();
}

function toggleMeteoPrimaryLayer(){
  METEO_PRIMARY_VISIBLE = !METEO_PRIMARY_VISIBLE;
  updateMeteoPrimaryOnOffBtn();
  if(map) refreshSelectedMeteoMarkers();
  if(typeof scheduleSaveUiState==='function') scheduleSaveUiState();
}

function toggleMeteoWatchLayer(){
  METEO_WATCH_VISIBLE = !METEO_WATCH_VISIBLE;
  updateMeteoWatchOnOffBtn();
  if(map) refreshSelectedMeteoMarkers();
  if(typeof scheduleSaveUiState==='function') scheduleSaveUiState();
}

async function meteoStationsLoad(){
  // Refresh markers cache; do not open map, do not change On/Off
  await refreshSelectedMeteoMarkers();
}

async function meteoPrimaryMap(){
  // Preview PRIMARY station on map WITHOUT changing On/Off
  openMapModal();
  clearMeteoStationsPreview();

  const primaryUrl = (getPrimaryStationUrl ? getPrimaryStationUrl() : '') || '';
  if(!primaryUrl){
    try{ setStationMsg('Κύριος: (δεν έχει επιλεγεί)'); }catch(_){}
    return;
  }

  const icons = meteoIcons();
  const grp = L.layerGroup();
  const pts = [];

  let meta = STATIONS_META.get(primaryUrl);
  if(!meta && primaryUrl === OPEN_METEO_TOKEN){
    meta = { name:'Open‑Meteo (Χαλάνδρι)', url:primaryUrl, lat:38.0237, lon:23.8007, elev:null };
  }

  if(meta && meta.lat != null && meta.lon != null){
    const mk = L.marker([meta.lat, meta.lon], { icon: icons.primary });
    const elevTxt = (meta.elev != null && !Number.isNaN(meta.elev)) ? `${meta.elev} m` : '—';
    mk.bindPopup(`<b>${meta.name || 'Κύριος Σταθμός'}</b><br/>Υψόμετρο: ${elevTxt}`);
    mk.addTo(grp);
    pts.push([meta.lat, meta.lon]);
  }

  METEO_STATIONS_PREVIEW = grp.addTo(map);

  if(map && pts.length){
    try{
      map.setView([pts[0][0], pts[0][1]], 13);
    }catch(_){}
  }
}

async function meteoWatchMap(){
  // Preview WATCHLIST stations on map WITHOUT changing On/Off
  openMapModal();
  clearMeteoStationsPreview();

  const primaryUrl = (getPrimaryStationUrl ? getPrimaryStationUrl() : '') || '';
  let urls = [];
  try{
    if(watchlist && watchlist.size){
      urls = Array.from(watchlist.keys()).filter(u => u && u !== primaryUrl);
    }
  }catch(_){}

  if(!urls.length){
    try{ setStationMsg('Επιπλέον: (κανένας επιλεγμένος)'); }catch(_){}
    return;
  }

  const icons = meteoIcons();
  const grp = L.layerGroup();
  const pts = [];

  for(const u of urls){
    let meta = STATIONS_META.get(u);
    if(!meta && u === OPEN_METEO_TOKEN){
      meta = { name:'Open‑Meteo (Χαλάνδρι)', url:u, lat:38.0237, lon:23.8007, elev:null };
    }
    if(!meta || meta.lat == null || meta.lon == null) continue;

    const mk = L.marker([meta.lat, meta.lon], { icon: icons.extra });
    const elevTxt = (meta.elev != null && !Number.isNaN(meta.elev)) ? `${meta.elev} m` : '—';
    mk.bindPopup(`<b>${meta.name || 'Σταθμός'}</b><br/>Υψόμετρο: ${elevTxt}`);
    mk.addTo(grp);
    pts.push([meta.lat, meta.lon]);
  }

  METEO_STATIONS_PREVIEW = grp.addTo(map);

  if(map && pts.length){
    try{
      const b = L.latLngBounds(pts.map(p=>L.latLng(p[0], p[1])));
      map.fitBounds(b, { padding:[20,20] });
    }catch(_){}
  }
}

async function meteoStationsMap(){
  // Preview selected stations on map WITHOUT changing On/Off
  openMapModal();
  clearMeteoStationsPreview();

  const urls = getSelectedStationUrls();
  const icons = meteoIcons();
  const primaryUrl = (getPrimaryStationUrl ? getPrimaryStationUrl() : '') || '';

  const grp = L.layerGroup();
  const pts = [];

  for(const u of urls){
    let meta = STATIONS_META.get(u);
    if(!meta && u === OPEN_METEO_TOKEN){
      meta = { name:'Open‑Meteo (Χαλάνδρι)', url:u, lat:38.0237, lon:23.8007, elev:null };
    }
    if(!meta || meta.lat == null || meta.lon == null) continue;

    const icon = (u === primaryUrl) ? icons.primary : icons.extra;
    const mk = L.marker([meta.lat, meta.lon], { icon });
    grp.addLayer(mk);
    pts.push([meta.lat, meta.lon]);
  }

  METEO_STATIONS_PREVIEW = grp;
  if(map && !map.hasLayer(grp)) grp.addTo(map);

  // fit to points if any
  if(map && pts.length){
    try{
      const b = L.latLngBounds(pts.map(p=>L.latLng(p[0], p[1])));
      map.fitBounds(b, { padding:[20,20] });
    }catch(_){}
  }
}

/* ===== End Meteo Stations layer ===== */

/* ===== Station monitor ===== */
const STATION_SERIES_DEFAULT = 50;
function getSeriesLimit(){
  const n = Number(document.getElementById('seriesLimit')?.value);
  const lim = (Number.isFinite(n) && n>0) ? n : STATION_SERIES_DEFAULT;
  return Math.max(1, Math.min(500, Math.floor(lim)));
}

// Per-station series contexts (do not mix histories across different primary stations)
const stationSeriesByKey  = Object.create(null);  // key -> array
const stationLastKeyByKey = Object.create(null);  // key -> last sample key
function trimAllStationSeriesToLimit(){
  const lim = getSeriesLimit();
  for(const k of Object.keys(stationSeriesByKey)){
    const arr = stationSeriesByKey[k];
    if(Array.isArray(arr) && arr.length > lim){
      arr.splice(0, arr.length - lim);
    }
  }
}
let currentStationKey = 'open-meteo';

let stationSeries = [];
let stationLastKey = null;

// initialize default context
stationSeriesByKey[currentStationKey] = stationSeries;
stationLastKeyByKey[currentStationKey] = stationLastKey;

let stationLiveOn = false;
const watchlist = new Map(); // url -> display name
let ACTIVE_PRIMARY_URL = '';
let ACTIVE_PRIMARY_NAME = '';

const LS_WATCHLIST_KEY = 'nireas_watchlist_v1';
const LS_CUSTOM_KEY   = 'nireas_customstations_v1';
const OPEN_METEO_TOKEN = '__OPEN_METEO__';
const ALL_API_TOKEN   = '__ALL_API__';
const ALL_WEB_TOKEN   = '__ALL_WEB__';
const ALL_ALL_TOKEN   = '__ALL_ALL__';

function getSelectGroupPairs(selectEl, groupLabel){
  const out = [];
  if(!selectEl) return out;
  const kids = Array.from(selectEl.children || []);
  for(const node of kids){
    if(node && node.tagName === 'OPTGROUP' && node.label === groupLabel){
      for(const opt of Array.from(node.children || [])){
        if(!opt || opt.tagName !== 'OPTION') continue;
        const url = String(opt.value || '').trim();
        if(!url) continue;
        if(url === ALL_API_TOKEN || url === ALL_WEB_TOKEN || url === ALL_ALL_TOKEN) continue;
        out.push({ url, name: String(opt.textContent || url).trim() });
      }
    }
  }
  return out;
}

/* ===== Model Scenario (for future model switching) ===== */
let MODEL_SCENARIO = ''; // rain | wind | heatwave | frost_snow | storm | dust_smoke | fog

function setModelScenario(val){
  MODEL_SCENARIO = (val == null) ? '' : String(val);
// reflect on UI (title only — calculations remain the same for now)
  const mapName = {
    rain:'Βροχή',
    wind:'Άνεμος',
    heatwave:'Καύσωνας',
    frost_snow:'Παγετός / Χιόνια',
    storm:'Καταιγίδα / Κεραυνοί',
    dust_smoke:'Σκόνη / Καπνός',
    fog:'Ομίχλη'
  };
  const nice = mapName[MODEL_SCENARIO] || '—';
  const t = document.getElementById('scenarioTitle');
  if(t) t.textContent = `ΣΕΝΑΡΙΟ: ${nice}`;
  document.body.dataset.modelScenario = MODEL_SCENARIO || 'none';
  try{ applyScenarioUI(MODEL_SCENARIO); }catch(_){}

  try{ scheduleSaveUiState(); }catch(_){}

/* ===== Scenario-based UI: show only relevant panels (from 'Λεκάνη και κάτω') ===== */
function applyScenarioUI(scn){
  const val = (scn == null) ? '' : String(scn);

  const root = document.getElementById('scenarioArea');
  if(!root) return;

  const panels = root.querySelectorAll('.scenario-panel');

  // No scenario selected -> hide everything under "Λεκάνη και κάτω"
  if(!val){
    panels.forEach(p=>{
      p.classList.remove('active');
      try{ p.setAttribute('aria-hidden', 'true'); }catch(_){}
    });
    return;
  }

  const map = {
    rain: 'panel_rain',
    wind: 'panel_wind',
    heatwave: 'panel_heatwave',
    frost_snow: 'panel_frost_snow'
  };
  const target = map[val] || null;

  panels.forEach(p=>{
    const on = target ? (p.id === target) : false;
    p.classList.toggle('active', on);
    try{ p.setAttribute('aria-hidden', on ? 'false' : 'true'); }catch(_){}
  });

  // Keep "Επιλεγμένη περιοχή" in sync with the currently selected basin (until we add dedicated area selection)
  try{
    const basin = document.getElementById('selectedBasinName')?.textContent?.trim() || '—';
    const ids = ['selectedAreaName','selectedHeatAreaName','selectedFrostAreaName'];
    ids.forEach(id=>{
      const el = document.getElementById(id);
      if(el) el.textContent = basin;
    });
  }catch(_){}

  refreshScenarioPanels();
}

/* ===== Scenario mini-metrics (read-only) from latest primary sample ===== */
function __numFromText(txt){
  if(txt == null) return null;
  const s = String(txt).replace(',', '.');
  const m = s.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}
function __fmt(v, unit=''){
  if(v==null || !Number.isFinite(v)) return '—';
  const n = Math.round(v*10)/10;
  return `${n.toFixed(1)}${unit}`;
}
function __riskLabel(level, text){
  const map = {
    low:   "<span class='status-ok'>Χαμηλός</span>",
    med:   "<span class='status-warn'>Μέτριος</span>",
    high:  "<span class='status-fail'>Υψηλός</span>",
    ext:   "<span class='status-extreme'>Ακραίος</span>",
    none:  "<span style='color:#6b7a86'>—</span>"
  };
  return map[level] ? map[level] + (text ? ` <span style="color:#6b7a86;font-weight:700">${text}</span>` : '') : (text || '—');
}
function getLatestPrimarySample(){
  // Prefer the most recent snapshot (even if the history row was updated in-place).
  try{
    if(window.__PRIMARY_LATEST_SAMPLE && typeof window.__PRIMARY_LATEST_SAMPLE === 'object'){
      return window.__PRIMARY_LATEST_SAMPLE;
    }
  }catch(_){}

  try{
    if(typeof stationSeries !== 'undefined' && Array.isArray(stationSeries) && stationSeries.length){
      return stationSeries[stationSeries.length-1];
    }
    if(window.stationSeries && Array.isArray(window.stationSeries) && window.stationSeries.length){
      return window.stationSeries[window.stationSeries.length-1];
    }
  }catch(_){}
  return null;
}

function refreshScenarioPanels(){
  const s = getLatestPrimarySample();
  if(!s){
    // keep panels clean if nothing loaded yet
    ['windNow','windDir','windRisk','heatTempNow','heatIndexNow','heatRisk','frostTempNow','frostChillNow','frostRisk','iceRisk']
      .forEach(id=>{ const el=document.getElementById(id); if(el) el.innerHTML='—'; });
    return;
  }

  // ---- WIND ----
  const windTxt = (s.wind != null) ? String(s.wind) : '';
  const wKmh = (typeof s.windKmh === 'number') ? s.windKmh
            : (typeof s.wind_kmh === 'number') ? s.wind_kmh
            : __numFromText(windTxt);
  let wDir = '—';
  try{
    const toks = windTxt.trim().split(/\s+/);
    if(toks.length>=2){
      const last = toks[toks.length-1];
      if(/[NSEWΑ-Ω]/i.test(last)) wDir = last;
    }
  }catch(_){}

  const warnK = Number(document.getElementById('windWarnKmh')?.value);
  const highK = Number(document.getElementById('windHighKmh')?.value);

  let wLevel = 'none';
  if(Number.isFinite(wKmh)){
    if(Number.isFinite(highK) && wKmh >= highK) wLevel = 'high';
    else if(Number.isFinite(warnK) && wKmh >= warnK) wLevel = 'med';
    else wLevel = 'low';
  }

  const windNowEl = document.getElementById('windNow');
  if(windNowEl) windNowEl.textContent = Number.isFinite(wKmh) ? __fmt(wKmh, ' km/h') : (windTxt || '—');
  const windDirEl = document.getElementById('windDir');
  if(windDirEl) windDirEl.textContent = wDir;
  const windRiskEl = document.getElementById('windRisk');
  if(windRiskEl) windRiskEl.innerHTML = __riskLabel(wLevel);

  // ---- HEATWAVE ----
  const t = (typeof s.temp === 'number') ? s.temp : ((typeof s.temperature === 'number') ? s.temperature : null);
  const hi = (typeof s.heat === 'number') ? s.heat : null;
  const warnHI = Number(document.getElementById('heatWarnHI')?.value);
  const highHI = Number(document.getElementById('heatHighHI')?.value);

  let hLevel = 'none';
  if(Number.isFinite(hi)){
    if(Number.isFinite(highHI) && hi >= highHI) hLevel = 'high';
    else if(Number.isFinite(warnHI) && hi >= warnHI) hLevel = 'med';
    else hLevel = 'low';
  }else if(Number.isFinite(t)){
    // fallback: use temp thresholds if HI missing
    if(t >= 40) hLevel = 'high';
    else if(t >= 35) hLevel = 'med';
    else hLevel = 'low';
  }

  const heatTempEl = document.getElementById('heatTempNow');
  if(heatTempEl) heatTempEl.textContent = Number.isFinite(t) ? __fmt(t,' °C') : '—';
  const heatIdxEl = document.getElementById('heatIndexNow');
  if(heatIdxEl) heatIdxEl.textContent = Number.isFinite(hi) ? __fmt(hi,' °C') : '—';
  const heatRiskEl = document.getElementById('heatRisk');
  if(heatRiskEl) heatRiskEl.innerHTML = __riskLabel(hLevel);

  // ---- FROST / SNOW ----
  const chill = (typeof s.chill === 'number') ? s.chill : null;
  const rr = (typeof s.rainRate === 'number') ? s.rainRate : ((typeof s.rr === 'number') ? s.rr : null);

  const t0 = Number(document.getElementById('frostTemp0')?.value);
  const tHigh = Number(document.getElementById('frostTempHigh')?.value);

  let fLevel = 'none';
  if(Number.isFinite(t)){
    if(Number.isFinite(tHigh) && t <= tHigh) fLevel = 'high';
    else if(Number.isFinite(t0) && t <= t0) fLevel = 'med';
    else if(t <= 2) fLevel = 'low';
    else fLevel = 'low';
  }

  let iceLevel = 'none';
  if(Number.isFinite(t) && t <= (Number.isFinite(t0) ? t0 : 0) && Number.isFinite(rr) && rr > 0){
    iceLevel = 'high';
  }else if(Number.isFinite(t) && t <= 1){
    iceLevel = 'med';
  }else{
    iceLevel = 'low';
  }

  const frostTempEl = document.getElementById('frostTempNow');
  if(frostTempEl) frostTempEl.textContent = Number.isFinite(t) ? __fmt(t,' °C') : '—';
  const frostChillEl = document.getElementById('frostChillNow');
  if(frostChillEl) frostChillEl.textContent = Number.isFinite(chill) ? __fmt(chill,' °C') : '—';
  const frostRiskEl = document.getElementById('frostRisk');
  if(frostRiskEl) frostRiskEl.innerHTML = __riskLabel(fLevel);
  const iceRiskEl = document.getElementById('iceRisk');
  if(iceRiskEl) iceRiskEl.innerHTML = __riskLabel(iceLevel, (Number.isFinite(rr) ? `(υετός ${__fmt(rr,' mm/h')})` : ''));
}
}


/* ====== Scenario UI helper: show '—' when no scenario is selected (dropdown on placeholder) ====== */
function setScenarioSummaryPlaceholder(isPlaceholder){
  try{
    const root = document.getElementById('scenarioArea');
    if(!root) return;

    // restore default names
    root.querySelectorAll('.scenario-name[data-scn-name]').forEach(el=>{
      const base = (el.dataset && el.dataset.scnName) ? el.dataset.scnName : null;
      if(base != null) el.textContent = base;
    });

    if(isPlaceholder){
      const active = root.querySelector('.scenario-panel.active .scenario-name[data-scn-name]');
      if(active) active.textContent = '—';
    }
  }catch(_){}
}

// ====== Scenario dropdown: becomes green only after user selection ======
const LS_MODEL_SCENARIO = 'NIREAS_MODEL_SCENARIO';
const LS_MODEL_SCENARIO_TOUCHED = 'NIREAS_MODEL_SCENARIO_TOUCHED';

function loadScenarioState(){
  const sel = document.getElementById('modelScenario');
  if(!sel) return;

  // Always start with the initial (placeholder) indication when NIREAS opens
  sel.value = '';
  sel.classList.remove('scenario-active');

  // Default scenario logic (keeps panels/outputs consistent) until user picks something
  setModelScenario('');

  
  try{ setScenarioSummaryPlaceholder(true); }catch(_){ }
// Clear persisted "touched/selected" so the dropdown stays neutral on every fresh open
  try{
    localStorage.removeItem(LS_MODEL_SCENARIO);
    localStorage.removeItem(LS_MODEL_SCENARIO_TOUCHED);
  }catch(e){}
}

function onScenarioChange(sel){
  if(!sel) return;

  const v = String(sel.value || '');

  // Placeholder selected -> keep initial (grey) look and clear persisted selection
  if(!v){
    setModelScenario('');
    sel.classList.remove('scenario-active');
    
    try{ setScenarioSummaryPlaceholder(true); }catch(_){ }
try{
      localStorage.removeItem(LS_MODEL_SCENARIO);
      localStorage.removeItem(LS_MODEL_SCENARIO_TOUCHED);
    }catch(e){}
    return;
  }

  setModelScenario(v);


  try{ setScenarioSummaryPlaceholder(false); }catch(_){ }

  // Turn green only after the user actively makes a choice
  sel.classList.add('scenario-active');
  try{
    localStorage.setItem(LS_MODEL_SCENARIO, v);
    localStorage.setItem(LS_MODEL_SCENARIO_TOUCHED, '1');
  }catch(e){}
}


/* ===== Local Scenario toggle (for future local parameters) ===== */
let LOCAL_SCENARIO_ON = false;

function updateLocalScenarioBtn(){
  const btn = document.getElementById('btnLocalScenario');
  const cb  = document.getElementById('localScenarioToggle');
  if(cb) LOCAL_SCENARIO_ON = !!cb.checked;

  if(btn){
    btn.classList.toggle('btn-local-on', LOCAL_SCENARIO_ON);
    btn.classList.toggle('btn-local-off', !LOCAL_SCENARIO_ON);
    btn.textContent = LOCAL_SCENARIO_ON ? 'Local Scenario ON' : 'Local Scenario OFF';
  }
  document.body.dataset.localScenario = LOCAL_SCENARIO_ON ? 'on' : 'off';
}

function toggleLocalScenario(){
  const cb  = document.getElementById('localScenarioToggle');
  if(cb){
    cb.checked = !cb.checked;
    try{ cb.dispatchEvent(new Event('change', {bubbles:true})); }catch(_){}
  }else{
    LOCAL_SCENARIO_ON = !LOCAL_SCENARIO_ON;
  }
  updateLocalScenarioBtn();
  setStationMsg(LOCAL_SCENARIO_ON ? 'Local Scenario: ON' : 'Local Scenario: OFF');
}





/* ===== Reset Parameters (Παράμετροι) to defaults ===== */
function resetParametersToDefaults(){
  // 1) Scenario dropdown back to placeholder (keeps internal default scenario as rain)
  try{
    const sel = document.getElementById('modelScenario');
    if(sel){
      sel.value = '';
      onScenarioChange(sel);
    }else{
      try{ setModelScenario(''); }catch(_){}
    }
  }catch(_){}

  // 2) Clear Co‑Hazards selections
  try{
    if(typeof window.clearCoHazards === 'function') window.clearCoHazards();
  }catch(_){}

  // 3) Live OFF
  try{
    if(typeof stationLiveOn !== 'undefined' && stationLiveOn) toggleLive();
  }catch(_){}

  // 4) Local Scenario OFF
  try{
    const cb = document.getElementById('localScenarioToggle');
    if(cb) cb.checked = false;
    LOCAL_SCENARIO_ON = false;
    updateLocalScenarioBtn();
  }catch(_){}

  // 5) AI provider back to ChatGPT
  try{ setAITarget('chatgpt'); }catch(_){}

  // Persist UI (if enabled)
  try{ scheduleSaveUiState(); }catch(_){}

  try{ setStationMsg('Παράμετροι: επαναφορά στις προεπιλογές.'); }catch(_){}
}


/* ===================== RESET HELPERS (per-line resets) ===================== */
function resetPrimaryStationQuick(){
  try{
    ACTIVE_PRIMARY_URL = '';
    ACTIVE_PRIMARY_NAME = '';
    try{ refreshSelectedMeteoMarkers(); }catch(_){ }
    const sel = document.getElementById('meteoStationSelect');
    if(sel){
      sel.value = '';
      sel.dispatchEvent(new Event('change'));
    }
    // Clear main station display
    setTxt('stationName','—');
    setTxt('stationTimestamp','—');
    setTxt('stationTimestampInline','—');
    try{ updateStationFreshnessUI(); }catch(_){}
    try{ updatePrimaryMetaCoords(); }catch(_){}
    setTxt('stationRainRate','—');
    setTxt('stationDP','—');
    setTxt('stationR60','—');
    try{ setLatestValuesDisplay(null,'—'); }catch(_){}
    try{ setStationMsg('—'); }catch(_){}
    try{ switchSeriesContext('open-meteo'); }catch(_){}
    try{
      if(typeof watchlist !== 'undefined' && watchlist && watchlist.size){
        updatePrimaryStatus('Κύριος: (καθαρίστηκε)', 'neutral');
      }else{
        updatePrimaryStatus('Κύριος: (δεν έχει επιλεγεί)', 'warn');
      }
    }catch(_){}
  }catch(e){
    console.warn('resetPrimaryStationQuick failed', e);
  }
}

function resetSelectedBoundary(){
  try{
    SELECTED_BOUNDARY_GEO = null;
    SELECTED_BOUNDARY_KEY = null;
    SELECTED_BOUNDARY_NAME = null;
    try{ setSelectedBoundaryLabel(null); }catch(_){}
    try{ if(typeof scheduleSaveUiState==='function') scheduleSaveUiState(); }catch(_){}
  }catch(e){ console.warn('resetSelectedBoundary failed', e); }
}

function resetSelectedStream(){
  try{
    SELECTED_STREAM_GEO = null;
    SELECTED_STREAM_KEY = null;
    SELECTED_STREAM_NAME = null;
    try{ setSelectedStreamLabel(null); }catch(_){}
    try{ if(typeof scheduleSaveUiState==='function') scheduleSaveUiState(); }catch(_){}
  }catch(e){ console.warn('resetSelectedStream failed', e); }
}

function resetSelectedZone(){
  try{
    SELECTED_BASIN_KEY = null;
    SELECTED_ZONE_KEY = null;
    SELECTED_ZONE_NAME = null;
    SELECTED_ZONE_KIND = null;
    try{ setSelectedZoneLabels(null); }catch(_){}
    try{ if(typeof scheduleSaveUiState==='function') scheduleSaveUiState(); }catch(_){}
  }catch(e){ console.warn('resetSelectedZone failed', e); }
}

function resetScenarioPanel(panelId){
  try{
    const root = document.getElementById(panelId);
    if(!root) return;

    // Reset standard form controls to their default values
    root.querySelectorAll('input, select, textarea').forEach(el=>{
      try{
        const tag = (el.tagName||'').toUpperCase();
        if(tag === 'SELECT'){
          const opts = Array.from(el.options||[]);
          const di = opts.findIndex(o=>o.defaultSelected);
          el.selectedIndex = (di>=0) ? di : 0;
        }else if(el.type === 'checkbox' || el.type === 'radio'){
          el.checked = el.defaultChecked;
        }else{
          el.value = el.defaultValue;
        }
        el.dispatchEvent(new Event('input', {bubbles:true}));
        el.dispatchEvent(new Event('change', {bubbles:true}));
      }catch(_){}
    });

    // Special: reset manual stream y (if present)
    try{ if(typeof resetStrY === 'function' && root.querySelector('#strY')) resetStrY(); }catch(_){}

    // Recompute / refresh UI
    try{ if(typeof runMasterCalculation==='function') runMasterCalculation(); }catch(_){}
    try{ if(typeof refreshScenarioPanels==='function') refreshScenarioPanels(); }catch(_){}
  }catch(e){
    console.warn('resetScenarioPanel failed', e);
  }
}
/* ===================== /RESET HELPERS ===================== */





/* ===================== UI PERSISTENCE (keep values on refresh) ===================== */
const LS_UI_STATE_KEY = 'nireas_ui_state_v1';

let __uiSaveTimer = null;
function scheduleSaveUiState(){
  if(__uiSaveTimer) clearTimeout(__uiSaveTimer);
  __uiSaveTimer = setTimeout(saveUiStateNow, 250); // debounce
}

function getSavedUiState(){
  try{
    const raw = localStorage.getItem(LS_UI_STATE_KEY);
    if(!raw) return null;
    const st = JSON.parse(raw);
    return (st && typeof st === 'object') ? st : null;
  }catch(_){
    return null;
  }
}

function saveUiStateNow(){
  try{
    const state = {};

    // Save all inputs/selects/textareas that have an id
    document.querySelectorAll('input[id], select[id], textarea[id]').forEach(el => {
      const tag = el.tagName.toLowerCase();
      const type = (el.type || '').toLowerCase();

      // skip buttons
      if(tag === 'input' && (type === 'button' || type === 'submit' || type === 'reset')) return;

      if(type === 'checkbox' || type === 'radio'){
        state[el.id] = { t: type, v: !!el.checked };
      }else{
        state[el.id] = { t: 'value', v: el.value };
      }

      // keep manual flag for strY
      if(el.id === 'strY'){
        state.__strYManual = (el.dataset.manual === 'true');
      }
    });

    // Save selected zone (basin/boundary) + visible layers (GeoJSON project state)
    state.__selectedZoneKey = SELECTED_BASIN_KEY || null;
    state.__selectedZoneName = SELECTED_ZONE_NAME || document.getElementById('selectedBasinName')?.innerText || null;
    state.__selectedZoneKind = (SELECTED_BASIN_KEY ? 'basin' : null);
    state.__selectedBoundaryKey = SELECTED_BOUNDARY_KEY || null;
    state.__selectedBoundaryName = SELECTED_BOUNDARY_NAME || document.getElementById('selectedBoundaryName')?.innerText || null;
    state.__selectedStreamKey = SELECTED_STREAM_KEY || null;
    state.__selectedStreamName = SELECTED_STREAM_NAME || document.getElementById('selectedStreamName')?.innerText || null;

    // AOI (Area of Interest)
    try{
      const type = document.getElementById('aoiType')?.value || (AOI_STATE?.type || 'municipality');
      const paths = Array.isArray(AOI_STATE?.paths) ? AOI_STATE.paths : [];
      const names = Array.isArray(AOI_STATE?.names) ? AOI_STATE.names : paths.map(aoiNameFromPath);
      state.__aoi = (AOI_STATE && AOI_STATE.selected) ? { type, selected: ensureAoiSelectedShape(AOI_STATE.selected) } : { type, paths, names };
    }catch(_){ }

    // backward compatibility (older state keys)
    state.__selectedBasinKey = SELECTED_BASIN_KEY || null;
    state.__selectedBasinName = document.getElementById('selectedBasinName')?.innerText || null;
    state.__visiblePaths = Array.from(VISIBLE || []);
    state.__meteoPrimaryVisible = !!METEO_PRIMARY_VISIBLE;
    state.__meteoWatchVisible = !!METEO_WATCH_VISIBLE;
    // backward compatibility (older single-toggle state)
    state.__meteoStationsVisible = !!(METEO_PRIMARY_VISIBLE || METEO_WATCH_VISIBLE);


    localStorage.setItem(LS_UI_STATE_KEY, JSON.stringify(state));
  }catch(_){}
}

function restoreUiStateEarly(){
  // Only things needed BEFORE renderFileList(): VISIBLE (On/Off buttons)
  const st = getSavedUiState();
  if(!st) return;

  if(Array.isArray(st.__visiblePaths)){
    try{
      VISIBLE.clear();
      st.__visiblePaths.forEach(p => { if(p) VISIBLE.add(String(p)); });
    }catch(_){}
  }
  // AOI state (so the AOI list renders with the saved checks)
  try{
    if(st.__aoi){
      const type = normalizeAdminAreaType(st.__aoi.type || 'municipality');

      if(st.__aoi.selected){
        const selected = ensureAoiSelectedShape(st.__aoi.selected);
        AOI_STATE = { type, selected, paths: [], names: [], items: [] };
      }else{
        // legacy
        const paths = Array.isArray(st.__aoi.paths) ? st.__aoi.paths : [];
        const names = Array.isArray(st.__aoi.names) ? st.__aoi.names : paths.map(aoiNameFromPath);
        AOI_STATE = { type, paths, names };
      }
    }
  }catch(_){}

  // restore meteo layer states (independent)
  if(typeof st.__meteoPrimaryVisible === 'boolean') METEO_PRIMARY_VISIBLE = !!st.__meteoPrimaryVisible;
  if(typeof st.__meteoWatchVisible === 'boolean') METEO_WATCH_VISIBLE = !!st.__meteoWatchVisible;

  // backward compatibility: older single toggle
  if(typeof st.__meteoPrimaryVisible !== 'boolean' && typeof st.__meteoWatchVisible !== 'boolean' && typeof st.__meteoStationsVisible === 'boolean'){
    METEO_PRIMARY_VISIBLE = !!st.__meteoStationsVisible;
    METEO_WATCH_VISIBLE = !!st.__meteoStationsVisible;
  }
}

function restoreUiFieldsFromState(st){
  const pendingSelects = [];
  const selectsToNotify = [];

  for(const [id, pack] of Object.entries(st)){
    if(id.startsWith('__')) continue;

    const el = document.getElementById(id);
    if(!el) continue;

    const tag = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();

    const t = (pack && typeof pack === 'object' && 't' in pack) ? pack.t : 'value';
    const v = (pack && typeof pack === 'object' && 'v' in pack) ? pack.v : pack;

    if(t === 'checkbox' || t === 'radio'){
      el.checked = !!v;
    }else{
      const val = String(v ?? '');
      if(tag === 'select'){
        const hasOpt = Array.from(el.options).some(o => o.value === val);
        if(!hasOpt) pendingSelects.push({ el, val });
        else el.value = val;
        selectsToNotify.push(el);
      }else{
        el.value = val;
      }
    }

    if(id === 'strY'){
      if(st.__strYManual) el.dataset.manual = 'true';
      else delete el.dataset.manual;
    }
  }

  // apply deferred selects now, and later once options are populated
  window.__NIREAS_PENDING_SELECTS = pendingSelects;
  window.__NIREAS_SELECTS_TO_NOTIFY = selectsToNotify;
  applyPendingRestores();
}

function applyPendingRestores(retries=6){
  const pending = window.__NIREAS_PENDING_SELECTS || [];
  if(pending.length){
    window.__NIREAS_PENDING_SELECTS = pending.filter(({el, val}) => {
      const hasOpt = Array.from(el.options).some(o => o.value === val);
      if(hasOpt) el.value = val;
      return !hasOpt;
    });
  }

  const notify = window.__NIREAS_SELECTS_TO_NOTIFY || [];
  if(notify.length){
    notify.forEach(el => {
      try{ el.dispatchEvent(new Event('change', { bubbles:true })); }catch(_){}
    });
    window.__NIREAS_SELECTS_TO_NOTIFY = [];
  }

  // If selects weren't ready yet, retry a few times (stations/lists load async)
  const remaining = (window.__NIREAS_PENDING_SELECTS || []).length;
  if(remaining && retries > 0){
    setTimeout(()=> applyPendingRestores(retries-1), 350);
  }
}

async function restoreUiStateLate(){
  // Restore last selected basin (GeoJSON) + all fields
  const st = getSavedUiState();
  if(!st) return;

  // 1) Restore last selections:
  //    - "Επιλεγμένη περιοχή/ζώνη" παίρνει τιμή ΜΟΝΟ από basins
  //    - "Διοικητικά Όρια" παίρνει τιμή ΜΟΝΟ από boundaries
  const basinKey = st.__selectedBasinKey
    || (st.__selectedZoneKey && String(st.__selectedZoneKey).includes('data/basins/') ? st.__selectedZoneKey : null);

  const basinName = st.__selectedBasinName || st.__selectedZoneName || null;

  if(basinKey){
    try{
      const key = String(basinKey);
      const name = basinName || key.split('/').pop().replace('.geojson','');
      if(typeof loadToTool === 'function'){
        await loadToTool(key, name);
      }else{
        try{ setSelectedZoneLabels(name); }catch(_){}
        SELECTED_BASIN_KEY = key;
        SELECTED_ZONE_KEY = key;
        SELECTED_ZONE_NAME = name;
        SELECTED_ZONE_KIND = 'basin';
      }
    }catch(_){}
  } else if(basinName){
    try{ setSelectedZoneLabels(basinName); }catch(_){}
  }

  const boundaryKey = st.__selectedBoundaryKey
    || (st.__selectedZoneKey && String(st.__selectedZoneKey).includes('data/boundaries/') ? st.__selectedZoneKey : null);

  const boundaryName = st.__selectedBoundaryName || null;

  if(boundaryKey){
    try{
      const key = String(boundaryKey);
      const name = boundaryName || key.split('/').pop().replace('.geojson','');
      if(typeof loadToTool === 'function'){
        await loadToTool(key, name);
      }else{
        try{ setSelectedBoundaryLabel(name); }catch(_){}
        SELECTED_BOUNDARY_KEY = key;
        SELECTED_BOUNDARY_NAME = name;
      }
    }catch(_){}
  } else if(boundaryName){
    try{ setSelectedBoundaryLabel(boundaryName); }catch(_){}
  }


  const streamKey = st.__selectedStreamKey || null;
  const streamName = st.__selectedStreamName || null;

  if(streamKey){
    try{
      const key = String(streamKey);
      const name = streamName || key.split('/').pop().replace('.geojson','');
      if(typeof loadToTool === 'function'){
        await loadToTool(key, name);
      }else{
        try{ setSelectedStreamLabel(name); }catch(_){}
        SELECTED_STREAM_KEY = key;
        SELECTED_STREAM_NAME = name;
      }
    }catch(_){}
  } else if(streamName){
    try{ setSelectedStreamLabel(streamName); }catch(_){}
  }

  // Restore last selected administrative boundary (independent from the main zone)
  try{
    if(st.__selectedBoundaryKey){
      SELECTED_BOUNDARY_KEY = String(st.__selectedBoundaryKey);
      const nm = st.__selectedBoundaryName || SELECTED_BOUNDARY_KEY.split('/').pop().replace('.geojson','');
      SELECTED_BOUNDARY_NAME = nm;
      setSelectedBoundaryLabel(nm);
    }else if(st.__selectedBoundaryName){
      SELECTED_BOUNDARY_NAME = String(st.__selectedBoundaryName);
      setSelectedBoundaryLabel(SELECTED_BOUNDARY_NAME);
    }
  }catch(_){}




  // Restore last selected hydrographic network (independent)
  try{
    if(st.__selectedStreamKey){
      SELECTED_STREAM_KEY = String(st.__selectedStreamKey);
      const nm = st.__selectedStreamName || SELECTED_STREAM_KEY.split('/').pop().replace('.geojson','');
      SELECTED_STREAM_NAME = nm;
      setSelectedStreamLabel(nm);
    }else if(st.__selectedStreamName){
      SELECTED_STREAM_NAME = String(st.__selectedStreamName);
      setSelectedStreamLabel(SELECTED_STREAM_NAME);
    }
  }catch(_){}

  // 2) Restore all tool fields
  restoreUiFieldsFromState(st);

  // 3) Re-render file list so On/Off buttons match (in case state loaded after first render)
  try{ renderFileList(); }catch(_){}
  try{ renderBoundariesList(); }catch(_){ }
  try{ renderAOIList(); }catch(_){ }
  try{ restoreAOIFromSavedState(st); }catch(_){ }
  try{ updateMeteoStationsRowButton(); }catch(_){}

  // 4) Ensure calculations reflect restored values
  try{ runMasterCalculation(); }catch(_){}
  try{ drawBasinPlan(); }catch(_){}
}

function bindPersistenceOnce(){
  if(window.__NIREAS_PERSIST_BOUND) return;
  window.__NIREAS_PERSIST_BOUND = true;

  // Save on any field change (captures most UI)
  document.addEventListener('input', (ev)=>{ if(ev.target && ev.target.id) scheduleSaveUiState(); }, true);
  document.addEventListener('change', (ev)=>{ if(ev.target && ev.target.id) scheduleSaveUiState(); }, true);

  // Ensure strY becomes manual when user types (bound once)
  const strYEl = document.getElementById('strY');
  if(strYEl && strYEl.dataset.boundManual !== '1'){
    strYEl.dataset.boundManual = '1';
    strYEl.addEventListener('input', ()=>{ strYEl.dataset.manual = 'true'; scheduleSaveUiState(); });
  }
}
/* =================== /UI PERSISTENCE =================== */


function setCustomMsg(msg){
  const el = document.getElementById('customStationMsg');
  if(el) el.textContent = msg;
}

function saveWatchlist(){
  try{
    const arr = Array.from(watchlist.entries()).map(([url,name]) => ({url, name}));
    localStorage.setItem(LS_WATCHLIST_KEY, JSON.stringify(arr));
  }catch(e){}
}

function loadWatchlist(){
  try{
    const raw = localStorage.getItem(LS_WATCHLIST_KEY);
    if(!raw) return;
    const arr = JSON.parse(raw);
    if(!Array.isArray(arr)) return;
    watchlist.clear();
    for(const it of arr){
      if(it && it.url){
        watchlist.set(String(it.url), String(it.name || it.url));
      }
    }
  }catch(e){}
}

function getCustomStations(){
  try{
    const raw = localStorage.getItem(LS_CUSTOM_KEY);
    if(!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  }catch(e){ return []; }
}

function saveCustomStations(arr){
  try{
    localStorage.setItem(LS_CUSTOM_KEY, JSON.stringify(arr || []));
  }catch(e){}
}

function ensureCustomOptgroup(selectEl){
  if(!selectEl) return null;
  // try to find existing optgroup by label
  const groups = Array.from(selectEl.querySelectorAll('optgroup'));
  let grp = groups.find(g => (g.label || '').toLowerCase().includes('custom'));
  if(!grp){
    grp = document.createElement('optgroup');
    grp.label = 'Custom (Local)';
    selectEl.appendChild(grp);
  }
  return grp;
}

function upsertCustomOption(name, url){
  const normalized = normalizeStationUrl(url);
  if(!normalized) return;

  const ids = ['meteoStationSelect','monitorStationSelect'];
  ids.forEach(id=>{
    const sel = document.getElementById(id);
    if(!sel) return;

    const existing = Array.from(sel.options).find(o => o.value === normalized);
    if(existing){
      if(name && existing.textContent !== name) existing.textContent = name;
      return;
    }

    const grp = ensureCustomOptgroup(sel);
    const opt = document.createElement('option');
    opt.value = normalized;
    opt.textContent = (name || normalized.replace(/^https?:\/\//i,'').slice(0,60));
    opt.dataset.from = 'local';
    grp.appendChild(opt);
  });
}

function loadCustomStationsIntoSelect(){
  const list = getCustomStations();
  if(!list.length) return;
  for(const it of list){
    if(!it || !it.url) continue;
    upsertCustomOption(it.name || '', it.url);
  }
}

function addCustomStation(){
  const nameEl = document.getElementById('customStationName');
  const urlEl  = document.getElementById('customStationUrl');
  const name = (nameEl?.value || '').trim();
  const urlRaw = (urlEl?.value || '').trim();
  if(!urlRaw){
    setCustomMsg('Δώσε URL σταθμού.');
    return;
  }
  const url = normalizeStationUrl(urlRaw);
  if(!url){
    setCustomMsg('Μη έγκυρο URL.');
    return;
  }

  // save to custom list
  const list = getCustomStations();
  const exists = list.some(x => String(x?.url||'') === url);
  if(!exists){
    list.push({name: name || url.replace(/^https?:\/\//i,'').slice(0,60), url});
    saveCustomStations(list);
  }

  // also add to dropdown + watchlist immediately
  upsertCustomOption(name, url);
  watchlist.set(url, name || url.replace(/^https?:\/\//i,'').slice(0,60));
  renderWatchlist();
  saveWatchlist();

  // clear inputs
  if(nameEl) nameEl.value = '';
  if(urlEl) urlEl.value = '';

  setCustomMsg('✅ Προστέθηκε (τοπικά).');

  // immediately fetch to show data (extras only)
  fetchStationData('extras');
}


let stationLiveTimer = null;
let stationFreshnessTimer = null;
let lastStationPayload = null;

// Hardening: clean up timers + catch unhandled async errors
window.addEventListener('pagehide', () => {
  try{ if(stationLiveTimer){ clearInterval(stationLiveTimer); stationLiveTimer = null; }
       if(stationFreshnessTimer){ clearInterval(stationFreshnessTimer); stationFreshnessTimer = null; }
  }catch(_){}
});
window.addEventListener('beforeunload', () => {
  try{ if(stationLiveTimer){ clearInterval(stationLiveTimer); stationLiveTimer = null; }
       if(stationFreshnessTimer){ clearInterval(stationFreshnessTimer); stationFreshnessTimer = null; }
  }catch(_){}
});
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  try{
    updateMeteoStatus('Σφάλμα (promise). Δοκίμασε ξανά.');
    setStationMsg('Σφάλμα: ' + (event.reason?.message || String(event.reason || 'unknown')));
  }catch(_){}
  event.preventDefault();
});

/* ===================== UI HELPERS ===================== */
function toggleCollapse(id, btn){
  const el = document.getElementById(id);
  if(!el) return;

  const isHidden = el.classList.toggle('collapsed');

  // Update the +/- glyph
  if(btn) btn.textContent = isHidden ? '+' : '−';

  // Unified rounded-corner look when collapsed
  const card = (btn && btn.closest('.panel-card')) || el.closest('.panel-card');
  if(card){
    card.classList.toggle('is-collapsed', isHidden);
  }
}


function setStatusById(id, msg, level='neutral'){
  const el = document.getElementById(id);
  if(!el) return;
  el.innerText = msg;
  el.classList.remove('status-ok','status-warn','status-neutral');
  if(level==='ok') el.classList.add('status-ok');
  else if(level==='warn') el.classList.add('status-warn');
  else el.classList.add('status-neutral');
}
function updatePrimaryStatus(msg, level='neutral'){
  setStatusById('primaryStatus', msg, level);
}
function updateExtrasStatus(msg, level='neutral'){
  setStatusById('extrasStatus', msg, level);
}
// backward compatibility (sets both)
function updateMeteoStatus(msg, level='neutral'){
  // Optional informational message area for the METEO section.
  // HIDDEN by default to avoid a lone "—" separator.
  // Shows only for warnings/errors (does NOT touch the two independent status pills).
  const el = document.getElementById('meteoMsg');
  if(!el) return;

  const t = (msg == null) ? '' : String(msg).trim();
  const shouldShow = !!t && t !== '—' && (
    level === 'warn' ||
    /Σφάλμα/i.test(t) ||
    /Δεν\s+βρέθηκαν/i.test(t) ||
    /promise/i.test(t)
  );

  if(shouldShow){
    el.textContent = t;
    el.style.display = 'block';
  }else{
    el.textContent = '';
    el.style.display = 'none';
  }
}
function setStationMsg(msg){
  const el = document.getElementById('stationMsg');
  if(el) el.innerText = msg;
}
function setTxt(id, txt){ const el=document.getElementById(id); if(el) el.textContent = txt; if(id==='stationName'||id==='stationTimestampInline'||id==='stationLat'||id==='stationLon'||id==='stationElev') updateSeriesSummaryName(); }

/* ===== Clear/Reset confirmations (UI vs DB) =====
   Στόχος: ένα "Clear" ανά section, με μίνι επιβεβαίωση που εξηγεί ΤΙ καθαρίζεται.
   Σημ.: Τα παρακάτω ΔΕΝ διαγράφουν δεδομένα από Firestore. Καθαρίζουν μόνο UI/buffer/προβολή. */
function __confirmClear(title, lines, note){
  const footer = note || "Σημ.: Δεν διαγράφεται τίποτα από τη Βάση (DB). Καθαρίζεται μόνο η προσωρινή μνήμη/προβολή στον browser.";
  const body = (Array.isArray(lines) ? lines : [String(lines||'')]).join("\n");
  const msg = `${title}\n\n${body}\n\n${footer}`;
  return confirm(msg);
}

function confirmAndClearSeriesFiltersUI(){
  const ok = __confirmClear(
    "Clear – Ιστορικό Κύριου Σταθμού (UI)",
    [
      "• Θα καθαριστούν τα φίλτρα στη γραμμή φίλτρων.",
      "• Θα αδειάσει ο πίνακας προβολής.",
      "• Θα καθαριστεί η προσωρινή χρονοσειρά (buffer) του ενεργού κύριου σταθμού."
    ]
  );
  if(!ok) return;
  clearSeriesFiltersUI();
}

function confirmAndClearDbFiltersUI(){
  const ok = __confirmClear(
    "Clear – Ιστορικό από Βάση (DB) (Προβολή)",
    [
      "• Θα καθαριστούν τα φίλτρα στη γραμμή φίλτρων.",
      "• Θα αδειάσει ο πίνακας προβολής (cached rows)."
    ],
    "Σημ.: Δεν διαγράφεται τίποτα από τη Βάση (DB). Απλώς καθαρίζει η προβολή/φίλτρα στο UI."
  );
  if(!ok) return;
  clearDbFiltersUI();
}



/* ===== Station freshness (timestamp age) ===== */
function parseGreekDateTime(ts){
  if(!ts) return null;
  const s = String(ts).trim();
  if(!s || s==='—') return null;
  const parts = s.split(',');
  const dpart = (parts[0]||'').trim();
  const tpart = (parts[1]||'').trim();
  const d = dpart.split('/').map(n=>parseInt(n,10));
  const t = tpart.split(':').map(n=>parseInt(n,10));
  if(d.length<3 || isNaN(d[0]) || isNaN(d[1]) || isNaN(d[2])) return null;
  const dd=d[0], mm=d[1], yy=d[2];
  const HH=t[0]||0, MM=t[1]||0, SS=t[2]||0;
  const dt = new Date(yy, mm-1, dd, HH, MM, SS);
  if(isNaN(dt.getTime())) return null;
  return dt;
}

function ageClassFromTimestamp(tsStr){
  // Use parseAnyDateTime instead of strict parseGreekDateTime
  // This handles Greek formats, ISO, and standard formats robustly.
  const dt = parseAnyDateTime(tsStr); 

  if(!dt) return 'age-unknown';

  let diffMin = (Date.now() - dt.getTime()) / 60000;
  if(diffMin < 0) diffMin = 0; // Handle slight clock skew

  if(diffMin < 20) return 'age-fresh'; // Increased tolerance to 20m for "Fresh"
  if(diffMin < 60) return 'age-warn';
  return 'age-stale';
}

function updateStationFreshnessUI(){
  const nameEl = document.getElementById('stationName');
  if(!nameEl) return;

  nameEl.classList.remove('age-fresh','age-warn','age-stale','age-unknown');

  const tsStr = (document.getElementById('stationTimestamp')?.textContent || '').trim();
  const dt = parseGreekDateTime(tsStr);
  if(!dt){
    nameEl.classList.add('age-unknown');
    return;
  }
  let diffMin = (Date.now() - dt.getTime()) / 60000;
  if(diffMin < 0) diffMin = 0;

  if(diffMin < 5) nameEl.classList.add('age-fresh');
  else if(diffMin < 10) nameEl.classList.add('age-warn');
  else nameEl.classList.add('age-stale')
  try{ refreshScenarioPanels(); }catch(_){}
;
}

function startStationFreshnessTimer(){
  try{
    if(stationFreshnessTimer){ clearInterval(stationFreshnessTimer); }
    updateStationFreshnessUI();
    stationFreshnessTimer = setInterval(updateStationFreshnessUI, 30*1000);
  }catch(_){}
}
function updateSeriesSummaryName(){
  // Keep the Primary History header (monitoring table) in sync with the active PRIMARY station
  const name = (document.getElementById('stationName')?.textContent || '').trim();
  setTxt('seriesStationName', (name && name!=='—') ? name : '—');

  const ts = (document.getElementById('stationTimestampInline')?.textContent || '').trim();
  setTxt('seriesTimestampInline', (ts && ts!=='—') ? ts : '—');

  const lat = (document.getElementById('stationLat')?.textContent || '').trim();
  const lon = (document.getElementById('stationLon')?.textContent || '').trim();
  const elev = (document.getElementById('stationElev')?.textContent || '').trim();
  setTxt('seriesLat',  (lat  && lat!=='—')  ? lat  : '—');
  setTxt('seriesLon',  (lon  && lon!=='—')  ? lon  : '—');
  setTxt('seriesElev', (elev && elev!=='—') ? elev : '—');
}

// --- Station series context helpers (per *active* primary station) ---
// Active primary station applies ONLY after the user presses ➕
function getPrimaryStationUrl(){
  return ACTIVE_PRIMARY_URL || '';
}
function getPrimaryStationName(){
  return ACTIVE_PRIMARY_NAME || '';
}
// Pending (dropdown) selection - not applied until ➕
function getPendingPrimaryUrl(){
  return document.getElementById('meteoStationSelect')?.value || '';
}
function getPendingPrimaryName(){
  const sel = document.getElementById('meteoStationSelect');
  const url = sel?.value || '';
  if(!sel || !url) return '';
  return (sel.options[sel.selectedIndex]?.textContent || url).trim();
}
function getPrimaryStationKey(){
  const url = getPrimaryStationUrl();
  if(!url || url === OPEN_METEO_TOKEN) return 'open-meteo';
  return `url:${url}`;
}

function switchSeriesContext(newKey){
  const key = newKey || 'open-meteo';

  // save current context
  stationSeriesByKey[currentStationKey] = stationSeries;
  stationLastKeyByKey[currentStationKey] = stationLastKey;

  // load new context
  currentStationKey = key;
  stationSeries = stationSeriesByKey[currentStationKey] || [];
  stationLastKey = stationLastKeyByKey[currentStationKey]
    || (stationSeries.length ? stationSeries[stationSeries.length-1].key : null);

  // ensure stored
  stationSeriesByKey[currentStationKey] = stationSeries;
  stationLastKeyByKey[currentStationKey] = stationLastKey;

  // refresh readouts + list for the currently selected station
  updateStationReadouts();
}

function switchPrimarySeriesContext(){
  switchSeriesContext(getPrimaryStationKey());
}

function isFiniteNumber(x){ return typeof x === 'number' && isFinite(x); }
function num(val){
  if(val==null) return 0;
  const n = (typeof val === 'number') ? val : parseFloat(String(val).replace(',','.'));
  return isFiniteNumber(n) ? n : 0;
}
function getVal(id){ return num(document.getElementById(id)?.value); }
function setVal(id, v){
  const el = document.getElementById(id);
  if(!el) return;
  el.value = (v==null) ? "" : v;
}

function debounce(fn, wait=150){
  let t = null;
  return function(...args){
    if(t) clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}


/* ===================== GITHUB LOAD ===================== */
async function init(){
  document.getElementById('loader').style.display = 'block';
  try{
    const resp = await fetch(API_TREE);
    const data = await resp.json();
    if(data.message) throw new Error(data.message);

    const files = data.tree || [];

    // IMPORTANT: paths based on your current repo layout (from previous versions)
    // data/boundaries, data/streams, data/basins
    DATA_GROUPS.boundaries = files.filter(f => f.path.includes('data/boundaries/') && f.path.endsWith('.geojson'));
    DATA_GROUPS.streams    = files.filter(f => (f.path.includes('data/streams/') || f.path.includes('streams/geojson/')) && f.path.endsWith('.geojson'));
    DATA_GROUPS.basins     = files.filter(f => f.path.includes('data/basins/')     && f.path.endsWith('.geojson'));

    restoreUiStateEarly();
    initAIAnalysisUI();
    updateMeteoStationsRowButton();
    renderFileList();
    await loadAdminAreasRegistryFromTree(files);
    // upgrade older AOI saves (paths -> ids) once registry is available
    try{ upgradeLegacyAoiPathsToSelected(); computeAoiDerived(); }catch(_){ }
    renderBoundariesList();
    try{ renderAOIList(); }catch(_){ }
    try{ updateAOIUI(); }catch(_){ }

    // AOI type filter
    try{
      const el = document.getElementById('aoiType');
      if(el && !el.dataset.bound){
        el.addEventListener('change', ()=>{ renderAOIList(); });
        el.dataset.bound = 'true';
      }
    }catch(_){ }


    // Forecast sources (web links) from repo folder: data/forecast/forecast.txt
    try{ await loadForecastSourcesFromTree(files); }catch(e){ console.warn('Forecast Source load failed:', e); }

    // Water level sensors (web links) from repo folder: data/WaterLevelSensors/WaterLevelSensors.txt
    try{ await loadWaterLevelSourcesFromTree(files); }catch(e){ console.warn('Water Level Sensors load failed:', e); }

    // Human Resources (JSON) from repo folder: data/resources/human_resources.json
    try{ await loadHumanResourcesFromTree(files); }catch(e){ console.warn('HR load failed:', e); }
    try{ bindHumanResourcesUI(); }catch(_){ }

    // Vehicles (JSON) from repo folder: data/resources/vehicles.json
    try{ await loadVehiclesFromTree(files); }catch(e){ console.warn('Vehicles load failed:', e); }
    try{ bindVehiclesUI(); }catch(_){ }

    // Materials (JSON) from repo folder: data/resources/materials.json
    try{ await loadMaterialsFromTree(files); }catch(e){ console.warn('Materials load failed:', e); }
    try{ bindMaterialsUI(); }catch(_){ }

    // Auto-populate stations dropdown from folder structure:
// - data/meteostations/api/*.txt      -> API / JSON
// - data/meteostations/weblinks/*.txt -> Web Links
const loaded = await fetchStationsFromFolders(files);

if(!loaded){
  // Backward-compatible fallback (older layouts)
  const stationFile =
    files.find(f => f.path === 'data/meteostations/weblinks/stations.txt') ||
    files.find(f => f.path.endsWith('/stations.txt') || f.path.endsWith('stations.txt')) ||
    files.find(f => f.path.endsWith('openmeteo.txt')) ||
    files.find(f => f.path.endsWith('ecmwf.txt'));

  if(stationFile) await fetchStations(stationFile.path);
  else {
    updateMeteoStatus("Δεν βρέθηκαν αρχεία σταθμών (.txt) σε data/meteostations/api ή data/meteostations/weblinks");
    // safe fallback: keep dropdown empty
  }
}

    // Restore local custom stations + watchlist (no coding required)
    loadCustomStationsIntoSelect();
    loadWatchlist();
    renderWatchlist();

    // Keep values + selected GeoJSON after refresh
    bindPersistenceOnce();
    await restoreUiStateLate();

    bindInputs();
    runMasterCalculation();
    updateStationButtons();
    initMonitorContentToggle();
    loadScenarioState();
    try{ applyScenarioUI(MODEL_SCENARIO || (document.getElementById('modelScenario')?.value) || ''); }catch(_){}
    try{ refreshScenarioPanels(); }catch(_){}

    updateLocalScenarioBtn();
    startStationFreshnessTimer();

    // If dropdown has a pending selection (but no ACTIVE yet), show "αναμονή"
    const sel = document.getElementById('meteoStationSelect');
    if(sel && sel.value && !getPrimaryStationUrl()){
      updatePrimaryStatus('Κύριος: Αναμονή…', 'neutral');
    } else if(!getPrimaryStationUrl()){
      updatePrimaryStatus('Κύριος: (δεν έχει επιλεγεί)', 'warn');
    }

    // If no ACTIVE primary but watchlist exists, fetch extras immediately to show values
    if(!getPrimaryStationUrl() && watchlist.size){
      fetchStationData('extras');
    }

  }catch(e){
    console.error(e);
    updateMeteoStatus("Σφάλμα GitHub: " + e.message);
  }finally{
    document.getElementById('loader').style.display = 'none';
  }
}

function renderBoundariesList(){
  const tbody = document.getElementById('boundaryRows');
  const loader = document.getElementById('adminBoundsLoader');
  if(!tbody) return;

  tbody.innerHTML = '';

  const list = (DATA_GROUPS && Array.isArray(DATA_GROUPS.boundaries)) ? DATA_GROUPS.boundaries : [];
  if(loader){
    loader.style.display = list.length ? 'none' : 'block';
    if(!list.length) loader.textContent = 'Δεν βρέθηκαν διαθέσιμα αρχεία ορίων.';
  }

  list.forEach(f=>{
    const reg = ADMIN_AREAS_BY_FILE.get(f.path);
    const name = reg ? reg.name : f.path.split('/').pop().replace('.geojson','');
    const tr = document.createElement('tr');
    const on = VISIBLE.has(f.path);
    tr.innerHTML = `
      <td style="text-align:left;padding-left:10px;">${name}</td>
      <td><div class="actions-row">
        <button class="mini-btn btn-on" onclick="geoAddFromRow('boundaries','${f.path}','${name}')" title="➕ Προσθήκη στο κεντρικό panel">➕</button>
        <button class="mini-btn btn-gray" onclick="geoClearCategory('boundaries')" title="🧹 Εκκαθάριση από το κεντρικό panel">🧹</button>
        <button class="mini-btn btn-map" onclick="previewOnMap('${f.path}','${name}')" title="Προεπισκόπηση στον χάρτη (zoom), χωρίς αλλαγή On/Off"><span class="ico-map">🗺</span> Map</button>
        <button class="mini-btn map-only-btn ${on ? 'btn-on' : 'btn-off'}" id="btn-onoff-${cssSafe(f.path)}"
                onclick="toggleLayer('${f.path}','${name}')"><span class="ico-eye">👁</span> ${on ? 'On' : 'Off'}</button>
      </div></td>
    `;
    tbody.appendChild(tr);
  });
}


/* ===================== AOI (Area of Interest) ===================== */

// --- Admin Areas Registry helpers ---
function normalizeAdminAreaType(t){
  const s = String(t||'').toLowerCase().trim();
  if(s === 'region_unit') return 'pref_unit'; // legacy
  if(s === 'pref_unit' || s === 'municipality' || s === 'region') return s;
  return s;
}
function adminAreaIdFromEntry(e){
  const type = normalizeAdminAreaType(e?.type);
  if(type === 'municipality') return String(e?.municipality_id || '');
  if(type === 'pref_unit') return String(e?.pref_unit_id || '');
  if(type === 'region') return String(e?.region_id || '');
  return '';
}
function adminAreaKey(type, id){
  return `${normalizeAdminAreaType(type)}:${String(id||'')}`;
}
function buildAdminAreasMaps(){
  ADMIN_AREAS_BY_KEY = new Map();
  ADMIN_AREAS_BY_FILE = new Map();
  (ADMIN_AREAS_REGISTRY || []).forEach(e=>{
    const type = normalizeAdminAreaType(e.type);
    const id = adminAreaIdFromEntry(e);
    const file = String(e.file || '').trim();
    if(!type || !id) return;
    const key = adminAreaKey(type, id);
    ADMIN_AREAS_BY_KEY.set(key, e);
    if(file) ADMIN_AREAS_BY_FILE.set(file, e);
  });
}

async function loadAdminAreasRegistryFromTree(files){
  try{
    const f =
      (files||[]).find(x => x.path === 'data/boundaries/admin_areas_registry.json') ||
      (files||[]).find(x => x.path === 'data/boundaries/admin_areas_catalog.json') ||
      (files||[]).find(x => x.path.endsWith('/admin_areas_registry.json')) ||
      (files||[]).find(x => x.path.endsWith('/admin_areas_catalog.json'));

    if(!f){
      ADMIN_AREAS_REGISTRY = [];
      buildAdminAreasMaps();
      return;
    }

    const resp = await fetch(RAW_URL + f.path, { cache: 'no-store' });
    if(!resp.ok) throw new Error('Αποτυχία λήψης admin_areas_registry.json (HTTP ' + resp.status + ')');

    const json = await resp.json();
    if(!Array.isArray(json)) throw new Error('Το admin_areas_registry.json πρέπει να είναι JSON array');

    // Normalize entries
    ADMIN_AREAS_REGISTRY = json.map(raw=>{
      const type = normalizeAdminAreaType(raw?.type);
      const name = String(raw?.name || '').trim();
      const file = String(raw?.file || '').trim();
      const hasMembers = Array.isArray(raw?.municipality_ids) || Array.isArray(raw?.pref_unit_ids);
      // For municipality we require a GeoJSON file. For pref_unit/region we allow:
      // - GeoJSON boundary (file), OR
      // - group-only entry with members (municipality_ids / pref_unit_ids)
      if(!type || !name) return null;
      if(type === 'municipality' && !file) return null;
      if((type === 'pref_unit' || type === 'region') && !file && !hasMembers) return null;

      const e = { ...raw, type, name, file };

      // enforce id field by type
      const id = adminAreaIdFromEntry(e);
      if(!id) return null;
      if(type === 'municipality') e.municipality_id = id;
      if(type === 'pref_unit') e.pref_unit_id = id;
      if(type === 'region') e.region_id = id;

      // Normalize optional membership lists (for inheritance / expansion)
      if(Array.isArray(e.municipality_ids)) e.municipality_ids = e.municipality_ids.map(String).map(s=>s.trim()).filter(Boolean);
      else e.municipality_ids = undefined;
      if(Array.isArray(e.pref_unit_ids)) e.pref_unit_ids = e.pref_unit_ids.map(String).map(s=>s.trim()).filter(Boolean);
      else e.pref_unit_ids = undefined;

      return e;
    }).filter(Boolean);

    buildAdminAreasMaps();

  }catch(e){
    console.warn('Admin areas registry load failed:', e);
    ADMIN_AREAS_REGISTRY = [];
    buildAdminAreasMaps();
  }
}

function emptyAoiSelected(){
  return { municipality_ids: [], pref_unit_ids: [], region_ids: [] };
}
function ensureAoiSelectedShape(sel){
  const out = emptyAoiSelected();
  if(!sel || typeof sel !== 'object') return out;
  if(Array.isArray(sel.municipality_ids)) out.municipality_ids = sel.municipality_ids.map(String).filter(Boolean);
  if(Array.isArray(sel.pref_unit_ids)) out.pref_unit_ids = sel.pref_unit_ids.map(String).filter(Boolean);
  if(Array.isArray(sel.region_ids)) out.region_ids = sel.region_ids.map(String).filter(Boolean);
  return out;
}
function computeAoiDerived(){
  // Keep backward-compatible paths/names for map overlay and UI.
  const sel = ensureAoiSelectedShape(AOI_STATE?.selected);
  const items = [];

  sel.municipality_ids.forEach(id=>{
    const e = ADMIN_AREAS_BY_KEY.get(adminAreaKey('municipality', id));
    if(e) items.push(e);
  });
  sel.pref_unit_ids.forEach(id=>{
    const e = ADMIN_AREAS_BY_KEY.get(adminAreaKey('pref_unit', id));
    if(e) items.push(e);
  });
  sel.region_ids.forEach(id=>{
    const e = ADMIN_AREAS_BY_KEY.get(adminAreaKey('region', id));
    if(e) items.push(e);
  });

  AOI_STATE.items = items;
  AOI_STATE.paths = items.map(e=> e.file).filter(Boolean);
  AOI_STATE.names = items.map(e=> e.name).filter(Boolean);
}


function computeAoiExpanded(){
  // Expanded coverage for filtering (inheritance):
  // region -> pref_unit_ids/municipality_ids, pref_unit -> municipality_ids
  const sel = ensureAoiSelectedShape(AOI_STATE?.selected);

  const out = {
    municipality_ids: new Set((sel.municipality_ids||[]).map(String).filter(Boolean)),
    pref_unit_ids: new Set((sel.pref_unit_ids||[]).map(String).filter(Boolean)),
    region_ids: new Set((sel.region_ids||[]).map(String).filter(Boolean))
  };

  const addToSet = (set, val)=>{
    const v = String(val||'').trim();
    if(!v) return false;
    const before = set.size;
    set.add(v);
    return set.size !== before;
  };

  let changed = true;
  let guard = 0;

  while(changed && guard++ < 8){
    changed = false;

    // Expand regions -> pref_units/municipalities
    for(const rid of Array.from(out.region_ids)){
      const e = ADMIN_AREAS_BY_KEY.get(adminAreaKey('region', rid));
      if(!e) continue;

      const pu = Array.isArray(e.pref_unit_ids) ? e.pref_unit_ids : [];
      const mu = Array.isArray(e.municipality_ids) ? e.municipality_ids : [];

      for(const id of pu) changed = addToSet(out.pref_unit_ids, id) || changed;
      for(const id of mu) changed = addToSet(out.municipality_ids, id) || changed;
    }

    // Expand pref units -> municipalities
    for(const pid of Array.from(out.pref_unit_ids)){
      const e = ADMIN_AREAS_BY_KEY.get(adminAreaKey('pref_unit', pid));
      if(!e) continue;

      const mu = Array.isArray(e.municipality_ids) ? e.municipality_ids : [];
      for(const id of mu) changed = addToSet(out.municipality_ids, id) || changed;
    }
  }

  AOI_STATE.expanded = {
    municipality_ids: Array.from(out.municipality_ids),
    pref_unit_ids: Array.from(out.pref_unit_ids),
    region_ids: Array.from(out.region_ids)
  };
}
function upgradeLegacyAoiPathsToSelected(){
  // If we only have paths (older saves), try to map them to registry.
  try{
    if(AOI_STATE?.selected) return; // already new format
    const paths = Array.isArray(AOI_STATE?.paths) ? AOI_STATE.paths : [];
    if(!paths.length) { AOI_STATE.selected = emptyAoiSelected(); return; }

    const sel = emptyAoiSelected();
    paths.forEach(p=>{
      const e = ADMIN_AREAS_BY_FILE.get(String(p));
      if(!e) return;
      const type = normalizeAdminAreaType(e.type);
      const id = adminAreaIdFromEntry(e);
      if(type==='municipality') sel.municipality_ids.push(id);
      if(type==='pref_unit') sel.pref_unit_ids.push(id);
      if(type==='region') sel.region_ids.push(id);
    });
    AOI_STATE.selected = sel;
  }catch(_){
    AOI_STATE.selected = emptyAoiSelected();
  }
}

function aoiTypeLabel(t){
  switch(String(t||'').toLowerCase()){
    case 'municipality': return 'Δήμος';
    case 'pref_unit': return 'Π.Ε.';
    case 'region_unit': return 'Π.Ε.';
    case 'region': return 'Περιφέρεια';
    case 'multi': return 'Πολλαπλές Περιοχές';
    default: return 'AOI';
  }
}

function aoiNameFromPath(p){
  try{
    const base = String(p).split('/').pop() || String(p);
    return base.replace(/\.geojson$/i,'').replace(/[_-]+/g,' ').trim();
  }catch(_){ return String(p||''); }
}

function updateAOIUI(){
  const chip = document.getElementById('aoiChip');
  const txt  = document.getElementById('aoiActiveText');

  // Ensure new AOI shape is ready (after registry load)
  try{
    upgradeLegacyAoiPathsToSelected();
    computeAoiDerived();
    computeAoiExpanded();
  }catch(_){ }

  const names = (AOI_STATE && Array.isArray(AOI_STATE.names)) ? AOI_STATE.names : [];
  const count = names.length;
  const typeLbl = aoiTypeLabel(AOI_STATE?.type);

  let pretty = '—';
  if(count){
    const shown = names.slice(0,3).join(', ');
    pretty = `${typeLbl} (${count}) — ${shown}${count>3 ? '…' : ''}`;
    // If AOI includes higher levels (Π.Ε./Περιφέρεια), show expanded municipality coverage when available
    try{
      const exp = AOI_STATE?.expanded;
      const munCount = Array.isArray(exp?.municipality_ids) ? exp.municipality_ids.length : 0;
      const hasHigher = (AOI_STATE?.selected && (AOI_STATE.selected.pref_unit_ids?.length || AOI_STATE.selected.region_ids?.length)) || (AOI_STATE?.type === 'pref_unit') || (AOI_STATE?.type === 'region');
      if(hasHigher && munCount){ pretty += ` | Κάλυψη Δήμων: ${munCount}`; }
    }catch(_){ }

  }

  if(txt) txt.textContent = pretty;
  if(chip) chip.textContent = count ? `AOI: ${count}` : 'AOI: —';
}

function renderAOIList(){
  const wrap = document.getElementById('aoiList');
  if(!wrap) return;

  const type = document.getElementById('aoiType')?.value || (AOI_STATE?.type || 'municipality');

  // Prefer registry (typed + IDs). Fallback to repo scan list.
  let entries = [];
  if(Array.isArray(ADMIN_AREAS_REGISTRY) && ADMIN_AREAS_REGISTRY.length){
    entries = ADMIN_AREAS_REGISTRY.slice();
    if(type !== 'multi'){
      entries = entries.filter(e => normalizeAdminAreaType(e.type) === normalizeAdminAreaType(type));
    }
    entries.sort((a,b)=> (a.name||'').localeCompare(b.name||'', 'el'));
  }else{
    const list = (DATA_GROUPS.boundaries || []).slice()
      .sort((a,b)=> (a.path||'').localeCompare(b.path||'', 'el'));

    if(!list.length){
      wrap.innerHTML = `<div class="hint" style="margin:0;border-radius:10px;">
        Δεν βρέθηκαν διαθέσιμα διοικητικά όρια. Προσθέστε αρχεία *.geojson στο <b>data/boundaries/</b>.
      </div>`;
      return;
    }

    // Fallback view (no IDs)
    const selected = new Set((AOI_STATE && Array.isArray(AOI_STATE.paths)) ? AOI_STATE.paths : []);
    wrap.innerHTML = list.map(f=>{
      const name = aoiNameFromPath(f.path);
      const checked = selected.has(f.path) ? 'checked' : '';
      return `
        <label class="aoi-item">
          <input type="checkbox" class="aoi-check" data-path="${escapeHtml(f.path)}" data-name="${escapeHtml(name)}" ${checked}/>
          <span class="aoi-name">${escapeHtml(name)}</span>
          <span class="aoi-meta">🏳️</span>
        </label>
      `;
    }).join('');

    updateAOIUI();
    return;
  }

  // Ensure AOI selected shape is available
  upgradeLegacyAoiPathsToSelected();
  const sel = ensureAoiSelectedShape(AOI_STATE?.selected);

  // Multi-mode shows all types with small tag
  const typeTag = (t)=>{
    const nt = normalizeAdminAreaType(t);
    if(nt==='municipality') return 'Δήμος';
    if(nt==='pref_unit') return 'Π.Ε.';
    if(nt==='region') return 'Περιφέρεια';
    return nt;
  };

  const isChecked = (e)=>{
    const nt = normalizeAdminAreaType(e.type);
    const id = adminAreaIdFromEntry(e);
    if(nt==='municipality') return sel.municipality_ids.includes(id);
    if(nt==='pref_unit') return sel.pref_unit_ids.includes(id);
    if(nt==='region') return sel.region_ids.includes(id);
    return false;
  };

  // If multi, group by type for clarity
  if(type === 'multi'){
    const groups = {
      municipality: entries.filter(e=> normalizeAdminAreaType(e.type)==='municipality'),
      pref_unit: entries.filter(e=> normalizeAdminAreaType(e.type)==='pref_unit'),
      region: entries.filter(e=> normalizeAdminAreaType(e.type)==='region')
    };

    const groupHtml = (key, title)=>{
      const arr = groups[key] || [];
      if(!arr.length) return '';
      const rows = arr.map(e=>{
        const id = adminAreaIdFromEntry(e);
        const checked = isChecked(e) ? 'checked' : '';
        return `
          <label class="aoi-item">
            <input type="checkbox" class="aoi-check" data-type="${escapeHtml(normalizeAdminAreaType(e.type))}" data-id="${escapeHtml(id)}"
                   data-file="${escapeHtml(e.file)}" data-name="${escapeHtml(e.name)}" ${checked}/>
            <span class="aoi-name">${escapeHtml(e.name)}</span>
            <span class="aoi-meta">${escapeHtml(title)}</span>
          </label>
        `;
      }).join('');
      return `<div class="aoi-group">
        <div class="aoi-group-title">${escapeHtml(title)}</div>
        ${rows}
      </div>`;
    };

    wrap.innerHTML =
      groupHtml('municipality','Δήμοι') +
      groupHtml('pref_unit','Π.Ε.') +
      groupHtml('region','Περιφέρειες');

  }else{
    wrap.innerHTML = entries.map(e=>{
      const id = adminAreaIdFromEntry(e);
      const checked = isChecked(e) ? 'checked' : '';
      return `
        <label class="aoi-item">
          <input type="checkbox" class="aoi-check" data-type="${escapeHtml(normalizeAdminAreaType(e.type))}" data-id="${escapeHtml(id)}"
                 data-file="${escapeHtml(e.file)}" data-name="${escapeHtml(e.name)}" ${checked}/>
          <span class="aoi-name">${escapeHtml(e.name)}</span>
          <span class="aoi-meta">${escapeHtml(typeTag(e.type))}</span>
        </label>
      `;
    }).join('');
  }

  updateAOIUI();
}

function readAOISelectionFromUI(){
  const sel = Array.from(document.querySelectorAll('#aoiList .aoi-check:checked'));

  // Preferred (registry mode)
  const items = sel.map(cb => ({
    type: cb.dataset.type || null,
    id: cb.dataset.id || null,
    file: cb.dataset.file || cb.dataset.path || null,
    name: cb.dataset.name || null
  })).filter(x => (x.id && x.type));

  // Legacy fallback
  const paths = items.map(i => i.file).filter(Boolean);
  const names = items.map(i => i.name).filter(Boolean);

  return { items, paths, names };
}

function setAOIFromChecked(){
  const { items, paths, names } = readAOISelectionFromUI();
  const type = document.getElementById('aoiType')?.value || (AOI_STATE?.type || 'municipality');

  // Build selected ids by type (no generic admin_id)
  const selected = emptyAoiSelected();
  (items||[]).forEach(it=>{
    const t = normalizeAdminAreaType(it.type || type);
    const id = String(it.id || '');
    if(!id) return;
    if(t === 'municipality') selected.municipality_ids.push(id);
    if(t === 'pref_unit') selected.pref_unit_ids.push(id);
    if(t === 'region') selected.region_ids.push(id);
  });

  AOI_STATE = {
    type,
    selected,
    paths: paths || [],
    names: names || []
  };

  // If registry available, recompute derived paths/names (ensures stable names)
  try{
    computeAoiDerived();
    computeAoiExpanded();
  }catch(_){ }

  updateAOIUI();
  if(typeof scheduleSaveUiState === 'function') scheduleSaveUiState();
  syncAoiLayerToMap().catch(()=>{});
  try{ renderHumanResources(); }catch(_){}
  try{ renderVehicles(); }catch(_){}
  try{ renderMaterials(); }catch(_){}
}

function clearAOI(){
  const type = document.getElementById('aoiType')?.value || 'municipality';
  AOI_STATE = { type, selected: emptyAoiSelected(), expanded: emptyAoiSelected(), paths: [], names: [], items: [] };

  // uncheck UI
  document.querySelectorAll('#aoiList .aoi-check').forEach(cb => { cb.checked = false; });

  updateAOIUI();
  if(typeof scheduleSaveUiState === 'function') scheduleSaveUiState();
  syncAoiLayerToMap().catch(()=>{});
  try{ renderHumanResources(); }catch(_){}
  try{ renderVehicles(); }catch(_){}
  try{ renderMaterials(); }catch(_){}
}

async function syncAoiLayerToMap(){
  if(!map) return;

  // remove existing
  try{
    if(AOI_LAYER_GROUP){
      map.removeLayer(AOI_LAYER_GROUP);
      AOI_LAYER_GROUP = null;
    }
  }catch(_){ AOI_LAYER_GROUP = null; }

  let paths = (AOI_STATE && Array.isArray(AOI_STATE.paths)) ? AOI_STATE.paths : [];
  // Fallback: if selected AOI has no geometry (e.g., pref_unit/region as group-only),
  // draw the expanded municipalities that belong to it.
  if(!paths.length){
    try{
      const exp = AOI_STATE?.expanded;
      const mun = Array.isArray(exp?.municipality_ids) ? exp.municipality_ids : [];
      if(mun.length){
        paths = mun.map(id => ADMIN_AREAS_BY_KEY.get(adminAreaKey('municipality', id))?.file).filter(Boolean);
      }
    }catch(_){ }
  }
  if(!paths.length) return;

  AOI_LAYER_GROUP = L.featureGroup();
  AOI_LAYER_GROUP.addTo(map);

  for(const path of paths){
    try{
      const gj = await fetchGeoJSON(path);
      const layer = L.geoJSON(gj, {
        style: {
          color: '#8e44ad',
          weight: 3,
          fillOpacity: 0.08
        }
      });
      layer.addTo(AOI_LAYER_GROUP);
    }catch(e){
      console.warn('AOI layer failed:', path, e);
    }
  }

  try{ AOI_LAYER_GROUP.bringToFront(); }catch(_){}
}

function zoomToAOI(){
  const paths = (AOI_STATE && Array.isArray(AOI_STATE.paths)) ? AOI_STATE.paths : [];
  if(!paths.length){
    updateMeteoStatus('AOI: δεν έχει οριστεί περιοχή.');
    return;
  }

  // Ensure map visible
  openMapModal();

  setTimeout(async ()=>{
    try{
      await syncAoiLayerToMap();
      if(AOI_LAYER_GROUP && map){
        const b = AOI_LAYER_GROUP.getBounds();
        if(b && b.isValid && b.isValid()){
          map.fitBounds(b, { padding:[18,18] });
        }
      }
    }catch(e){
      console.warn('zoomToAOI failed:', e);
    }
  }, 180);
}

function restoreAOIFromSavedState(st){
  try{
    const saved = st && st.__aoi ? st.__aoi : null;
    if(!saved) return;

    const type = normalizeAdminAreaType(saved.type || 'municipality');

    if(saved.selected){
      const selected = ensureAoiSelectedShape(saved.selected);
      AOI_STATE = { type, selected, paths: [], names: [], items: [] };
    }else{
      // legacy
      const paths = Array.isArray(saved.paths) ? saved.paths : [];
      const names = Array.isArray(saved.names) ? saved.names : paths.map(aoiNameFromPath);
      AOI_STATE = { type, paths, names };
    }

    const typeEl = document.getElementById('aoiType');
    if(typeEl){
      const has = Array.from(typeEl.options).some(o => o.value === type);
      if(has) typeEl.value = type;
    }

    // Update list and checks
    renderAOIList();
    updateAOIUI();

    // Map overlay if map open
    syncAoiLayerToMap().catch(()=>{});
  }catch(_){}
}
/* =================== /AOI =================== */


function renderFileList(){
  const tbody = document.getElementById('fileRows');
  tbody.innerHTML = '';
  const addCategory = (catKey, title, list, icon, color) => {
    const trHead = document.createElement('tr');
    trHead.className = 'cat-row';
    trHead.innerHTML = `
      <td colspan="2" class="cat-row">
        <div class="cat-head">
          <span class="cat-title">${icon} ${title}</span>
        </div>
      </td>`;
    tbody.appendChild(trHead);

    list.forEach(f=>{
      const reg = ADMIN_AREAS_BY_FILE.get(f.path);
    const name = reg ? reg.name : f.path.split('/').pop().replace('.geojson','');
      const tr = document.createElement('tr');
      const on = VISIBLE.has(f.path);
      tr.innerHTML = `
        <td style="text-align:left;padding-left:10px;">${name}</td>
        <td><div class="actions-row">
          <button class="mini-btn btn-on" onclick="geoAddFromRow('${catKey}','${f.path}','${name}')" title="➕ Προσθήκη στο κεντρικό panel">➕</button>
          <button class="mini-btn btn-gray" onclick="geoClearCategory('${catKey}')" title="🧹 Εκκαθάριση από το κεντρικό panel">🧹</button>
          <button class="mini-btn btn-map" onclick="previewOnMap('${f.path}','${name}')" title="Προεπισκόπηση στον χάρτη (zoom), χωρίς αλλαγή On/Off"><span class="ico-map">🗺</span> Map</button>
          <button class="mini-btn map-only-btn ${on ? 'btn-on' : 'btn-off'}" id="btn-onoff-${cssSafe(f.path)}"
                  onclick="toggleLayer('${f.path}','${name}')"><span class="ico-eye">👁</span> ${on ? 'On' : 'Off'}</button>
        </div></td>
      `;
      tbody.appendChild(tr);
    });
  };

  // Streams + Basins stay in "Αρχεία Έργου (GeoJSON)"
  addCategory("streams", "Υδρογραφικό Δίκτυο", DATA_GROUPS.streams, "💧", "#0f0f0f");
  addCategory("basins", "Λεκάνες Απορροής", DATA_GROUPS.basins, "🏞️", "#0f0f0f");
}

function cssSafe(s){
  return btoa(unescape(encodeURIComponent(s))).replace(/=+/g,'').replace(/[+/]/g,'_');
}

/* ===================== FORECAST SOURCES (WEB) ===================== */
function forecastLabelFromUrl(url){
  try{
    const u = new URL(url);
    const host = (u.hostname || '').replace(/^www\./i,'');
    if(/windy\./i.test(host)) return 'Windy';
    if(/poseidon\./i.test(host) || /hcmr\./i.test(host)) return 'Poseidon (HCMR)';
    if(/meteo\./i.test(host)) return 'Meteo';
    // default: show host
    return host || url;
  }catch(_){
    return String(url || '').replace(/^https?:\/\//i,'').slice(0, 60) || '—';
  }
}

function parseForecastSources(text){
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('//'));
  return lines.map(url => ({
    url,
    name: forecastLabelFromUrl(url)
  }));
}

function openForecastWeb(url){
  if(!url) return;
  try{ window.open(url, '_blank', 'noopener'); }catch(_){ /* noop */ }
}

function renderForecastSources(list){
  const tbody = document.getElementById('forecastRows');
  if(!tbody) return;
  tbody.innerHTML = '';

  if(!Array.isArray(list) || !list.length){
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="2" style="padding:10px;color:#6b7a86;">(Δεν βρέθηκαν πηγές)</td>`;
    tbody.appendChild(tr);
    return;
  }

  list.forEach(item => {
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.style.textAlign = 'left';
    tdName.style.paddingLeft = '10px';
    tdName.textContent = item.name || '—';

    const tdAct = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'actions-row';
    wrap.style.justifyContent = 'flex-end';

    const btn = document.createElement('button');
    btn.className = 'mini-btn btn-map';
    btn.title = 'Άνοιγμα σε νέα καρτέλα';
    btn.textContent = '🔗 Web';
    btn.addEventListener('click', () => openForecastWeb(item.url));

    wrap.appendChild(btn);
    tdAct.appendChild(wrap);

    tr.appendChild(tdName);
    tr.appendChild(tdAct);
    tbody.appendChild(tr);
  });
}

async function loadForecastSourcesFromTree(treeFiles){
  const loader = document.getElementById('forecastLoader');
  const msg = document.getElementById('forecastMsg');
  if(loader) loader.style.display = 'block';
  if(msg){ msg.style.display = 'none'; msg.textContent = ''; }

  try{
    const files = Array.isArray(treeFiles) ? treeFiles : [];
    const f =
      files.find(x => x.path === 'data/forecast/forecast.txt') ||
      files.find(x => /data\/forecast\/forecast\.txt$/i.test(x.path)) ||
      files.find(x => /forecast\/forecast\.txt$/i.test(x.path));

    if(!f) throw new Error('Δεν βρέθηκε το data/forecast/forecast.txt στο repo.');

    const resp = await fetch(RAW_URL + f.path, { cache: 'no-store' });
    if(!resp.ok) throw new Error('Αποτυχία λήψης forecast.txt (HTTP ' + resp.status + ')');

    const text = await resp.text();
    const list = parseForecastSources(text);
    renderForecastSources(list);
  }catch(e){
    console.warn('Forecast Source:', e);
    if(msg){
      msg.style.display = 'block';
      msg.textContent = 'Forecast Source: ' + (e?.message || String(e));
    }
    renderForecastSources([]);
  }finally{
    if(loader) loader.style.display = 'none';
  }
}

/* ===================== WATER LEVEL SENSORS (WEB SOURCES) ===================== */
function waterLevelLabelFromUrl(url){
  try{
    const u = new URL(url);
    const host = (u.hostname || '').replace(/^www\./,'');
    const last = (u.pathname || '').split('/').filter(Boolean).pop() || '';
    if(last && /^\d+$/.test(last)) return `${host} (${last})`;
    return host || url;
  }catch(_){
    return url || '—';
  }
}

function parseWaterLevelSources(text){
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('//'));

  return lines
    .map(line => {
      const parts = line.split('|');
      if(parts.length >= 2){
        const name = parts[0].trim();
        const url = parts.slice(1).join('|').trim();
        return { name: name || waterLevelLabelFromUrl(url), url };
      }
      const url = line.trim();
      return { name: waterLevelLabelFromUrl(url), url };
    })
    .filter(x => x.url);
}

function openWaterLevelWeb(url){
  if(!url) return;
  try{ window.open(url, '_blank', 'noopener'); }catch(_){}
}

function renderWaterLevelSources(list){
  const tbody = document.getElementById('waterLevelRows');
  if(!tbody) return;
  tbody.innerHTML = '';

  if(!Array.isArray(list) || !list.length){
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="2" style="padding:10px;color:#6b7a86;">(Δεν βρέθηκαν αισθητήρες)</td>`;
    tbody.appendChild(tr);
    return;
  }

  list.forEach(item => {
    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    tdName.style.textAlign = 'left';
    tdName.style.paddingLeft = '10px';
    tdName.textContent = item.name || '—';

    const tdAct = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'actions-row';
    wrap.style.justifyContent = 'flex-end';

    const btn = document.createElement('button');
    btn.className = 'mini-btn btn-map';
    btn.title = 'Άνοιγμα σε νέα καρτέλα';
    btn.textContent = '🔗 Web';
    btn.addEventListener('click', () => openWaterLevelWeb(item.url));

    wrap.appendChild(btn);
    tdAct.appendChild(wrap);

    tr.appendChild(tdName);
    tr.appendChild(tdAct);
    tbody.appendChild(tr);
  });
}

async function loadWaterLevelSourcesFromTree(treeFiles){
  const loader = document.getElementById('waterLevelLoader');
  const msg = document.getElementById('waterLevelMsg');
  if(loader) loader.style.display = 'block';
  if(msg){ msg.style.display = 'none'; msg.textContent = ''; }

  try{
    const files = Array.isArray(treeFiles) ? treeFiles : [];
    const f =
      files.find(x => x.path === 'data/WaterLevelSensors/WaterLevelSensors.txt') ||
      files.find(x => /data\/WaterLevelSensors\/WaterLevelSensors\.txt$/i.test(x.path)) ||
      files.find(x => /WaterLevelSensors\.txt$/i.test(x.path));

    if(!f) throw new Error('Δεν βρέθηκε το data/WaterLevelSensors/WaterLevelSensors.txt στο repo.');

    const resp = await fetch(RAW_URL + f.path, { cache: 'no-store' });
    if(!resp.ok) throw new Error('Αποτυχία λήψης WaterLevelSensors.txt (HTTP ' + resp.status + ')');

    const text = await resp.text();
    const list = parseWaterLevelSources(text);
    renderWaterLevelSources(list);
  }catch(e){
    console.warn('Water Level Sensors:', e);
    if(msg){
      msg.style.display = 'block';
      msg.textContent = 'Water Level Sensors: ' + (e?.message || String(e));
    }
    renderWaterLevelSources([]);
  }finally{
    if(loader) loader.style.display = 'none';
  }
}



/* ===================== HUMAN RESOURCES (HR) ===================== */
const HR_DEFAULT_PATH = 'data/resources/human_resources.json';
let HR_DATA = [];
let HR_LAST_LOADED_PATH = HR_DEFAULT_PATH;

function hrNormalize(s){
  try{
    return String(s||'')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g,'');
  }catch(_){
    return String(s||'').toLowerCase();
  }
}

function hrCoverageIds(r){
  const out = [];
  try{
    if(Array.isArray(r.municipality_ids)) out.push(...r.municipality_ids.map(x=>String(x)));
    if(r.municipality_id) out.push(String(r.municipality_id));
  }catch(_){ }
  return Array.from(new Set(out.filter(Boolean)));
}

function hrMunicipalityName(id){
  try{
    const e = ADMIN_AREAS_BY_KEY.get(adminAreaKey('municipality', String(id)));
    return e ? e.name : String(id);
  }catch(_){
    return String(id);
  }
}

function hrStatusMeta(r){
  const raw = (r && (r.status ?? r.availability ?? r.state))
    ? String(r.status ?? r.availability ?? r.state).trim()
    : '';
  const st = hrNormalize(raw);

  // Explicit boolean overrides
  if(r && r.available === true) return { cls:'ok', label:'Διαθέσιμος', isAvailable:true };
  if(r && r.available === false) return { cls:'off', label:'Μη διαθέσιμος', isAvailable:false };

  if(!raw) return { cls:'off', label:'—', isAvailable:false };

  const ok = new Set(['available','on','ready','standby','ετοιμος','έτοιμος','διαθεσιμος','διαθέσιμος','επιφυλακη','επιφυλακή']);
  const warn = new Set(['busy','assigned','working','σε αποστολη','σε αποστολή','σε εργασία','σε εργασια']);
  const off = new Set(['off','offline','unavailable','ανενεργος','ανενεργός','μη διαθέσιμος','μη διαθεσιμος']);

  if(ok.has(st)){
    const lbl = (st in {'standby':1,'επιφυλακη':1,'επιφυλακή':1}) ? 'Επιφυλακή' : 'Διαθέσιμος';
    return { cls: (lbl==='Επιφυλακή' ? 'warn' : 'ok'), label: lbl, isAvailable: true };
  }
  if(warn.has(st)) return { cls:'warn', label:'Σε αποστολή', isAvailable:false };
  if(off.has(st)) return { cls:'off', label:'Μη διαθέσιμος', isAvailable:false };

  return { cls:'off', label: raw, isAvailable:false };
}

function hrTextBlob(r){
  const parts = [];
  ['name','role','unit','category','notes','phone','email'].forEach(k=>{ if(r && r[k]) parts.push(String(r[k])); });
  try{
    if(Array.isArray(r.skills)) parts.push(r.skills.join(' '));
  }catch(_){ }
  return hrNormalize(parts.join(' | '));
}

function hrGetAoiSet(){
  try{ computeAoiExpanded(); }catch(_){ }
  const ids = AOI_STATE?.expanded?.municipality_ids;
  return new Set(Array.isArray(ids) ? ids.map(x=>String(x)) : []);
}

function hrMatchesAOI(r, aoiSet){
  const ids = hrCoverageIds(r);
  if(!ids.length) return false;
  for(const id of ids){ if(aoiSet.has(String(id))) return true; }
  return false;
}

function hrClearFilters(){
  const s = document.getElementById('hrSearch');
  const a = document.getElementById('hrUseAOI');
  const v = document.getElementById('hrOnlyAvailable');
  if(s) s.value = '';
  if(v) v.checked = false;
  if(a) a.checked = true;
  renderHumanResources();
}

async function hrReload(){
  // Reload from the known path (repo raw)
  const loader = document.getElementById('hrLoader');
  const msg = document.getElementById('hrMsg');
  if(loader) loader.style.display = 'block';
  if(msg){ msg.style.display='none'; msg.textContent=''; }

  const path = HR_LAST_LOADED_PATH || HR_DEFAULT_PATH;
  try{
    const resp = await fetch(RAW_URL + path, { cache: 'no-store' });
    if(!resp.ok) throw new Error('Αποτυχία λήψης HR JSON (HTTP ' + resp.status + ')');
    const json = await resp.json();
    if(!Array.isArray(json)) throw new Error('Το human_resources.json πρέπει να είναι JSON array');
    HR_DATA = json;
    renderHumanResources();
  }catch(e){
    console.warn('HR reload:', e);
    HR_DATA = [];
    if(msg){
      msg.style.display='block';
      msg.textContent = 'HR: ' + (e?.message || String(e));
    }
    renderHumanResources();
  }finally{
    if(loader) loader.style.display = 'none';
  }
}

async function loadHumanResourcesFromTree(treeFiles){
  const loader = document.getElementById('hrLoader');
  const msg = document.getElementById('hrMsg');
  if(loader) loader.style.display = 'block';
  if(msg){ msg.style.display='none'; msg.textContent=''; }

  try{
    const files = Array.isArray(treeFiles) ? treeFiles : [];
    const f =
      files.find(x => x.path === HR_DEFAULT_PATH) ||
      files.find(x => /data\/resources\/human_resources\.json$/i.test(x.path)) ||
      files.find(x => /human_resources\.json$/i.test(x.path));

    if(!f) throw new Error('Δεν βρέθηκε το ' + HR_DEFAULT_PATH + ' στο repo.');

    HR_LAST_LOADED_PATH = f.path;

    const resp = await fetch(RAW_URL + f.path, { cache: 'no-store' });
    if(!resp.ok) throw new Error('Αποτυχία λήψης HR JSON (HTTP ' + resp.status + ')');

    const json = await resp.json();
    if(!Array.isArray(json)) throw new Error('Το human_resources.json πρέπει να είναι JSON array');

    HR_DATA = json;
    renderHumanResources();
  }catch(e){
    console.warn('HR load:', e);
    HR_DATA = [];
    if(msg){
      msg.style.display='block';
      msg.textContent = 'HR: ' + (e?.message || String(e));
    }
    renderHumanResources();
  }finally{
    if(loader) loader.style.display = 'none';
  }
}

function renderHumanResources(){
  const rows = document.getElementById('hrRows');
  const summary = document.getElementById('hrSummary');
  if(!rows) return;

  const useAOI = !!document.getElementById('hrUseAOI')?.checked;
  const onlyAvail = !!document.getElementById('hrOnlyAvailable')?.checked;
  const q = hrNormalize(document.getElementById('hrSearch')?.value || '');

  const list = Array.isArray(HR_DATA) ? HR_DATA : [];

  const aoiSet = hrGetAoiSet();
  const aoiActive = aoiSet.size > 0;

  let filtered = [];
  let dropAOI = 0, dropAvail = 0, dropSearch = 0, noTag = 0;

  for(const r of list){
    const blob = hrTextBlob(r);

    if(q && !blob.includes(q)) { dropSearch++; continue; }

    const st = hrStatusMeta(r);
    if(onlyAvail && !st.isAvailable){ dropAvail++; continue; }

    if(useAOI && aoiActive){
      const cov = hrCoverageIds(r);
      if(!cov.length){ noTag++; dropAOI++; continue; }
      if(!hrMatchesAOI(r, aoiSet)) { dropAOI++; continue; }
    }

    filtered.push({ r, st });
  }

  // Sort by status then name
  filtered.sort((a,b)=>{
    const rank = (x)=> x.st.cls==='ok' ? 0 : (x.st.cls==='warn' ? 1 : 2);
    const ra = rank(a), rb = rank(b);
    if(ra!=rb) return ra-rb;
    const na = String(a.r?.name||'').localeCompare(String(b.r?.name||''), 'el');
    if(na!=0) return na;
    return String(a.r?.person_id||'').localeCompare(String(b.r?.person_id||''));
  });

  if(!filtered.length){
    rows.innerHTML = `<tr><td colspan="4" style="padding:10px;color:#6b7a86;font-size:12px;">(Κενό) Δεν βρέθηκαν εγγραφές ανθρώπινου δυναμικού για τα τρέχοντα φίλτρα.</td></tr>`;
  }else{
    rows.innerHTML = filtered.map(({r, st})=>{
      const name = escapeHtml(String(r?.name || r?.person_id || '—'));
      const role = escapeHtml(String(r?.role || '—'));
      const covIds = hrCoverageIds(r);
      const covNames = covIds.length ? covIds.map(hrMunicipalityName).join(', ') : '—';
      const cov = escapeHtml(covNames);
      const pill = `<span class="hr-status ${st.cls}">${escapeHtml(st.label)}</span>`;
      return `
        <tr>
          <td style="text-align:left;padding-left:10px;">
            <div style="font-weight:900;">${name}</div>
            <div style="font-size:11px;color:#6b7a86;font-weight:800;">${escapeHtml(String(r?.unit || r?.category || ''))}</div>
          </td>
          <td>${role}</td>
          <td>${pill}</td>
          <td><span class="hr-coverage">${cov}</span></td>
        </tr>`;
    }).join('');
  }

  if(summary){
    const total = list.length;
    const shown = filtered.length;
    const aoiTxt = useAOI ? (aoiActive ? `AOI: ON (Δήμοι: ${aoiSet.size})` : 'AOI: ON (—)') : 'AOI: OFF';
    const avTxt = onlyAvail ? 'Διαθέσιμοι: ON' : 'Διαθέσιμοι: OFF';
    summary.textContent = `HR: ${shown}/${total} | ${aoiTxt} | ${avTxt}`;
  }
}

function bindHumanResourcesUI(){
  const s = document.getElementById('hrSearch');
  const a = document.getElementById('hrUseAOI');
  const v = document.getElementById('hrOnlyAvailable');
  if(s && !s.dataset.bound){
    s.addEventListener('input', debounce(()=>renderHumanResources(), 120));
    s.dataset.bound='true';
  }
  if(a && !a.dataset.bound){
    a.addEventListener('change', ()=>renderHumanResources());
    a.dataset.bound='true';
  }
  if(v && !v.dataset.bound){
    v.addEventListener('change', ()=>renderHumanResources());
    v.dataset.bound='true';
  }
}
/* ===================== /Human Resources (HR) ===================== */


/* ===================== VEHICLES (Technical Means) ===================== */
const VEH_DEFAULT_PATH = 'data/resources/vehicles.json';
let VEH_DATA = [];
let VEH_LAST_LOADED_PATH = VEH_DEFAULT_PATH;

function vehNormalize(s){
  try{
    return String(s||'')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g,'');
  }catch(_){
    return String(s||'').toLowerCase();
  }
}

function vehCoverageIds(v){
  const out = [];
  try{
    if(Array.isArray(v.municipality_ids)) out.push(...v.municipality_ids.map(x=>String(x)));
    if(v.municipality_id) out.push(String(v.municipality_id));
  }catch(_){ }
  return Array.from(new Set(out.map(x=>String(x).trim()).filter(Boolean)));
}

function vehMunicipalityName(id){
  try{
    const e = ADMIN_AREAS_BY_KEY.get(adminAreaKey('municipality', String(id)));
    return e ? e.name : String(id);
  }catch(_){
    return String(id);
  }
}

function vehStatusMeta(v){
  const raw = (v && (v.status ?? v.availability ?? v.state))
    ? String(v.status ?? v.availability ?? v.state).trim()
    : '';
  const st = vehNormalize(raw);

  // Explicit boolean overrides
  if(v && v.available === true) return { key:'available', cls:'ok', label:'Διαθέσιμο', isAvailable:true };
  if(v && v.available === false) return { key:'unavailable', cls:'off', label:'Μη διαθέσιμο', isAvailable:false };

  if(!raw) return { key:'', cls:'off', label:'—', isAvailable:false };

  const available = new Set(['available','on','ready','ετοιμο','ετοιμος','έτοιμος','διαθεσιμο','διαθέσιμο']);
  const standby = new Set(['standby','επιφυλακη','επιφυλακή','ready_standby']);
  const assigned = new Set(['assigned','busy','in_use','in service','σε αποστολη','σε αποστολή','σε χρηση','σε χρήση']);
  const maint = new Set(['maintenance','service','repair','επισκευη','επισκευή','συντηρηση','συντήρηση']);
  const off = new Set(['unavailable','offline','off','ανενεργο','ανενεργός','ανενεργο','εκτος','εκτός']);

  if(standby.has(st)) return { key:'standby', cls:'warn', label:'Επιφυλακή', isAvailable:true };
  if(available.has(st)) return { key:'available', cls:'ok', label:'Διαθέσιμο', isAvailable:true };
  if(assigned.has(st)) return { key:'assigned', cls:'warn', label:'Σε αποστολή', isAvailable:false };
  if(maint.has(st)) return { key:'maintenance', cls:'maint', label:'Συντήρηση', isAvailable:false };
  if(off.has(st)) return { key:'unavailable', cls:'off', label:'Μη διαθέσιμο', isAvailable:false };

  return { key: raw, cls:'off', label: raw, isAvailable:false };
}

function vehTextBlob(v){
  const parts = [];
  ['vehicle_id','name','plate','type','category','base','notes'].forEach(k=>{ if(v && v[k]) parts.push(String(v[k])); });
  try{ if(Array.isArray(v.capabilities)) parts.push(v.capabilities.join(' ')); }catch(_){ }
  return vehNormalize(parts.join(' | '));
}

function vehGetAoiSet(){
  try{ computeAoiExpanded(); }catch(_){ }
  const ids = AOI_STATE?.expanded?.municipality_ids;
  return new Set(Array.isArray(ids) ? ids.map(x=>String(x)) : []);
}

function vehMatchesAOI(v, aoiSet){
  const ids = vehCoverageIds(v);
  if(!ids.length) return false;
  for(const id of ids){ if(aoiSet.has(String(id))) return true; }
  return false;
}

function vehClearFilters(){
  const s = document.getElementById('vehSearch');
  const a = document.getElementById('vehUseAOI');
  const v = document.getElementById('vehOnlyAvailable');
  const st = document.getElementById('vehStatus');
  if(s) s.value = '';
  if(st) st.value = '';
  if(v) v.checked = false;
  if(a) a.checked = true;
  renderVehicles();
}

async function vehReload(){
  const loader = document.getElementById('vehLoader');
  const msg = document.getElementById('vehMsg');
  if(loader) loader.style.display = 'block';
  if(msg){ msg.style.display='none'; msg.textContent=''; }

  const path = VEH_LAST_LOADED_PATH || VEH_DEFAULT_PATH;
  try{
    const resp = await fetch(RAW_URL + path, { cache: 'no-store' });
    if(!resp.ok) throw new Error('Αποτυχία λήψης Vehicles JSON (HTTP ' + resp.status + ')');
    const json = await resp.json();
    if(!Array.isArray(json)) throw new Error('Το vehicles.json πρέπει να είναι JSON array');
    VEH_DATA = json;
    renderVehicles();
  }catch(e){
    console.warn('Vehicles reload:', e);
    VEH_DATA = [];
    if(msg){
      msg.style.display='block';
      msg.textContent = 'Vehicles: ' + (e?.message || String(e));
    }
    renderVehicles();
  }finally{
    if(loader) loader.style.display = 'none';
  }
}

async function loadVehiclesFromTree(treeFiles){
  const loader = document.getElementById('vehLoader');
  const msg = document.getElementById('vehMsg');
  if(loader) loader.style.display = 'block';
  if(msg){ msg.style.display='none'; msg.textContent=''; }

  try{
    const files = Array.isArray(treeFiles) ? treeFiles : [];
    const f =
      files.find(x => x.path === VEH_DEFAULT_PATH) ||
      files.find(x => /data\/resources\/vehicles\.json$/i.test(x.path)) ||
      files.find(x => /vehicles\.json$/i.test(x.path));

    if(!f) throw new Error('Δεν βρέθηκε το ' + VEH_DEFAULT_PATH + ' στο repo.');

    VEH_LAST_LOADED_PATH = f.path;

    const resp = await fetch(RAW_URL + f.path, { cache: 'no-store' });
    if(!resp.ok) throw new Error('Αποτυχία λήψης Vehicles JSON (HTTP ' + resp.status + ')');

    const json = await resp.json();
    if(!Array.isArray(json)) throw new Error('Το vehicles.json πρέπει να είναι JSON array');

    VEH_DATA = json;
    renderVehicles();
  }catch(e){
    console.warn('Vehicles load:', e);
    VEH_DATA = [];
    if(msg){
      msg.style.display='block';
      msg.textContent = 'Vehicles: ' + (e?.message || String(e));
    }
    renderVehicles();
  }finally{
    if(loader) loader.style.display = 'none';
  }
}

function renderVehicles(){
  const rows = document.getElementById('vehRows');
  const summary = document.getElementById('vehSummary');
  if(!rows) return;

  const useAOI = !!document.getElementById('vehUseAOI')?.checked;
  const onlyAvail = !!document.getElementById('vehOnlyAvailable')?.checked;
  const statusFilter = String(document.getElementById('vehStatus')?.value || '').trim();
  const q = vehNormalize(document.getElementById('vehSearch')?.value || '');

  const list = Array.isArray(VEH_DATA) ? VEH_DATA : [];

  const aoiSet = vehGetAoiSet();
  const aoiActive = aoiSet.size > 0;

  let filtered = [];

  for(const v of list){
    const blob = vehTextBlob(v);
    if(q && !blob.includes(q)) continue;

    const st = vehStatusMeta(v);

    if(statusFilter && vehNormalize(st.key) !== vehNormalize(statusFilter)){
      // allow raw match too
      if(vehNormalize(String(v?.status||'')) != vehNormalize(statusFilter)) continue;
    }

    if(onlyAvail && !st.isAvailable) continue;

    if(useAOI && aoiActive){
      const cov = vehCoverageIds(v);
      if(!cov.length) continue;
      if(!vehMatchesAOI(v, aoiSet)) continue;
    }

    filtered.push({ v, st });
  }

  // Sort: available first, then name/plate
  filtered.sort((a,b)=>{
    const rank = (x)=> x.st.cls==='ok' ? 0 : (x.st.cls==='warn' ? 1 : (x.st.cls==='maint' ? 2 : 3));
    const ra = rank(a), rb = rank(b);
    if(ra!==rb) return ra-rb;
    const na = String(a.v?.name||a.v?.plate||'').localeCompare(String(b.v?.name||b.v?.plate||''), 'el');
    if(na!==0) return na;
    return String(a.v?.vehicle_id||'').localeCompare(String(b.v?.vehicle_id||''));
  });

  if(!filtered.length){
    rows.innerHTML = `<tr><td colspan="4" style="padding:10px;color:#6b7a86;font-size:12px;">(Κενό) Δεν βρέθηκαν οχήματα/τεχνικά μέσα για τα τρέχοντα φίλτρα.</td></tr>`;
  }else{
    rows.innerHTML = filtered.map(({v, st})=>{
      const name = escapeHtml(String(v?.name || v?.vehicle_id || '—'));
      const plate = escapeHtml(String(v?.plate || '—'));
      const type = escapeHtml(String(v?.type || '—'));
      const base = escapeHtml(String(v?.base || ''));
      const caps = Array.isArray(v?.capabilities) && v.capabilities.length ? v.capabilities.map(String).join(', ') : '';
      const capsHtml = caps ? `<div class="veh-caps">${escapeHtml(caps)}</div>` : '';

      const covIds = vehCoverageIds(v);
      const covNames = covIds.length ? covIds.map(vehMunicipalityName).join(', ') : '—';
      const cov = escapeHtml(covNames);

      const pill = `<span class="veh-status ${st.cls}">${escapeHtml(st.label)}</span>`;

      return `
        <tr>
          <td style="text-align:left;padding-left:10px;">
            <div style="font-weight:900;">${name}</div>
            <div style="font-size:11px;color:#6b7a86;font-weight:800;">${plate}${base ? ' · ' + base : ''}</div>
          </td>
          <td>
            <div style="font-weight:900;">${type}</div>
            ${capsHtml}
          </td>
          <td>${pill}</td>
          <td><span class="hr-coverage">${cov}</span></td>
        </tr>`;
    }).join('');
  }

  if(summary){
    const total = list.length;
    const shown = filtered.length;
    const aoiTxt = useAOI ? (aoiActive ? `AOI: ON (Δήμοι: ${aoiSet.size})` : 'AOI: ON (—)') : 'AOI: OFF';
    const avTxt = onlyAvail ? 'Διαθέσιμα: ON' : 'Διαθέσιμα: OFF';
    const stTxt = statusFilter ? `Status: ${statusFilter}` : 'Status: ALL';
    summary.textContent = `Οχήματα: ${shown}/${total} | ${aoiTxt} | ${avTxt} | ${stTxt}`;
  }
}

function bindVehiclesUI(){
  const s = document.getElementById('vehSearch');
  const a = document.getElementById('vehUseAOI');
  const v = document.getElementById('vehOnlyAvailable');
  const st = document.getElementById('vehStatus');

  if(s && !s.dataset.bound){
    s.addEventListener('input', debounce(()=>renderVehicles(), 120));
    s.dataset.bound='true';
  }
  if(a && !a.dataset.bound){
    a.addEventListener('change', ()=>renderVehicles());
    a.dataset.bound='true';
  }
  if(v && !v.dataset.bound){
    v.addEventListener('change', ()=>renderVehicles());
    v.dataset.bound='true';
  }
  if(st && !st.dataset.bound){
    st.addEventListener('change', ()=>renderVehicles());
    st.dataset.bound='true';
  }
}
/* ===================== /Vehicles (Technical Means) ===================== */




/* ===================== MATERIALS (Supplies/Stock) ===================== */
const MAT_DEFAULT_PATH = 'data/resources/materials.json';
let MAT_DATA = [];
let MAT_LAST_LOADED_PATH = MAT_DEFAULT_PATH;

function matNormalize(s){
  try{
    return String(s||'')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g,'');
  }catch(_){
    return String(s||'').toLowerCase();
  }
}

function matNumber(x){
  if(x==null) return 0;
  const n = (typeof x === 'number') ? x : parseFloat(String(x).replace(',','.'));
  return (typeof n === 'number' && isFinite(n)) ? n : 0;
}

function matCoverageIds(it){
  const out = [];
  try{
    if(Array.isArray(it?.municipality_ids)) out.push(...it.municipality_ids.map(x=>String(x)));
    if(it?.municipality_id) out.push(String(it.municipality_id));
  }catch(_){ }
  return Array.from(new Set(out.map(x=>String(x).trim()).filter(Boolean)));
}

function matMunicipalityName(id){
  try{
    const e = ADMIN_AREAS_BY_KEY.get(adminAreaKey('municipality', String(id)));
    return e ? e.name : String(id);
  }catch(_){
    return String(id);
  }
}

function matQtyMeta(it){
  const qty = matNumber(it?.quantity);
  const min = (it && it.min_quantity!=null) ? matNumber(it.min_quantity) : null;
  const unit = String(it?.unit||'').trim();

  if(qty <= 0){
    return { qty, min, unit, cls:'off', label:'Μηδενικό', inStock:false, low:false };
  }
  if(min!=null && isFinite(min) && min>0 && qty < min){
    return { qty, min, unit, cls:'warn', label:'Χαμηλό', inStock:true, low:true };
  }
  return { qty, min, unit, cls:'ok', label:'OK', inStock:true, low:false };
}

function matTextBlob(it){
  const parts = [];
  ['item_id','name','category','location','notes','warehouse','base'].forEach(k=>{ if(it && it[k]) parts.push(String(it[k])); });
  return matNormalize(parts.join(' | '));
}

function matGetAoiSet(){
  try{ computeAoiExpanded(); }catch(_){ }
  const ids = AOI_STATE?.expanded?.municipality_ids;
  return new Set(Array.isArray(ids) ? ids.map(x=>String(x)) : []);
}

function matMatchesAOI(it, aoiSet){
  const ids = matCoverageIds(it);
  if(!ids.length) return false;
  for(const id of ids){ if(aoiSet.has(String(id))) return true; }
  return false;
}

function matPopulateCategoryOptions(data){
  const sel = document.getElementById('matCategory');
  if(!sel) return;
  const current = String(sel.value||'');
  const cats = Array.from(new Set((Array.isArray(data)?data:[])
    .map(x=>String(x?.category||'').trim())
    .filter(Boolean)))
    .sort((a,b)=>a.localeCompare(b,'el'));

  const opts = ['<option value="">Όλες οι κατηγορίες</option>']
    .concat(cats.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`));
  sel.innerHTML = opts.join('');

  if(current && cats.includes(current)) sel.value = current;
  else if(!current) sel.value = '';
  else sel.value = '';
}

function matClearFilters(){
  const s = document.getElementById('matSearch');
  const a = document.getElementById('matUseAOI');
  const stock = document.getElementById('matOnlyInStock');
  const low = document.getElementById('matOnlyLowStock');
  const c = document.getElementById('matCategory');
  if(s) s.value = '';
  if(c) c.value = '';
  if(stock) stock.checked = false;
  if(low) low.checked = false;
  if(a) a.checked = true;
  renderMaterials();
}

async function matReload(){
  const loader = document.getElementById('matLoader');
  const msg = document.getElementById('matMsg');
  if(loader) loader.style.display = 'block';
  if(msg){ msg.style.display='none'; msg.textContent=''; }

  const path = MAT_LAST_LOADED_PATH || MAT_DEFAULT_PATH;
  try{
    const resp = await fetch(RAW_URL + path, { cache: 'no-store' });
    if(!resp.ok) throw new Error('Αποτυχία λήψης Materials JSON (HTTP ' + resp.status + ')');
    const json = await resp.json();
    if(!Array.isArray(json)) throw new Error('Το materials.json πρέπει να είναι JSON array');
    MAT_DATA = json;
    matPopulateCategoryOptions(MAT_DATA);
    renderMaterials();
  }catch(e){
    console.warn('Materials reload:', e);
    MAT_DATA = [];
    if(msg){ msg.style.display='block'; msg.textContent = 'Υλικά: ' + (e?.message || String(e)); }
    renderMaterials();
  }finally{
    if(loader) loader.style.display = 'none';
  }
}

async function loadMaterialsFromTree(treeFiles){
  const loader = document.getElementById('matLoader');
  const msg = document.getElementById('matMsg');
  if(loader) loader.style.display = 'block';
  if(msg){ msg.style.display='none'; msg.textContent=''; }

  try{
    const files = Array.isArray(treeFiles) ? treeFiles : [];
    const f =
      files.find(x => x.path === MAT_DEFAULT_PATH) ||
      files.find(x => /data\/resources\/materials\.json$/i.test(x.path)) ||
      files.find(x => /materials\.json$/i.test(x.path));

    if(!f) throw new Error('Δεν βρέθηκε το ' + MAT_DEFAULT_PATH + ' στο repo.');

    MAT_LAST_LOADED_PATH = f.path;

    const resp = await fetch(RAW_URL + f.path, { cache: 'no-store' });
    if(!resp.ok) throw new Error('Αποτυχία λήψης Materials JSON (HTTP ' + resp.status + ')');

    const json = await resp.json();
    if(!Array.isArray(json)) throw new Error('Το materials.json πρέπει να είναι JSON array');

    MAT_DATA = json;
    matPopulateCategoryOptions(MAT_DATA);
    renderMaterials();
  }catch(e){
    console.warn('Materials load:', e);
    MAT_DATA = [];
    if(msg){ msg.style.display='block'; msg.textContent = 'Υλικά: ' + (e?.message || String(e)); }
    renderMaterials();
  }finally{
    if(loader) loader.style.display = 'none';
  }
}

function renderMaterials(){
  const rows = document.getElementById('matRows');
  const summary = document.getElementById('matSummary');
  if(!rows) return;

  const useAOI = !!document.getElementById('matUseAOI')?.checked;
  const onlyStock = !!document.getElementById('matOnlyInStock')?.checked;
  const onlyLow = !!document.getElementById('matOnlyLowStock')?.checked;
  const cat = String(document.getElementById('matCategory')?.value || '').trim();
  const q = matNormalize(document.getElementById('matSearch')?.value || '');

  const list = Array.isArray(MAT_DATA) ? MAT_DATA : [];
  // Keep category list in sync (safe even if called often)
  try{ matPopulateCategoryOptions(list); }catch(_){ }

  const aoiSet = matGetAoiSet();
  const aoiActive = aoiSet.size > 0;

  let filtered = [];

  for(const it of list){
    const blob = matTextBlob(it);
    if(q && !blob.includes(q)) continue;

    if(cat && String(it?.category||'').trim() !== cat) continue;

    const meta = matQtyMeta(it);
    if(onlyStock && !meta.inStock) continue;
    if(onlyLow && !meta.low) continue;

    if(useAOI && aoiActive){
      const cov = matCoverageIds(it);
      if(!cov.length) continue;
      if(!matMatchesAOI(it, aoiSet)) continue;
    }

    filtered.push({ it, meta });
  }

  // Sort: low first, then name
  filtered.sort((a,b)=>{
    const rank = (x)=> x.meta.cls==='warn' ? 0 : (x.meta.cls==='ok' ? 1 : 2);
    const ra = rank(a), rb = rank(b);
    if(ra!==rb) return ra-rb;
    return String(a.it?.name||a.it?.item_id||'').localeCompare(String(b.it?.name||b.it?.item_id||''), 'el');
  });

  if(!filtered.length){
    rows.innerHTML = `<tr><td colspan="4" style="padding:10px;color:#6b7a86;font-size:12px;">(Κενό) Δεν βρέθηκαν υλικά για τα τρέχοντα φίλτρα.</td></tr>`;
  }else{
    rows.innerHTML = filtered.map(({it, meta})=>{
      const name = escapeHtml(String(it?.name || it?.item_id || '—'));
      const id = escapeHtml(String(it?.item_id || ''));
      const category = escapeHtml(String(it?.category || '—'));
      const loc = escapeHtml(String(it?.location || it?.warehouse || ''));
      const unit = meta.unit ? escapeHtml(meta.unit) : '';
      const qtyTxt = `${meta.qty}${unit ? ' ' + unit : ''}`;
      const minTxt = (meta.min!=null && isFinite(meta.min) && meta.min>0) ? ` · min ${meta.min}` : '';
      const pill = `<span class="mat-status ${meta.cls}">${escapeHtml(meta.label)}</span>`;

      const covIds = matCoverageIds(it);
      const covNames = covIds.length ? covIds.map(matMunicipalityName).join(', ') : '—';
      const cov = escapeHtml(covNames);

      const locHtml = loc ? `<div class="mat-loc">${loc}</div>` : '';

      return `
        <tr>
          <td style="text-align:left;padding-left:10px;">
            <div style="font-weight:900;">${name}</div>
            <div style="font-size:11px;color:#6b7a86;font-weight:800;">${id}</div>
          </td>
          <td>
            <div style="font-weight:900;">${category}</div>
            ${locHtml}
          </td>
          <td>
            ${pill}
            <div style="font-size:11px;color:#6b7a86;font-weight:800;margin-top:2px;">${escapeHtml(qtyTxt)}${escapeHtml(minTxt)}</div>
          </td>
          <td><span class="hr-coverage">${cov}</span></td>
        </tr>`;
    }).join('');
  }

  if(summary){
    const total = list.length;
    const shown = filtered.length;
    const aoiTxt = useAOI ? (aoiActive ? `AOI: ON (Δήμοι: ${aoiSet.size})` : 'AOI: ON (—)') : 'AOI: OFF';
    const stockTxt = onlyStock ? 'Stock: ON' : 'Stock: OFF';
    const lowTxt = onlyLow ? 'Low: ON' : 'Low: OFF';
    const catTxt = cat ? `Cat: ${cat}` : 'Cat: ALL';
    summary.textContent = `Υλικά: ${shown}/${total} | ${aoiTxt} | ${stockTxt} | ${lowTxt} | ${catTxt}`;
  }
}

function bindMaterialsUI(){
  const s = document.getElementById('matSearch');
  const a = document.getElementById('matUseAOI');
  const stock = document.getElementById('matOnlyInStock');
  const low = document.getElementById('matOnlyLowStock');
  const c = document.getElementById('matCategory');

  if(s && !s.dataset.bound){
    s.addEventListener('input', debounce(()=>renderMaterials(), 120));
    s.dataset.bound='true';
  }
  if(a && !a.dataset.bound){
    a.addEventListener('change', ()=>renderMaterials());
    a.dataset.bound='true';
  }
  if(stock && !stock.dataset.bound){
    stock.addEventListener('change', ()=>renderMaterials());
    stock.dataset.bound='true';
  }
  if(low && !low.dataset.bound){
    low.addEventListener('change', ()=>renderMaterials());
    low.dataset.bound='true';
  }
  if(c && !c.dataset.bound){
    c.addEventListener('change', ()=>renderMaterials());
    c.dataset.bound='true';
  }
}
/* ===================== /Materials (Supplies/Stock) ===================== */




async function fetchGeoJSON(path){
  if(GEO_CACHE.has(path)) return GEO_CACHE.get(path);
  const resp = await fetch(RAW_URL + path);
  if(!resp.ok) throw new Error("Δεν βρέθηκε: " + path);
  const json = await resp.json();
  GEO_CACHE.set(path, json);
  return json;
}


function setSelectedZoneLabels(name){
  const v = (name && String(name).trim()) ? String(name).trim() : '—';
  const ids = ['selectedBasinName','selectedAreaName','selectedHeatAreaName','selectedFrostAreaName'];
  ids.forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.textContent = v;
  });
}


function setSelectedBoundaryLabel(name){
  const v = (name && String(name).trim()) ? String(name).trim() : '—';
  const el = document.getElementById('selectedBoundaryName');
  if(el) el.textContent = v;
}


function setSelectedStreamLabel(name){
  const v = (name && String(name).trim()) ? String(name).trim() : '—';
  const el = document.getElementById('selectedStreamName');
  if(el) el.textContent = v;
}

/* ===================== LOAD / MAP / ON-OFF LOGIC ===================== */
async function loadToTool(path, name){
  updateMeteoStatus("Φόρτωση: " + name + "…");
  try{
    const gj = await fetchGeoJSON(path);

    
    const isBasin = path.includes('data/basins/');
    const isBoundary = path.includes('data/boundaries/');
    const isStream = path.includes('data/streams/') || path.includes('streams/geojson/');

    // ΔΙΟΙΚΗΤΙΚΑ ΟΡΙΑ: ενημερώνονται ΜΟΝΟ από boundaries (δεν επηρεάζουν την Επιλεγμένη περιοχή/ζώνη)
    if(isBoundary){
      SELECTED_BOUNDARY_GEO = gj;
      SELECTED_BOUNDARY_KEY = path;
      SELECTED_BOUNDARY_NAME = name;
      setSelectedBoundaryLabel(name);
      if(typeof scheduleSaveUiState==='function') scheduleSaveUiState();
      updateMeteoStatus(`Φορτώθηκε (Διοικητικά Όρια): ${name}`);
      return;
    }


    // ΥΔΡΟΓΡΑΦΙΚΟ ΔΙΚΤΥΟ: ενημερώνεται ΜΟΝΟ από streams (δεν επηρεάζει την Επιλεγμένη περιοχή/ζώνη)
    if(isStream){
      SELECTED_STREAM_GEO = gj;
      SELECTED_STREAM_KEY = path;
      SELECTED_STREAM_NAME = name;
      setSelectedStreamLabel(name);
      if(typeof scheduleSaveUiState==='function') scheduleSaveUiState();
      updateMeteoStatus(`Φορτώθηκε (Υδρογραφικό Δίκτυο): ${name}`);
      return;
    }

// ΕΠΙΛΕΓΜΕΝΗ ΠΕΡΙΟΧΗ/ΖΩΝΗ: ενημερώνεται ΜΟΝΟ από basins
    if(isBasin){
      SELECTED_GEO = gj;
      SELECTED_ZONE_KEY = path;
      SELECTED_ZONE_NAME = name;
      SELECTED_ZONE_KIND = 'basin';
      SELECTED_BASIN_KEY = path;

      setSelectedZoneLabels(name);
      if(typeof scheduleSaveUiState==='function') scheduleSaveUiState();

      // Populate tool inputs ONLY for basins (υδρολογικά στοιχεία)
      const p = getPropsMerged(gj);

      if(p.area!=null)   setVal('area', p.area);
      if(p.length!=null) setVal('length', p.length);
      if(p.height!=null) setVal('height', p.height);
      if(p.coef!=null)   setVal('coef', p.coef);

      if(p.drains!=null)   setVal('drains', p.drains);
      if(p.drainCap!=null) setVal('drainCap', p.drainCap);

      if(p.strWidth!=null) setVal('strWidth', p.strWidth);
      if(p.strZ!=null)     setVal('strZ', p.strZ);
      if(p.strDepth!=null) setVal('strDepth', p.strDepth);

      if(p.strLen!=null)   setVal('strLen', p.strLen);
      if(p.strDrop!=null)  setVal('strDrop', p.strDrop);

      if(p.strType!=null){
        const restoreSel = document.getElementById('strType');
        const val = String(p.strType);
        if(restoreSel && [...restoreSel.options].some(o=>String(o.value)===val)) restoreSel.value = val;
      }

      // IMPORTANT: do NOT auto-open map; do NOT change On/Off here
      updateMeteoStatus(`Φορτώθηκε στο εργαλείο (λεκάνη): ${name}`);

      // Recalculate + redraw (safe even if some values are missing)
      try{ runMasterCalculation(); }catch(_){}
      try{ drawBasinPlan(); }catch(_){}
    } else {
      // non-zone (streams etc): just cache + message
      updateMeteoStatus(`Φορτώθηκε (cache): ${name}`);
    }


  }catch(e){
    alert("Σφάλμα: " + e.message);
    updateMeteoStatus("Σφάλμα φόρτωσης.");
  }
}

// Map preview: opens map, zooms to that layer, WITHOUT changing On/Off
async function previewOnMap(path, name){
  try{
    noteGeoPick(path, name);
    openMapModal();
    const gj = await fetchGeoJSON(path);

    // remove old preview
    if(PREVIEW_LAYER && map){
      map.removeLayer(PREVIEW_LAYER);
      PREVIEW_LAYER = null;
    }

    const cat = categoryFromPath(path);
    PREVIEW_LAYER = L.geoJSON(gj, {
      style: styleForCategory(cat, true)
    }).addTo(map);

    try{
      map.fitBounds(PREVIEW_LAYER.getBounds(), { padding:[20,20] });
    }catch(_){}

    // ensure visible layers remain visible (do not alter VISIBLE)
    syncVisibleLayersToMap();
  }catch(e){
    console.error(e);
    alert("Map error: " + e.message);
  }
}

// On/Off toggle: NO map open; NO zoom; just state + map update if map is open
async function toggleLayer(path, name){
  try{ noteGeoPick(path, name); }catch(_){ }
  const btn = document.getElementById('btn-onoff-' + cssSafe(path));
  const turningOn = !VISIBLE.has(path);

  if(turningOn) VISIBLE.add(path);
  else VISIBLE.delete(path);

  if(btn){
    setOnOffBtn(btn, turningOn);
  }

  // only update map if already open
  if(map) syncVisibleLayersToMap();

  if(typeof scheduleSaveUiState==='function') scheduleSaveUiState();
}

// Turn everything off
function turnAllOff(){
  VISIBLE.clear();
  METEO_PRIMARY_VISIBLE = false;
  METEO_WATCH_VISIBLE = false;
  updateMeteoStationsRowButton();
  clearMeteoStationsPreview();

  // update buttons
  document.querySelectorAll('button[id^="btn-onoff-"]').forEach(b=>{
    setOnOffBtn(b, false);
  });
  if(map) syncVisibleLayersToMap();
}

/* ===================== MAP MODAL ===================== */
function openMapModal(){
  const modal = document.getElementById('mapModal');
  modal.style.display = 'flex';
  if(!map){
    map = L.map('mapBox', { zoomControl:true });
    baseLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
      maxZoom:19, attribution:'&copy; OpenStreetMap'
    }).addTo(map);
    map.setView([38.02, 23.80], 12);
  }
  setTimeout(()=>map.invalidateSize(), 80);
  syncVisibleLayersToMap();
  try{ syncAoiLayerToMap().catch(()=>{}); }catch(_){ }
}

function closeMapModal(){
  const modal = document.getElementById('mapModal');
  modal.style.display = 'none';
  // remove preview layer when closing (keeps On/Off layers persistent)
  if(PREVIEW_LAYER && map){
    map.removeLayer(PREVIEW_LAYER);
    PREVIEW_LAYER = null;
  }
  // remove meteo preview markers
  clearMeteoStationsPreview();
}

function categoryFromPath(path){
  if(path.includes('data/boundaries/')) return 'boundaries';
  if(path.includes('data/streams/') || path.includes('streams/geojson/')) return 'streams';
  return 'basins';
}

const LAST_GEO_PICK = { boundaries: null, streams: null, basins: null };

function noteGeoPick(path, name){
  try{
    const cat = categoryFromPath(path);
    if(!cat) return;
    LAST_GEO_PICK[cat] = { path, name, ts: Date.now() };
  }catch(_){}
}

function flashFilesMsg(text){
  try{
    const el = document.getElementById('filesMsg');
    if(!el) return;
    el.textContent = text;
    el.style.display = 'block';
    clearTimeout(window.__filesMsgT);
    window.__filesMsgT = setTimeout(()=>{ try{ el.style.display='none'; }catch(_){} }, 2600);
  }catch(_){}
}

function geoPickFromVisible(cat){
  try{
    for(const p of VISIBLE){
      if(categoryFromPath(p) === cat) return p;
    }
  }catch(_){}
  return null;
}

// Add a specific GeoJSON file to the main (data) panel (➕ next to each file)
function geoAddFromRow(cat, path, name){
  try{
    // persist "last pick" for consistency with existing logic
    LAST_GEO_PICK[cat] = { path, name };
    geoAddFromCategory(cat);
  }catch(e){
    console.warn('geoAddFromRow failed', e);
  }
}


function geoAddFromCategory(cat){
  try{
    const last = LAST_GEO_PICK[cat];
    let path = last && last.path;
    let name = last && last.name;

    if(!path){
      const p = geoPickFromVisible(cat);
      if(p){
        path = p;
        name = p.split('/').pop().replace('.geojson','');
      }
    }

    if(!path){
      const label = (cat==='boundaries') ? 'Διοικητικά Όρια' : (cat==='streams' ? 'Υδρογραφικό Δίκτυο' : 'Λεκάνες Απορροής');
      flashFilesMsg(`Δεν έχει επιλεγεί αρχείο για ${label}. Πάτησε 🗺 Map ή 👁 On σε ένα αρχείο πρώτα.`);
      return;
    }

    loadToTool(path, name);
    flashFilesMsg(`➕ Προστέθηκε στο κεντρικό panel: ${name}`);
  }catch(e){
    console.warn('geoAddFromCategory failed', e);
  }
}

function geoClearCategory(cat){
  try{
    if(cat === 'boundaries') resetSelectedBoundary();
    else if(cat === 'streams') resetSelectedStream();
    else resetSelectedZone();

    const label = (cat==='boundaries') ? 'Διοικητικά Όρια' : (cat==='streams' ? 'Υδρογραφικό Δίκτυο' : 'Λεκάνες Απορροής');
    flashFilesMsg(`🧹 Εκκαθάριση επιλογής: ${label}`);
  }catch(e){
    console.warn('geoClearCategory failed', e);
  }
}

function styleForCategory(cat, preview=false){
  if(cat==='boundaries'){
    return { color: preview ? '#e74c3c' : '#c0392b', weight: preview ? 3 : 2, fill:false, dashArray: preview ? '6 4' : null };
  }
  if(cat==='streams'){
    return { color: preview ? '#2ecc71' : '#2980b9', weight: preview ? 4 : 3, fill:false, dashArray: preview ? '6 4' : null };
  }
  // basins
  return { color: preview ? '#27ae60' : '#d35400', weight: preview ? 2 : 2, fill:true, fillOpacity: preview ? 0.12 : 0.18, dashArray: preview ? '6 4' : null };
}

// Ensure map shows exactly all "On" layers (plus preview if present)
async function syncVisibleLayersToMap(){
  if(!map) return;

  // remove cached layers not in VISIBLE
  for(const [path, layer] of LAYER_CACHE.entries()){
    if(!VISIBLE.has(path) && map.hasLayer(layer)){
      map.removeLayer(layer);
    }
  }

  // add layers in VISIBLE
  for(const path of VISIBLE){
    let layer = LAYER_CACHE.get(path);
    if(!layer){
      const gj = await fetchGeoJSON(path);
      const cat = categoryFromPath(path);
      layer = L.geoJSON(gj, { style: styleForCategory(cat, false) });
      LAYER_CACHE.set(path, layer);
    }
    if(!map.hasLayer(layer)) layer.addTo(map);
  }

  // 📡 Meteo stations (selected only)
  try{
    await refreshSelectedMeteoMarkers();
  }catch(_){ }

}

/* ===================== PROPERTIES EXTRACTION ===================== */
function getPropsMerged(gj){
  // merge props from FeatureCollection[0].properties or root.properties
  let p = {};
  try{
    if(gj && gj.features && gj.features[0] && gj.features[0].properties){
      p = {...gj.features[0].properties};
    } else if(gj && gj.properties){
      p = {...gj.properties};
    }
  }catch(_){}

  // normalize keys commonly used
  // area
  const area = pickNumber(p, ['A','a','area','Area','A_m2','area_m2','AREA_M2']);
  const length = pickNumber(p, ['L','l','length','Length','L_m','length_m','LEN_M']);
  const height = pickNumber(p, ['H','h','height','Height','H_m','height_m','DROP_M']);
  const coef = pickNumber(p, ['C','c','coef','Coef','runoff','runoff_coef']);

  const drains = pickNumber(p, ['drains','DrainCount','n_drains']);
  const drainCap = pickNumber(p, ['drainCap','DrainCap','drain_cap']);

  const strWidth = pickNumber(p, ['strWidth','b','width']);
  const strZ = pickNumber(p, ['strZ','z','side_slope']);
  const strDepth = pickNumber(p, ['strDepth','h_depth','depth']);

  const strLen = pickNumber(p, ['strLen','stream_len','channel_len']);
  const strDrop = pickNumber(p, ['strDrop','stream_drop','channel_drop']);
  const strType = pickNumber(p, ['strType','manning','n']);

  const out = {};
  if(area!=null) out.area = area;
  if(length!=null) out.length = length;
  if(height!=null) out.height = height;
  if(coef!=null) out.coef = coef;

  if(drains!=null) out.drains = drains;
  if(drainCap!=null) out.drainCap = drainCap;

  if(strWidth!=null) out.strWidth = strWidth;
  if(strZ!=null) out.strZ = strZ;
  if(strDepth!=null) out.strDepth = strDepth;

  if(strLen!=null) out.strLen = strLen;
  if(strDrop!=null) out.strDrop = strDrop;
  if(strType!=null) out.strType = strType;

  return out;
}

function pickNumber(obj, keys){
  for(const k of keys){
    if(obj && obj[k]!=null && String(obj[k]).trim()!==''){
      const n = parseFloat(String(obj[k]).replace(',','.'));
      if(isFiniteNumber(n)) return n;
    }
  }
  return null;
}

/* ===================== METEO: Stations list ===================== */

function normalizeStationUrl(u){
  u = (u || '').trim();
  if(!u) return '';
  // allow protocol-relative or missing scheme
  if(/^https?:\/\//i.test(u)) return u;
  if(/^\/\//.test(u)) return 'https:' + u;
  return 'https://' + u;
}

function parseStationsText(text, sourcePath){
  const entries = [];
  const lines = (text || '').split(/\r?\n/);
  for(const raw of lines){
    const line = (raw || '').trim();
    if(!line) continue;
    if(line.startsWith('#') || line.startsWith('//')) continue;

    let name = '';
    let url  = line;

    if(line.includes('|')){
      const parts = line.split('|');
      name = (parts.shift() || '').trim();
      url  = parts.join('|').trim();
    }else{
      name = url.replace(/^https?:\/\//i,'').slice(0, 60);
    }

    url = normalizeStationUrl(url);
    if(!url) continue;
    if(!name) name = url.replace(/^https?:\/\//i,'').slice(0, 60);

    entries.push({ name, url, from: sourcePath || '' });
  }
  return entries;
}

function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

/* ===================== DATETIME: 24h formatting ===================== */
function pad2(n){ return String(n).padStart(2,'0'); }

function formatDateTime24(d){
  if(!(d instanceof Date) || isNaN(d.getTime())) return '—';
  return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function parseAnyDateTime(ts, opts){
  if(ts == null) return null;
  if(ts instanceof Date) return ts;
  const assumeUTC = !!(opts && opts.assumeUTC);
  const s0 = String(ts).trim();
  if(!s0) return null;

  // Normalize ISO strings with space separator
  const s = s0.replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})/, '$1T$2');

  // If ISO includes explicit timezone (Z or +/-hh:mm), let Date parse it.
  if(/^\d{4}-\d{2}-\d{2}T\d{1,2}:\d{2}/.test(s) && /(Z|[+-]\d{2}:?\d{2})$/i.test(s)){
    const d = new Date(s);
    if(!isNaN(d.getTime())) return d;
  }

  // Greek / EU: dd/mm/yyyy, hh:mm(:ss) with optional π.μ./μ.μ.
  if(s0.includes('/')){
    const m = s0.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(π\.μ\.|μ\.μ\.))?/i);
    if(m){
      const day = parseInt(m[1],10);
      const mon = parseInt(m[2],10) - 1;
      const year = parseInt(m[3],10);
      let hh = parseInt(m[4],10);
      const mi = parseInt(m[5],10);
      const ss = parseInt(m[6] || '0',10);
      const mer = (m[7] || '').toLowerCase();

      if(mer.includes('μ.μ') && hh < 12) hh += 12;
      if(mer.includes('π.μ') && hh === 12) hh = 0;

      return new Date(year, mon, day, hh, mi, ss);
    }
  }

  // ISO-like without timezone: yyyy-mm-ddThh:mm(:ss)
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if(m2){
    const year = parseInt(m2[1],10);
    const mon = parseInt(m2[2],10) - 1;
    const day = parseInt(m2[3],10);
    const hh = parseInt(m2[4],10);
    const mi = parseInt(m2[5],10);
    const ss = parseInt(m2[6] || '0',10);
    return assumeUTC ? new Date(Date.UTC(year, mon, day, hh, mi, ss)) : new Date(year, mon, day, hh, mi, ss);
  }

  // Fallback: let Date try (RFC formats, etc.)
  const d = new Date(s0);
  if(!isNaN(d.getTime())) return d;

  return null;
}

function ts24(ts, opts){
  if(ts == null) return '—';
  const d = parseAnyDateTime(ts, opts);
  return d ? formatDateTime24(d) : String(ts);
}

function nowTs24(){
  return formatDateTime24(new Date());
}



function fmtCoord(v, digits=4){
  if(v == null) return '—';
  const n = Number(v);
  if(!isFinite(n)) return '—';
  return n.toFixed(digits);
}
function fmtElev(v){
  if(v == null) return '—';
  const n = Number(v);
  if(!isFinite(n)) return '—';
  return `${Math.round(n)} m`;
}
function getStationMeta(url){
  if(!url) return null;
  if(url === OPEN_METEO_TOKEN){
    return { lat:38.0237, lon:23.8007, elev:null };
  }
  return STATIONS_META.get(url) || null;
}
function updatePrimaryMetaCoords(){
  const url = getPrimaryStationUrl();
  const meta = getStationMeta(url);
  setTxt('stationLat', (meta && meta.lat != null) ? fmtCoord(meta.lat, 4) : '—');
  setTxt('stationLon', (meta && meta.lon != null) ? fmtCoord(meta.lon, 4) : '—');
  setTxt('stationElev', (meta && meta.elev != null) ? fmtElev(meta.elev) : '—');
}

function renderWatchlist(){
  const box = document.getElementById('watchlist');
  if(!box) return;
  box.innerHTML = '';
  if(!watchlist.size){
    box.innerHTML = '<span style="font-size:11px;color:#94a3b8;">(κανένας επιλεγμένος)</span>';
    return;
  }
  for(const [url,name] of watchlist.entries()){
    const chip = document.createElement('span');
    chip.className = 'chip watch';
    chip.innerHTML = `<b>${escapeHtml(name)}</b><button title="Αφαίρεση" aria-label="Αφαίρεση">✕</button>`;
    chip.querySelector('button').addEventListener('click', (e)=>{ 
      e.stopPropagation();
      watchlist.delete(url); 
      renderWatchlist(); 
      saveWatchlist();
      try{ refreshSelectedMeteoMarkers(); }catch(_){ }
      fetchStationData('extras');
    });
    chip.addEventListener('click', ()=>{
      const sel = document.getElementById('monitorStationSelect');
      if(!sel) return;
      const opt = Array.from(sel.options).find(o => o.value === url);
      if(opt){ sel.value = url; sel.dispatchEvent(new Event('change')); }
    });
    box.appendChild(chip);
  }
}

function setPrimaryStation(){
  const sel = document.getElementById('meteoStationSelect');
  if(!sel) return;

  const url = sel.value || '';
  if(!url){
    updatePrimaryStatus('Κύριος: Επέλεξε κύριο σταθμό.', 'warn');
    return;
  }

  // Apply as ACTIVE primary (only on ➕)
  const name = (sel.options[sel.selectedIndex]?.textContent || url).trim();
  ACTIVE_PRIMARY_URL = url;
  ACTIVE_PRIMARY_NAME = name;


  // Update meta line coords
  updatePrimaryMetaCoords();
  // update selected stations markers (if layer is On or map preview is used)
  try{ refreshSelectedMeteoMarkers(); }catch(_){ }

  // Make sure histories do not mix across different primary stations
  switchSeriesContext(url === OPEN_METEO_TOKEN ? 'open-meteo' : `url:${url}`);

  // Immediate fetch for active primary + any extras
  updatePrimaryStatus('Κύριος: Λήψη…', 'neutral');
  fetchStationData('primary');
}

function clearPrimaryStation(){
  const ok = __confirmClear("Καθαρισμός Κύριου Σταθμού (UI)", [
    "• Θα αφαιρεθεί ο κύριος σταθμός από την επιλογή.",
    "• Θα μηδενιστούν οι τιμές/ενδείξεις του κύριου σταθμού στην οθόνη."
  ]);
  if(!ok) return;

  // Clear ACTIVE primary (and keep watchlist/extras intact)
  ACTIVE_PRIMARY_URL = '';
  ACTIVE_PRIMARY_NAME = '';

  try{ refreshSelectedMeteoMarkers(); }catch(_){ }

  const sel = document.getElementById('meteoStationSelect');
  if(sel){
    sel.value = '';
    sel.dispatchEvent(new Event('change'));
  }

  // Clear main station display on the right
  setTxt('stationName','—');
  setTxt('stationTimestamp', '—');
  setTxt('stationTimestampInline', '—');
  updateStationFreshnessUI();
  updatePrimaryMetaCoords();
  setTxt('stationRainRate','—');
  setTxt('stationDP','—');
  setTxt('stationR60','—');
  setLatestValuesDisplay(null,'—');
  setStationMsg('—');

  // Reset series context to default
  switchSeriesContext('open-meteo');

  // Update statuses
  if(watchlist.size){
    updatePrimaryStatus('Κύριος: (καθαρίστηκε)', 'neutral');
  } else {
    updatePrimaryStatus('Κύριος: (δεν έχει επιλεγεί)', 'warn');
  }
}

function addToWatchlistFromMonitor(){
  const sel = document.getElementById('monitorStationSelect');
  if(!sel) return;
  const v = String(sel.value || '').trim();

  if(!v){
    updateExtrasStatus('Επιπλέον: Επέλεξε σταθμό παρακολούθησης.', 'warn');
    return;
  }

  // ALL επιλογές
  if(v === ALL_API_TOKEN || v === ALL_WEB_TOKEN || v === ALL_ALL_TOKEN){
    let label = '';
    let pairs = [];

    if(v === ALL_API_TOKEN){
      label = 'API / JSON';
      pairs = getSelectGroupPairs(sel, label);
    }else if(v === ALL_WEB_TOKEN){
      label = 'Web / Links';
      pairs = getSelectGroupPairs(sel, label);
    }else{
      label = 'API + Web';
      pairs = [
        ...getSelectGroupPairs(sel, 'API / JSON'),
        ...getSelectGroupPairs(sel, 'Web / Links')
      ];
    }

    if(!pairs.length){
      updateExtrasStatus(`Επιπλέον: Δεν βρέθηκαν σταθμοί για ${label}.`, 'warn');
      return;
    }

    let added = 0;
    for(const {url, name} of pairs){
      if(!watchlist.has(url)) added++;
      watchlist.set(url, name || url);
    }

    renderWatchlist();
    saveWatchlist();
    try{ refreshSelectedMeteoMarkers(); }catch(_){ }
    fetchStationData('extras');
    updateExtrasStatus(`Επιπλέον: Προστέθηκαν ${added} σταθμοί (${label}).`, 'ok');
    return;
  }

  const url = v;
  const name = (sel.options[sel.selectedIndex]?.textContent || url).trim();
  watchlist.set(url, name);

  renderWatchlist();
  saveWatchlist();
  try{ refreshSelectedMeteoMarkers(); }catch(_){ }
  fetchStationData('extras');
}

// backward compat (older UI)
function addToWatchlist(){
  return addToWatchlistFromMonitor();
}

function clearWatchlist(){
  const ok = __confirmClear("Καθαρισμός Επιπλέον Σταθμών (Παρακολούθηση)", [
    "• Θα αφαιρεθούν ΟΛΟΙ οι επιπλέον σταθμοί (watchlist).",
    "• Θα κλείσουν/καθαριστούν οι κάρτες & οι τιμές τους στην οθόνη."
  ]);
  if(!ok) return;

  watchlist.clear();
  renderWatchlist();
  saveWatchlist();
  try{ refreshSelectedMeteoMarkers(); }catch(_){ }

  // reset monitor dropdown back to placeholder
  const monSel = document.getElementById('monitorStationSelect');
  if(monSel){
    monSel.value = '';
    monSel.dispatchEvent(new Event('change'));
  }

  const multi = document.getElementById('stationMultiList');
  if(multi){ multi.style.display='none'; multi.innerHTML=''; }

  updateExtrasStatus('Επιπλέον: (καθαρίστηκαν)', 'neutral');

  // also reset main station display if there is NO active primary
  if(!getPrimaryStationUrl()){
    setTxt('stationName','—');
    setTxt('stationTimestamp', '—');
  setTxt('stationTimestampInline', '—');
  updateStationFreshnessUI();
  setTxt('stationRainRate','—');
    setTxt('stationDP','—');
    setTxt('stationR60','—');
    setLatestValuesDisplay(null,'—');
    updatePrimaryStatus('Κύριος: (δεν έχει επιλεγεί)', 'warn');
  }
}

function getFetchTargets(){
  const primaryUrl = getPrimaryStationUrl();
  const primaryName = primaryUrl ? (getPrimaryStationName() || primaryUrl) : '';
  const targets = [];
  if(primaryUrl) targets.push({url: primaryUrl, name: primaryName, primary:true});
  for(const [url,name] of watchlist.entries()){
    if(url && url !== primaryUrl) targets.push({url, name, primary:false});
  }
  return targets;
}

function renderStationMultiList(results){
  const box = document.getElementById('stationMultiList');
  if(!box) return;
  const primaryUrl = getPrimaryStationUrl();
  const rest = (results||[]).filter(r => !primaryUrl || r.url !== primaryUrl);
  if(!rest.length){ box.style.display='none'; box.innerHTML=''; return; }

  // cache latest fetched results so we can refresh a single station without refetching all
  try{
    MULTI_RESULTS_BY_URL.clear();
    rest.forEach(r=>{ if(r && r.url) MULTI_RESULTS_BY_URL.set(r.url, r); });
  }catch(_){}


const rows = rest.map(r=>{
    const ts = ts24(r.tsText || '—');
    const meta = getStationMeta(r.url);
    const latTxt = (meta && meta.lat != null) ? fmtCoord(meta.lat, 4) : '—';
    const lonTxt = (meta && meta.lon != null) ? fmtCoord(meta.lon, 4) : '—';
    const elevTxt = (meta && meta.elev != null) ? fmtElev(meta.elev) : '—';

    const ageCls = ageClassFromTimestamp(ts);

    const items = makeLatestChipItems(r.latest);
    const chips = items.length
      ? items.map(it => `
          <div class="chip${it.v==='—' ? ' empty' : ''}">
            <div class="el">${escapeHtml(it.el)}</div>
            <div class="en">${escapeHtml(it.en)}</div>
            <div class="val">${escapeHtml(it.v)}</div>
          </div>`).join('')
      : `<div style="font-size:11px;color:#94a3b8;padding:4px 0;">—</div>`;

    const chipCount = items.length || 12;

    return `<div class="multi-block">
      <div class="multi-row">
        <div class="multi-meta-line">
          <span class="meta-item">
            <span class="multi-name ${ageCls}">${escapeHtml(r.name || '—')}</span>
            <button class="meta-icon-btn no-print" data-u="${encodeURIComponent(r.url || '')}" onclick="event.preventDefault();event.stopPropagation();openStationUrl(decodeURIComponent(this.dataset.u))" title="Άνοιγμα URL σταθμού">🔗</button>
            <button class="meta-icon-btn no-print" data-u="${encodeURIComponent(r.url || '')}" onclick="event.preventDefault();event.stopPropagation();focusStationOnMapByUrl(decodeURIComponent(this.dataset.u))" title="Εστίαση στον χάρτη">📍</button>
            <button class="meta-icon-btn no-print" data-u="${encodeURIComponent(r.url || '')}" onclick="event.preventDefault();event.stopPropagation();refreshExtraStation(decodeURIComponent(this.dataset.u), this)" title="Ανανέωση δεδομένων (μόνο αυτού του σταθμού)">⟳</button>
          </span>
          <span class="meta-item"><span class="meta-label">Timestamp:</span><span class="multi-ts">${escapeHtml(ts)}</span></span>
          <span class="meta-item"><span class="meta-label">LAT:</span><span class="meta-val">${escapeHtml(latTxt)}</span></span>
          <span class="meta-item"><span class="meta-label">LON:</span><span class="meta-val">${escapeHtml(lonTxt)}</span></span>
          <span class="meta-item"><span class="meta-label">ELEV:</span><span class="meta-val">${escapeHtml(elevTxt)}</span></span>
        </div>
      </div>
      <div class="multi-latest">
        <div class="latest-chips multi" style="--chip-count:${chipCount}">
          ${chips}
        </div>
      </div>
    </div>`;
  }).join('');

  box.style.display = 'block';

  const openAttr = MULTI_DETAILS_OPEN ? 'open' : '';
  box.innerHTML = `
    <details id="multiDetails" ${openAttr} style="margin-top:0;">
      <summary class="monitor-section-title" style="cursor:pointer;margin-bottom:6px;">
        Επιπλέον σταθμοί
      </summary>
      <div class="multi-table">${rows}</div>
    </details>
  `;

  // persist open/closed state across re-renders (Load/Live refresh)
  const md = document.getElementById('multiDetails');
  if (md) {
    md.addEventListener('toggle', () => {
      MULTI_DETAILS_OPEN = md.open;
    }, { passive: true });
  }
}


async function readStationsFromTxt(path){
  const resp = await fetch(RAW_URL + path, { cache: 'no-store' });
  if(!resp.ok) throw new Error(`Δεν φορτώθηκε: ${path}`);
  const text = await resp.text();
  return parseStationsText(text, path);
}

function bindStationSelect(){
  if(STATION_SELECT_BOUND) return;
  const sel = document.getElementById('meteoStationSelect');
  if(!sel) return;

  sel.addEventListener('change', ()=>{
    const url = sel.value || '';
    if(!url){
      updatePrimaryStatus('Κύριος: (δεν έχει επιλεγεί)', 'warn');
      return;
    }
    // A new selection is pending until the user presses ➕
    updatePrimaryStatus('Κύριος: Αναμονή…', 'neutral');
  });

  STATION_SELECT_BOUND = true;
}


let MONITOR_SELECT_BOUND = false;
function bindMonitorSelect(){
  if(MONITOR_SELECT_BOUND) return;
  const sel = document.getElementById('monitorStationSelect');
  if(!sel) return;

  sel.addEventListener('change', ()=>{
    const url = sel.value || '';
    if(!url){
      updateExtrasStatus('Επιπλέον: (δεν έχει επιλεγεί)', 'warn');
      return;
    }
    // A new selection is pending until the user presses ➕
    updateExtrasStatus('Επιπλέον: Αναμονή…', 'neutral');
  });

  MONITOR_SELECT_BOUND = true;
}

// New loader: populate dropdown from folder structure
async function fetchStationsFromFolders(files){
  try{
    const apiTxt = (files||[]).filter(p=>p.startsWith('data/meteostations/api/'));
    const webTxt = (files||[]).filter(p=>p.startsWith('data/meteostations/weblinks/'));
    if(apiTxt.length===0 && webTxt.length===0) return false;

    const apiItems = [];
    const webItems = [];
    const seen = new Set();

    const addItems = (arr, into)=>{
      for(const it of arr){
        const url = normalizeStationUrl(it.url || '');
        if(!url) continue;
        if(seen.has(url)) continue;
        seen.add(url);
        into.push({ name: (it.name||url).trim(), url, from: it.from || '' });
      }
    };

    for(const p of apiTxt){
      const items = await readStationsFromTxt(p);
      addItems(items.map(x=>({name:x.name,url:x.url,from:p})), apiItems);
    }
    for(const p of webTxt){
      const items = await readStationsFromTxt(p);
      addItems(items.map(x=>({name:x.name,url:x.url,from:p})), webItems);
    }

    const fill = (sel, placeholder)=>{
      if(!sel) return;
      sel.innerHTML = '';
      const opt0 = document.createElement('option');
      opt0.value = '';
      opt0.textContent = placeholder;
      sel.appendChild(opt0);

      const grpApi  = document.createElement('optgroup'); grpApi.label  = 'API / JSON';
      const grpLink = document.createElement('optgroup'); grpLink.label = 'Web / Links';


      // Global/Quick ALL (μόνο για Παρακολούθηση)
      let grpAll = null;
      if(sel.id === 'monitorStationSelect'){
        grpAll = document.createElement('optgroup');
        grpAll.label = 'ALL';

        const optAll = document.createElement('option');
        optAll.value = ALL_ALL_TOKEN;
        optAll.textContent = 'ALL (API + Web)';
        grpAll.appendChild(optAll);

        const optAllApi = document.createElement('option');
        optAllApi.value = ALL_API_TOKEN;
        optAllApi.textContent = 'ALL (API / JSON)';
        grpApi.appendChild(optAllApi);

        const optAllWeb = document.createElement('option');
        optAllWeb.value = ALL_WEB_TOKEN;
        optAllWeb.textContent = 'ALL (Web / Links)';
        grpLink.appendChild(optAllWeb);
      }

      // Built-in Open-Meteo (no external file required)
      {
        const opt = document.createElement('option');
        opt.value = OPEN_METEO_TOKEN;
        opt.textContent = 'Open‑Meteo (Χαλάνδρι)';
        grpApi.appendChild(opt);
      }

      for(const it of apiItems){
        const opt = document.createElement('option');
        opt.value = it.url;
        opt.textContent = it.name;
        if(it.from) opt.dataset.from = it.from;
        grpApi.appendChild(opt);
      }
      for(const it of webItems){
        const opt = document.createElement('option');
        opt.value = it.url;
        opt.textContent = it.name;
        if(it.from) opt.dataset.from = it.from;
        grpLink.appendChild(opt);
      }

      if(grpAll) sel.appendChild(grpAll);
      sel.appendChild(grpApi);
      sel.appendChild(grpLink);
    };

    fill(document.getElementById('meteoStationSelect'), 'Επιλογή κύριου σταθμού...');
    fill(document.getElementById('monitorStationSelect'), 'Επιλογή σταθμού παρακολούθησης...');

    bindStationSelect();
    bindMonitorSelect();
    updateMeteoStatus(`Σταθμοί: API ${apiItems.length}, Web ${webItems.length}`, 'neutral');
    return true;
  }catch(err){
    console.warn('stations from folders failed', err);
    return false;
  }
}


async function fetchStations(path){
  try{
    const resp = await fetch(RAW_URL + path);
    const text = await resp.text();
    const lines = text.split('\n').map(s=>s.trim()).filter(Boolean);

    const apiItems = [];
    const webItems = [];

    for(const line of lines){
      let name="", url=line;
      let lat=null, lon=null, elev=null;

      if(line.includes('|')){
        const parts = line.split('|').map(p=>String(p||'').trim());
        name = (parts[0]||'').trim();
        url  = (parts[1]||'').trim();
        lat  = parts[2] ? parseFloat(parts[2]) : null;
        lon  = parts[3] ? parseFloat(parts[3]) : null;
        elev = parts[4] ? parseFloat(parts[4]) : null;
      }else{
        name = url.replace(/^https?:\/\//,'').slice(0,50);
      }

      url = normalizeStationUrl(url);

      if(!url) continue;

      // Store meta if provided (lat/lon/elev) - used for map markers (selected only)
      const latOk = Number.isFinite(lat);
      const lonOk = Number.isFinite(lon);
      const elevOk = Number.isFinite(elev);

      const prev = STATIONS_META.get(url);
      const prevHasCoords = prev && Number.isFinite(prev.lat) && Number.isFinite(prev.lon);

      // Prefer new coordinates when available; otherwise keep existing if any
      if(!prev || (latOk && lonOk) || !prevHasCoords){
        STATIONS_META.set(url, {
          name: name || (prev ? prev.name : 'Station'),
          url,
          lat: (latOk ? lat : (prev ? prev.lat : null)),
          lon: (lonOk ? lon : (prev ? prev.lon : null)),
          elev: (elevOk ? Math.round(elev) : (prev ? prev.elev : null))
        });
      }else if(name && prev && !prev.name){
        prev.name = name;
      }

      const isApi = /(exec|api|json|\?)/i.test(url) && !/penteli\.meteo\.gr\/stations/i.test(url);
      (isApi ? apiItems : webItems).push({name: name || 'Station', url, from: path});
    }

    const fill = (sel, placeholder)=>{
      if(!sel) return;
      sel.innerHTML = '';
      const opt0 = document.createElement('option');
      opt0.value = '';
      opt0.textContent = placeholder;
      sel.appendChild(opt0);

      const grpApi  = document.createElement('optgroup'); grpApi.label  = 'API / JSON';
      const grpLink = document.createElement('optgroup'); grpLink.label = 'Web / Links';


      // Global/Quick ALL (μόνο για Παρακολούθηση)
      let grpAll = null;
      if(sel.id === 'monitorStationSelect'){
        grpAll = document.createElement('optgroup');
        grpAll.label = 'ALL';

        const optAll = document.createElement('option');
        optAll.value = ALL_ALL_TOKEN;
        optAll.textContent = 'ALL (API + Web)';
        grpAll.appendChild(optAll);

        const optAllApi = document.createElement('option');
        optAllApi.value = ALL_API_TOKEN;
        optAllApi.textContent = 'ALL (API / JSON)';
        grpApi.appendChild(optAllApi);

        const optAllWeb = document.createElement('option');
        optAllWeb.value = ALL_WEB_TOKEN;
        optAllWeb.textContent = 'ALL (Web / Links)';
        grpLink.appendChild(optAllWeb);
      }

      // Built-in Open-Meteo (no external file required)
      {
        const opt = document.createElement('option');
        opt.value = OPEN_METEO_TOKEN;
        opt.textContent = 'Open‑Meteo (Χαλάνδρι)';
        grpApi.appendChild(opt);
      }

      for(const it of apiItems){
        const opt = document.createElement('option');
        opt.value = it.url;
        opt.textContent = it.name;
        opt.dataset.from = it.from;
        grpApi.appendChild(opt);
      }
      for(const it of webItems){
        const opt = document.createElement('option');
        opt.value = it.url;
        opt.textContent = it.name;
        opt.dataset.from = it.from;
        grpLink.appendChild(opt);
      }
      if(grpAll) sel.appendChild(grpAll);
      sel.appendChild(grpApi);
      sel.appendChild(grpLink);
    };

    fill(document.getElementById('meteoStationSelect'), 'Επιλογή κύριου σταθμού...');
    fill(document.getElementById('monitorStationSelect'), 'Επιλογή σταθμού παρακολούθησης...');

    bindStationSelect();
    bindMonitorSelect();
  }catch(e){
    console.error(e);
  }
}

function openPrimaryWeb(){
  // Prefer pending selection (dropdown). If empty, fallback to active primary (if any).
  const url = getPendingPrimaryUrl() || getPrimaryStationUrl();
  if(!url){
    updatePrimaryStatus('Κύριος: Δεν έχει επιλεγεί σταθμός.', 'warn');
    return;
  }
  if(url === OPEN_METEO_TOKEN) { window.open('https://open-meteo.com/', '_blank'); return; }
  window.open(normalizeStationUrl(url), '_blank');
}
function openMonitorWeb(){
  // Open ALL monitored (watchlist) stations
  if(watchlist && watchlist.size){
    let opened = 0;
    const primaryUrl = getPrimaryStationUrl();
    for(const [url] of watchlist.entries()){
      if(primaryUrl && url === primaryUrl) continue;
      if(!url) continue;
      if(url === OPEN_METEO_TOKEN) { window.open('https://open-meteo.com/', '_blank'); opened++; continue; }
      window.open(normalizeStationUrl(url), '_blank');
      opened++;
    }
    if(opened) updateExtrasStatus(`Επιπλέον: Άνοιξαν ${opened} σταθμοί σε νέες καρτέλες.`, 'ok');
    else updateExtrasStatus('Επιπλέον: Δεν υπάρχουν έγκυρα URLs.', 'warn');
    return;
  }

  // Fallback: open currently selected option (if any)
  const sel = document.getElementById('monitorStationSelect');
  const url = String(sel?.value || '').trim();

  if(!url){
    updateExtrasStatus('Επιπλέον: Δεν έχουν επιλεγεί σταθμοί παρακολούθησης.', 'warn');
    return;
  }

  // ALL επιλογές: άνοιγμα όλων των links της ομάδας (χωρίς να απαιτείται watchlist)
  if(url === ALL_API_TOKEN || url === ALL_WEB_TOKEN || url === ALL_ALL_TOKEN){
    let label = '';
    let pairs = [];

    if(url === ALL_API_TOKEN){
      label = 'API / JSON';
      pairs = getSelectGroupPairs(sel, label);
    }else if(url === ALL_WEB_TOKEN){
      label = 'Web / Links';
      pairs = getSelectGroupPairs(sel, label);
    }else{
      label = 'API + Web';
      pairs = [
        ...getSelectGroupPairs(sel, 'API / JSON'),
        ...getSelectGroupPairs(sel, 'Web / Links')
      ];
    }

    let opened = 0;
    for(const {url:u} of pairs){
      if(!u) continue;
      if(u === OPEN_METEO_TOKEN) { window.open('https://open-meteo.com/', '_blank'); opened++; continue; }
      window.open(normalizeStationUrl(u), '_blank');
      opened++;
    }

    if(opened) updateExtrasStatus(`Επιπλέον: Άνοιξαν ${opened} links (${label}).`, 'ok');
    else updateExtrasStatus(`Επιπλέον: Δεν υπάρχουν έγκυρα URLs για ${label}.`, 'warn');
    return;
  }

  if(url === OPEN_METEO_TOKEN) { window.open('https://open-meteo.com/', '_blank'); return; }
  window.open(normalizeStationUrl(url), '_blank');
}

// backward compat
function openStationWeb(){ return openPrimaryWeb(); }

/* ===================== STATION ACTIONS (per station) ===================== */
function openStationUrl(url){
  const u = String(url || '').trim();
  if(!u) return;
  if(u === OPEN_METEO_TOKEN){ window.open('https://open-meteo.com/', '_blank'); return; }
  window.open(normalizeStationUrl(u), '_blank');
}

function openPrimaryActiveUrl(){
  const url = getPrimaryStationUrl();
  if(!url){
    updatePrimaryStatus('Κύριος: Δεν έχει επιλεγεί σταθμός.', 'warn');
    return;
  }
  openStationUrl(url);
}

function focusStationOnMapByUrl(url){
  const u = String(url || '').trim();
  if(!u) return;
  let meta = null;
  try{ meta = getStationMeta(u); }catch(_){}
  // fallback for Open‑Meteo token (approx Chalandri)
  if(!meta && u === OPEN_METEO_TOKEN){
    meta = { name:'Open‑Meteo (Χαλάνδρι)', url:u, lat:38.0237, lon:23.8007, elev:null };
  }
  if(meta && typeof meta.lat === 'number' && typeof meta.lon === 'number'){
    try{ __dbFocusMap(meta.lat, meta.lon, meta.name || 'Σταθμός'); }catch(_){}
  }else{
    try{
      if(typeof updatePrimaryStatus === 'function'){
        updatePrimaryStatus('Χάρτης: Δεν υπάρχουν συντεταγμένες για τον σταθμό.', 'warn');
      }
    }catch(_){}
  }
}

function openPrimaryActiveMap(){
  const url = getPrimaryStationUrl();
  if(!url){
    try{ if(typeof updatePrimaryStatus==='function') updatePrimaryStatus('Κύριος: Δεν έχει επιλεγεί σταθμός.', 'warn'); }catch(_){}
    return;
  }
  focusStationOnMapByUrl(url);
}


function __setBtnBusy(btn, busy){
  if(!btn) return;
  btn.disabled = !!busy;
  btn.classList.toggle('spinning', !!busy);
}

function refreshPrimaryOnly(btn){
  __setBtnBusy(btn, true);
  Promise.resolve(fetchStationData('primary')).finally(()=> __setBtnBusy(btn, false));
}

async function refreshExtraStation(url, btn){
  const u0 = String(url || '').trim();
  if(!u0) return;
  const u = normalizeStationUrl(u0) || u0;
  const name = (watchlist && watchlist.get(u)) || (getStationMeta(u)?.name) || u;

  __setBtnBusy(btn, true);
  try{
    const r = await fetchStationDataSingle(u, name, false);
    if(r){
      MULTI_RESULTS_BY_URL.set(u, r);
      renderStationMultiList(Array.from(MULTI_RESULTS_BY_URL.values()));
    }
  }catch(e){
    console.error(e);
  }finally{
    __setBtnBusy(btn, false);
  }
}


/* ===================== METEO: Fetch (API button) ===================== */

async function fetchStationDataSingle(url, label, updatePrimary){
  if(!url) return null;

  if(updatePrimary){
    // Primary station has its own context (do not mix histories across different sources)
    switchSeriesContext(url === OPEN_METEO_TOKEN ? 'open-meteo' : `url:${url}`);
    updatePrimaryStatus("Κύριος: Λήψη…", "neutral");
    setTxt('stationName', label || '—');
  }

  try{
    // 0) Built-in Open‑Meteo (token)
    if(url === OPEN_METEO_TOKEN){
      const r = await fetchOpenMeteoPayload();
      lastStationPayload = r;

      const latest = parseOpenMeteoLatest(r);
      const rr = (latest && latest.rr!=null) ? latest.rr : null;

      const tsRaw = latest?.__openMeteo?.time || r?.current?.time || new Date().toISOString();
      const ts = ts24(tsRaw);

      const seriesKey = updatePrimary ? currentStationKey : (`url:${url}`);
      const totalsSeries = deriveCumulativeTotalsForKey(seriesKey, latest?.__openMeteo?.amount);

      if(updatePrimary){
        updateStationMonitor(rr!=null ? rr : null, ts, totalsSeries);
        setLatestValuesDisplay(latest, buildLatestLine(latest));
        setStationMsg('Λήψη από Open‑Meteo.');

        if(rr!=null){
          onNewStationSample(String(ts), ts, rr, label || 'Open‑Meteo', totalsSeries, latest);
          runMasterCalculation();
        }
      }

      if(!updatePrimary && rr!=null){
        storeSampleForKey(seriesKey, String(ts), ts, rr, label || 'Open‑Meteo', totalsSeries, false, latest);
      }

      return { ok:true, url, name: label, rr, tsText: ts, latest: latest, latestLine: buildLatestLine(latest) };
    }

    // 1) If URL is a JSON endpoint
    if(/json|api|exec|\?/i.test(url) && !/penteli\.meteo\.gr\/stations/i.test(url)){
      const r = await fetch(url, {cache:'no-store'}).then(res=>res.json());
      lastStationPayload = r;

      // Open‑Meteo payload: fill ALL latest chips from the API
      if(isOpenMeteoPayload(r)){
        const latest = parseOpenMeteoLatest(r);
        const rr = (latest && latest.rr!=null) ? latest.rr : null;

        const tsRaw = latest?.__openMeteo?.time || extractTimestamp(r) || new Date().toISOString();
        const ts = ts24(tsRaw);

        const seriesKey = updatePrimary ? currentStationKey : (`url:${url}`);
        const totalsSeries = deriveCumulativeTotalsForKey(seriesKey, latest?.__openMeteo?.amount);

        if(updatePrimary){
          updateStationMonitor(rr!=null ? rr : null, ts, totalsSeries);
          setLatestValuesDisplay(latest, buildLatestLine(latest));
setStationMsg("Λήψη από Open‑Meteo endpoint.");

          // ΠΑΝΤΑ: κράτα δείγμα για το Monitoring/Scenario ακόμη κι αν δεν υπάρχει RainRate (rr)
          onNewStationSample(String(ts), ts, (rr!=null ? rr : null), label || 'Open‑Meteo', totalsSeries, latest);

          // Μόνο αν υπάρχει rr έχει νόημα να τρέξει ο υδρολογικός υπολογισμός
          if(rr!=null){
            runMasterCalculation();
          }
        }

        if(!updatePrimary && rr!=null){
          storeSampleForKey(seriesKey, String(ts), ts, rr, label || 'Open‑Meteo', totalsSeries, false, latest);
        }

        return { ok:true, url, name: label, rr, tsText: ts, latest: latest, latestLine: buildLatestLine(latest) };
      }


      const rr = extractRainRate(r);
      const tsRaw = extractTimestamp(r) || new Date().toISOString();
      const ts = ts24(tsRaw);
      const totals = extractTotals(r);

      if(updatePrimary){
        setTxt('stationTimestamp', ts);
  setTxt('stationTimestampInline', ts);
  updateStationFreshnessUI();
  setTxt('stationRainRate', (rr!=null && isFiniteNumber(rr)) ? rr.toFixed(1) : '—');
        setTxt('stationTotalSrc', totals.totalSrc === 'storm' ? '(storm)' : totals.totalSrc === 'today' ? '(today)' : '');
        // compact Latest line for JSON endpoints (usually only rain metrics are available)
        {
          const parts = [];
          if(rr!=null && isFiniteNumber(rr)) parts.push(`Rate ${rr.toFixed(1)} mm/h`);
          if(totals && totals.today!=null) parts.push(`Today ${totals.today.toFixed(1)} mm`);
          if(totals && totals.storm!=null) parts.push(`Storm ${totals.storm.toFixed(1)} mm`);
          setLatestValuesDisplay({ rr: rr, today: (totals && totals.today!=null ? totals.today : null), storm: (totals && totals.storm!=null ? totals.storm : null) }, parts.length ? parts.join(' • ') : '—');
        }
setStationMsg("Λήψη από endpoint.");

        // ΠΑΝΤΑ: κράτα δείγμα για Monitoring/Scenario ακόμη κι αν δεν υπάρχει RainRate (rr)
        onNewStationSample(String(ts), ts, (rr!=null ? rr : null), label || 'Station', totals, (parsed && parsed.latest) ? parsed.latest : null);

        runMasterCalculation();
      }

      if(!updatePrimary && rr!=null){
        // keep separate history for this station even when it is in "Επιπλέον σταθμοί"
        storeSampleForKey(`url:${url}`, String(ts), ts, rr, label || 'Station', totals, false, (parsed && parsed.latest) ? parsed.latest : null);
      }

      return { ok:true, url, name: label, rr, tsText: ts, latest: { rr: rr, today: (totals && totals.today!=null) ? totals.today : null, storm: (totals && totals.storm!=null) ? totals.storm : null }, latestLine: null };
    }

    // 2) If it's a meteo station page (Penteli)
    if(/penteli\.meteo\.gr\/stations/i.test(url)){
      const mirrorUrl = url.startsWith('https://') ? ('https://r.jina.ai/' + url) : ('https://r.jina.ai/https://' + url);
      const text = await fetch(mirrorUrl, {cache:'no-store'}).then(res=>res.text());

      const parsed = parseMeteoPageMinimal(text);
      const rr = parsed?.rr ?? null;
      const tsRaw = parsed?.timestamp ?? new Date().toISOString();
      const ts = ts24(tsRaw, {assumeUTC: !!parsed?.timestampIsUTC});
      const totals = parsed?.totals ?? null;

      if(updatePrimary){
        setTxt('stationTimestamp', ts);
  setTxt('stationTimestampInline', ts);
  updateStationFreshnessUI();
  setTxt('stationRainRate', (rr!=null && isFiniteNumber(rr)) ? rr.toFixed(1) : '—');
        setTxt('stationTotalSrc', totals && totals.totalSrc === 'storm' ? '(storm)' : totals && totals.totalSrc === 'today' ? '(today)' : '');
        setLatestValuesDisplay((parsed && parsed.latest) ? parsed.latest : null, (parsed && parsed.latestLine) ? parsed.latestLine : '—');
setStationMsg("Λήψη μέσω mirror (r.jina.ai).");

        // keep a sample for Monitoring/Scenario (primary) even if RainRate is missing
        onNewStationSample(String(ts), ts, (rr!=null ? rr : null), label || 'Station', totals, (parsed && parsed.latest) ? parsed.latest : null);

        // Only if there is a rain rate does the hydrology calculation add value
        if(rr!=null){
          runMasterCalculation();
        }
      }

      if(!updatePrimary && rr!=null){
        // keep separate history for this station even when it is in "Επιπλέον σταθμοί"
        storeSampleForKey(`url:${url}`, String(ts), ts, rr, label || 'Station', totals, false, (parsed && parsed.latest) ? parsed.latest : null);
      }

      return { ok:true, url, name: label, rr, tsText: ts, latest: (parsed && parsed.latest) ? parsed.latest : null, latestLine: (parsed && parsed.latestLine) ? parsed.latestLine : null };
    }

    if(updatePrimary){
      updatePrimaryStatus("Κύριος: Δεν είναι API — χρησιμοποίησε το Web.", "warn");
      setStationMsg("Μη-API σύνδεσμος.");
    }
    return { ok:false, url, name: label, rr: null, tsText: '—', latest: null, latestLine: null, error: "Μη υποστηριζόμενος σύνδεσμος (όχι API)." };

  }catch(e){
    console.error(e);
    if(updatePrimary){
      updatePrimaryStatus("Κύριος: Σφάλμα λήψης δεδομένων.", "warn");
      setStationMsg("Σφάλμα: " + e.message);
    }
    return { ok:false, url, name: label, rr: null, tsText: '—', latest: null, latestLine: null, error: (e && e.message) ? e.message : String(e) };
  }
}

async function fetchStationData(mode='both'){
  const allTargets = getFetchTargets();
  const primaryTarget = allTargets.find(t => t.primary);
  const extrasTargetsAll = allTargets.filter(t => !t.primary);

  // Select targets based on mode
  let targets = allTargets;
  if(mode === 'primary'){
    targets = primaryTarget ? [primaryTarget] : [];
  } else if(mode === 'extras'){
    targets = extrasTargetsAll;
  }

  // Handle empty based on mode (do NOT touch the other status pill)
  if(mode === 'primary'){
    if(!primaryTarget){
      updatePrimaryStatus('Κύριος: Επέλεξε κύριο σταθμό.', 'warn');
      return;
    }
    updatePrimaryStatus('Κύριος: Λήψη…', 'neutral');
  } else if(mode === 'extras'){
    if(!extrasTargetsAll.length){
      updateExtrasStatus('Επιπλέον: Πρόσθεσε επιπλέον σταθμούς.', 'neutral');
      const multi = document.getElementById('stationMultiList');
      if(multi){ multi.style.display='none'; multi.innerHTML=''; }
      return;
    }
    updateExtrasStatus('Επιπλέον: Λήψη…', 'neutral');
  } else {
    if(!allTargets.length){
      updatePrimaryStatus('Κύριος: Επέλεξε κύριο σταθμό.', 'warn');
      updateExtrasStatus('Επιπλέον: Πρόσθεσε επιπλέον σταθμούς.', 'neutral');
      return;
    }

    if(primaryTarget) updatePrimaryStatus('Κύριος: Λήψη…', 'neutral');
    else updatePrimaryStatus('Κύριος: (δεν έχει επιλεγεί)', 'warn');

    if(extrasTargetsAll.length) updateExtrasStatus('Επιπλέον: Λήψη…', 'neutral');
    else updateExtrasStatus('Επιπλέον: (κανένας)', 'neutral');
  }

  const settled = await Promise.allSettled(
    targets.map(t => fetchStationDataSingle(t.url, t.name, t.primary))
  );

  const results = [];
  let primaryErr = null;
  let primaryOk = false;
  const extrasErrors = [];

  settled.forEach((s, i)=>{
    const t = targets[i];
    if(s.status === 'fulfilled'){
      if(s.value) results.push(s.value);

      if(t.primary){
        if(s.value && s.value.ok === true){
          primaryOk = true;
        } else {
          const er = (s.value && s.value.error) ? s.value.error : 'δεν φορτώθηκαν δεδομένα';
          primaryErr = `${t.name || t.url}: ${er}`;
        }
      } else {
        if(!(s.value && s.value.ok === true)){
          const nm = (s.value?.name || t.name || t.url);
          const er = (s.value?.error || 'δεν φορτώθηκαν δεδομένα');
          extrasErrors.push(`${nm}: ${er}`);
        }
      }
    } else {
      const er = (s.reason && s.reason.message) ? s.reason.message : String(s.reason || 'σφάλμα');
      if(t.primary){
        primaryErr = `${t.name || t.url}: ${er}`;
      } else {
        extrasErrors.push(`${t.name || t.url}: ${er}`);
      }
    }
  });

  // Update multi list only when we fetched extras (or both)
  if(mode !== 'primary'){
    renderStationMultiList(results);
  }

  // Primary status (only when we fetched primary, or both)
  if(mode !== 'extras' && primaryTarget){
    if(primaryOk && !primaryErr){
      updatePrimaryStatus('Κύριος: Λήψη OK', 'ok');
    } else {
      updatePrimaryStatus('Κύριος: Προειδοποίηση: ' + (primaryErr || 'δεν φορτώθηκαν δεδομένα'), 'warn');
    }
  }

  // Extras status (only when we fetched extras, or both)
  if(mode !== 'primary' && extrasTargetsAll.length){
    if(extrasErrors.length){
      const short = extrasErrors.length <= 2
        ? extrasErrors.join(' • ')
        : (extrasErrors.slice(0,2).join(' • ') + ` • (+${extrasErrors.length-2} ακόμη)`);
      updateExtrasStatus('Επιπλέον: Προειδοποίηση: ' + short, 'warn');
    } else {
      updateExtrasStatus('Επιπλέον: Λήψη OK', 'ok');
    }
  }
}



function getOpenMeteoCoords(){
  // default coords near Chalandri
  let lat = 38.02, lon = 23.80;

  // if selected basin exists, use first coordinate as quick proxy
  try{
    if(SELECTED_GEO && SELECTED_GEO.features && SELECTED_GEO.features[0]){
      const g = SELECTED_GEO.features[0].geometry;
      let c = null;
      if(g.type === 'Polygon') c = g.coordinates?.[0]?.[0];
      if(g.type === 'MultiPolygon') c = g.coordinates?.[0]?.[0]?.[0];
      if(g.type === 'LineString') c = g.coordinates?.[0];
      if(Array.isArray(c) && c.length>=2){
        lon = c[0]; lat = c[1];
      }
    }
  }catch(e){ /* ignore */ }

  return {lat, lon};
}

async function fetchOpenMeteoPayload(){
  const {lat, lon} = getOpenMeteoCoords();

  const currentVars = [
    'temperature_2m',
    'relative_humidity_2m',
    'apparent_temperature',
    'precipitation',
    'pressure_msl',
    'surface_pressure',
    'wind_speed_10m',
    'wind_direction_10m'
  ].join(',');

  const hourlyVars = ['dew_point_2m','precipitation'].join(',');
  const dailyVars  = ['rain_sum','precipitation_sum'].join(',');

  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=${encodeURIComponent(dailyVars)}&hourly=${encodeURIComponent(hourlyVars)}&current=${encodeURIComponent(currentVars)}&timezone=Europe%2FAthens&forecast_days=1&forecast_hours=1&past_hours=1`;

  const r = await fetch(u, {cache:'no-store'}).then(res=>res.json());
  if(r && r.error) throw new Error(r.reason || 'Open‑Meteo error');
  return r;
}

/* ===== Open-Meteo button (uses basin centroid if available) ===== */
async function fetchLiveMeteo(){
  updatePrimaryStatus("Κύριος: Λήψη…", "neutral");

  // Treat Open-Meteo as its own source/context
  switchSeriesContext('open-meteo');
  setTxt('stationName','Open‑Meteo');

  try{
    const r = await fetchOpenMeteoPayload();

    const latest = parseOpenMeteoLatest(r);
    const rr = latest?.rr ?? null;
    const tsRaw = latest?.__openMeteo?.time || r?.current?.time || new Date().toISOString();
    const ts = ts24(tsRaw);

    // Build derived cumulative totals so ΔP/R60 work
    const totalsSeries = deriveCumulativeTotalsForKey(currentStationKey, latest?.__openMeteo?.amount);

    updateStationMonitor(rr!=null ? rr : null, ts, totalsSeries);
    setLatestValuesDisplay(latest, buildLatestLine(latest));
    updatePrimaryStatus("Κύριος: Λήψη OK", "ok");

    if(rr!=null){
      onNewStationSample(String(ts), ts, rr, 'Open‑Meteo', totalsSeries, latest);
      setStationMsg("Live από Open‑Meteo (current + hourly + daily).");
      runMasterCalculation();
    } else {
      setStationMsg("Open‑Meteo: δεν υπάρχει διαθέσιμη τιμή βροχόπτωσης.");
    }

  }catch(e){
    console.error(e);
    updatePrimaryStatus("Κύριος: Προειδοποίηση: Σφάλμα Open‑Meteo", "warn");
    setStationMsg("Σφάλμα Open‑Meteo: " + e.message);
  }
}

/* ===================== Station monitor logic ===================== */
function extractRainRate(obj){
  // common keys (explicit mm/h)
  const keys = ['rainRate_mmh','rain_rate','rainRate','i','intensity','precipitation_rate','precip_rate'];
  for(const k of keys){
    if(obj && obj[k]!=null){
      const n = parseFloat(String(obj[k]).replace(',','.'));
      if(isFiniteNumber(n)) return n;
    }
  }

  // Open-Meteo: prefer an explicit rate if present
  const n2 = obj?.current?.precipitation_rate;
  if(isFiniteNumber(n2)) return n2;

  // Open-Meteo: derive rate from precipitation amount and interval (seconds)
  const p = obj?.current?.precipitation;
  const interval = obj?.current?.interval;
  if(isFiniteNumber(p) && isFiniteNumber(interval) && interval > 0){
    return (p * 3600) / interval;
  }

  // Fallback: use hourly precipitation at the nearest hour (treated as mm/h)
  const t = obj?.current?.time;
  if(t && Array.isArray(obj?.hourly?.time) && Array.isArray(obj?.hourly?.precipitation)){
    const idx = nearestTimeIndex(t, obj.hourly.time);
    const hp = obj.hourly.precipitation[idx];
    if(isFiniteNumber(hp)) return hp;
  }

  return null;
}
function extractTimestamp(obj){
  const keys = ['station_ts','timestamp','time','datetime','dateTime','lastUpdate','last_update'];
  for(const k of keys){
    if(obj && obj[k]) return String(obj[k]).trim();
  }
  // open-meteo
  if(obj?.current?.time) return String(obj.current.time);
  return null;
}
function extractTotals(obj){
  const t = {};
  t.today = pickNumber(obj, ['rainToday_mm','rain_today_mm','todayRain','today_rain']);
  t.storm = pickNumber(obj, ['stormTotal_mm','storm_total_mm','rainStorm','storm_total']);
  if(t.storm!=null){ t.total=t.storm; t.totalSrc='storm'; }
  else if(t.today!=null){ t.total=t.today; t.totalSrc='today'; }
  else { t.total=null; t.totalSrc=null; }
  return t;
}

/* ===================== Open‑Meteo helpers ===================== */
function isOpenMeteoPayload(obj){
  return !!(obj && obj.current && (
    obj.current.temperature_2m != null ||
    obj.current.relative_humidity_2m != null ||
    obj.current.apparent_temperature != null ||
    obj.current.pressure_msl != null ||
    obj.current.wind_speed_10m != null
  ));
}

function degToCompass(deg){
  if(deg == null || !isFiniteNumber(deg)) return '';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  const d = ((Number(deg) % 360) + 360) % 360;
  const i = Math.round(d / 22.5) % 16;
  return dirs[i];
}

function nearestTimeIndex(targetTs, timeArr){
  if(!Array.isArray(timeArr) || !timeArr.length) return 0;
  const t0 = parseAnyDateTime(targetTs);
  if(!t0) return 0;

  let bestI = 0;
  let best = Infinity;
  const t0ms = t0.getTime();

  for(let i=0;i<timeArr.length;i++){
    const d = parseAnyDateTime(timeArr[i]);
    if(!d) continue;
    const diff = Math.abs(d.getTime() - t0ms);
    if(diff < best){
      best = diff;
      bestI = i;
    }
  }
  return bestI;
}

function deriveCumulativeTotalsForKey(seriesKey, amount){
  // Builds a local (session-only) cumulative so ΔP/R60 can work even when the API
  // does not provide storm/today running totals.
  if(amount == null || !isFiniteNumber(amount)) return null;

  const key = seriesKey || currentStationKey || 'open-meteo';
  const series = stationSeriesByKey[key] || [];
  const prev = series.length ? series[series.length-1] : null;
  const prevTotal = (prev && prev.total!=null && isFiniteNumber(prev.total)) ? prev.total : 0;
  const newTotal = prevTotal + Number(amount);

  return { total: newTotal, totalSrc: 'storm', today: null, storm: null };
}

function parseOpenMeteoLatest(obj){
  const r = obj || {};
  const cur = r.current || {};
  const latest = {};

  latest.temp = isFiniteNumber(cur.temperature_2m) ? Number(cur.temperature_2m) : null;
  latest.hum  = isFiniteNumber(cur.relative_humidity_2m) ? Number(cur.relative_humidity_2m) : null;

  // Dew point: prefer current if present, else nearest hourly
  if(isFiniteNumber(cur.dew_point_2m)){
    latest.dew = Number(cur.dew_point_2m);
  } else if(Array.isArray(r?.hourly?.time) && Array.isArray(r?.hourly?.dew_point_2m)){
    const idx = nearestTimeIndex(cur.time || r.hourly.time[r.hourly.time.length-1], r.hourly.time);
    const v = r.hourly.dew_point_2m[idx];
    latest.dew = isFiniteNumber(v) ? Number(v) : null;
  } else {
    latest.dew = null;
  }

  // Wind: speed + compass from degrees
  const ws = isFiniteNumber(cur.wind_speed_10m) ? Number(cur.wind_speed_10m) : null;
  const wd = isFiniteNumber(cur.wind_direction_10m) ? Number(cur.wind_direction_10m) : null;
  if(ws != null){
    const dir = (wd != null) ? degToCompass(wd) : '';
    latest.wind = `${ws.toFixed(1)} km/h${dir ? (' ' + dir) : ''}`;
  }

  // Pressure
  latest.baro = isFiniteNumber(cur.pressure_msl) ? Number(cur.pressure_msl)
              : (isFiniteNumber(cur.surface_pressure) ? Number(cur.surface_pressure) : null);

  // Rain (day totals): use daily rain_sum (rain only) and precipitation_sum (all)
  const d = r.daily || {};
  const dayRain = (Array.isArray(d.rain_sum) && isFiniteNumber(d.rain_sum[0])) ? Number(d.rain_sum[0]) : null;
  const dayPrec = (Array.isArray(d.precipitation_sum) && isFiniteNumber(d.precipitation_sum[0])) ? Number(d.precipitation_sum[0]) : null;
  latest.today = (dayRain != null) ? dayRain : dayPrec;
  latest.storm = (dayPrec != null) ? dayPrec : latest.today;

  // Rain rate: derive from current precipitation amount + interval
  let rr = null;
  let amount = null;
  if(isFiniteNumber(cur.precipitation)){
    amount = Number(cur.precipitation);
    if(isFiniteNumber(cur.interval) && Number(cur.interval) > 0){
      rr = (amount * 3600) / Number(cur.interval);
    } else {
      rr = amount; // fallback (treat as mm/h)
    }
  }
  // fallback: use nearest hourly precipitation (treated as mm/h)
  if(rr == null && Array.isArray(r?.hourly?.time) && Array.isArray(r?.hourly?.precipitation)){
    const idx = nearestTimeIndex(cur.time || r.hourly.time[r.hourly.time.length-1], r.hourly.time);
    const hp = r.hourly.precipitation[idx];
    if(isFiniteNumber(hp)) rr = Number(hp);
  }
  latest.rr = rr;

  // Monthly / yearly not available from forecast endpoint by default
  latest.month = null;
  latest.year  = null;

  // Apparent temperature → show as Wind Chill (cold) or Heat Index (warm)
  const app = isFiniteNumber(cur.apparent_temperature) ? Number(cur.apparent_temperature) : null;
  if(app != null){
    if(latest.temp != null && latest.temp >= 18){
      latest.heat = app;
      latest.chill = null;
    } else {
      latest.chill = app;
      latest.heat = null;
    }
  } else {
    latest.chill = null;
    latest.heat = null;
  }

  latest.__openMeteo = {
    time: cur.time || null,
    interval: isFiniteNumber(cur.interval) ? Number(cur.interval) : null,
    amount: amount
  };

  return latest;
}


function pickMatchFromText(text, rx, group=1){
  const m = text.match(rx);
  return m ? String(m[group]).trim() : null;
}
function pickNumFromText(text, rx, group=1){
  const s = pickMatchFromText(text, rx, group);
  if(s == null) return null;
  const n = parseFloat(String(s).replace(',','.'));
  return isFiniteNumber(n) ? n : null;
}
function fmtNum(n, dec=1){
  return (n!=null && isFiniteNumber(n)) ? Number(n).toFixed(dec) : null;
}
function buildLatestLine(lat){
  if(!lat) return null;
  const parts = [];
  if(lat.temp!=null) parts.push(`T ${fmtNum(lat.temp,1)}°C`);
  if(lat.hum!=null) parts.push(`RH ${fmtNum(lat.hum,0)}%`);
  if(lat.dew!=null) parts.push(`Td ${fmtNum(lat.dew,1)}°C`);
  if(lat.wind) parts.push(`Wind ${lat.wind}`);
  if(lat.baro!=null) parts.push(`P ${fmtNum(lat.baro,1)} hPa`);
  if(lat.today!=null) parts.push(`Today ${fmtNum(lat.today,1)} mm`);
  if(lat.rr!=null) parts.push(`Rate ${fmtNum(lat.rr,1)} mm/h`);
  if(lat.storm!=null) parts.push(`Storm ${fmtNum(lat.storm,1)} mm`);
  if(lat.month!=null) parts.push(`Month ${fmtNum(lat.month,1)} mm`);
  if(lat.year!=null) parts.push(`Year ${fmtNum(lat.year,1)} mm`);
  if(lat.chill!=null) parts.push(`Chill ${fmtNum(lat.chill,1)}°C`);
  if(lat.heat!=null) parts.push(`Heat ${fmtNum(lat.heat,1)}°C`);
return parts.length ? parts.join(' • ') : null;
}



function makeLatestChipItems(lat){
  // Return a FIXED, ordered set of chips so all station rows align perfectly.
  // If a metric is missing, we keep its slot and show "—" (styled as .empty).
  if(!lat || typeof lat !== 'object') return [];


  const vTemp  = (lat.temp  != null) ? `${fmtNum(lat.temp,1)} °C`  : '—';
  const vHum   = (lat.hum   != null) ? `${fmtNum(lat.hum,0)} %`    : '—';
  const vDew   = (lat.dew   != null) ? `${fmtNum(lat.dew,1)} °C`   : '—';
  const vWind  = (lat.wind  != null && String(lat.wind).trim()) ? String(lat.wind).trim() : '—';
  const vBaro  = (lat.baro  != null) ? `${fmtNum(lat.baro,1)} hPa` : '—';

  const vToday = (lat.today != null) ? `${fmtNum(lat.today,1)} mm` : '—';
  const vRr    = (lat.rr    != null) ? `${fmtNum(lat.rr,1)} mm/h`  : '—';
  const vStorm = (lat.storm != null) ? `${fmtNum(lat.storm,1)} mm` : '—';
  const vMonth = (lat.month != null) ? `${fmtNum(lat.month,1)} mm` : '—';
  const vYear  = (lat.year  != null) ? `${fmtNum(lat.year,1)} mm`  : '—';

  const vChill = (lat.chill != null) ? `${fmtNum(lat.chill,1)} °C` : '—';
  const vHeat  = (lat.heat  != null) ? `${fmtNum(lat.heat,1)} °C`  : '—';

  return [
    { el:'Θερμοκρασία',        en:'Temperature',  v: vTemp  },
    { el:'Υγρασία',            en:'Humidity',     v: vHum   },
    { el:'Σημείο Δρόσου',      en:'Dew Point',    v: vDew   },
    { el:'Άνεμος',             en:'Wind',         v: vWind  },
    { el:'Βαρόμετρο',          en:'Barometer',    v: vBaro  },

    { el:'Σημερινός Υετός',    en:"Today's Rain", v: vToday },
    { el:'Ραγδαιότητα',        en:'Rain Rate',    v: vRr    },
    { el:'Τρέχουσα κακοκαιρία',en:'Storm Total',  v: vStorm },
    { el:'Μηνιαίος Υετός',     en:'Monthly Rain', v: vMonth },
    { el:'Ετήσιος Υετός',      en:'Yearly Rain',  v: vYear  },

    { el:'Αίσθηση ψύχους',     en:'Wind Chill',   v: vChill },
    { el:'Δείκτης δυσφορίας',  en:'Heat Index',   v: vHeat  },
  ];
}


function setLatestValuesDisplay(lat, lineText){
  // hidden/plain text (for copy/debug)
  if(lineText != null) setTxt('stationLatestValues', lineText);
  else if(lat) setTxt('stationLatestValues', buildLatestLine(lat) || '—');
  else setTxt('stationLatestValues', '—');

  const wrap = document.getElementById('stationLatestChips');
  if(!wrap) return;

  const items = makeLatestChipItems(lat);
  wrap.style.setProperty('--chip-count', String(items.length || 0));

  wrap.innerHTML = '';
  if(!items.length){
    wrap.textContent = '—';
    return;
  }

  for(const it of items){
    const chip = document.createElement('div');
    chip.className = 'chip' + (it.v === '—' ? ' empty' : '');

    const el = document.createElement('div');
    el.className = 'el';
    el.textContent = it.el;

    const en = document.createElement('div');
    en.className = 'en';
    en.textContent = it.en;

    const v = document.createElement('div');
    v.className = 'val';
    v.textContent = it.v;

    chip.appendChild(el);
    chip.appendChild(en);
    chip.appendChild(v);
    wrap.appendChild(chip);
  }
}


function parseMeteoPageMinimal(text){
  const out = { rr: null, timestamp: null, timestampIsUTC: false, totals: null, latest: null, latestLine: null };

  // 1) Prefer the visible timestamp near "Latest Values / Τελευταίες Τιμές" (LOCAL time)
  let mTs = text.match(/(?:Latest Values|Τελευταίες\s*Τιμές)[\s\S]{0,160}?(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2})(?::(\d{2}))?/i);
  if(mTs){
    out.timestamp = `${mTs[1]}, ${mTs[2]}:${mTs[3] || '00'}`;
    out.timestampIsUTC = false;
  }

  // 2) "Timestamp:" style (often present in page source; ISO-like is typically UTC)
  if(!out.timestamp){
    const ts1 = text.match(/Timestamp\s*:?\s*([^\n<]{8,80})/i);
    if(ts1){
      out.timestamp = ts1[1].trim();
      out.timestampIsUTC = /\d{4}-\d{2}-\d{2}/.test(out.timestamp);
    }
  }

  // 3) ISO-like fallback anywhere (treat as UTC)
  if(!out.timestamp){
    const ts2 = text.match(/(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2})?)/);
    if(ts2){
      out.timestamp = ts2[1].trim();
      out.timestampIsUTC = true;
    }
  }

  // rain rate (mm/h)
  let m = text.match(/Βροχ[^\n]{0,40}?([0-9]+(?:\.[0-9]+)?)\s*mm\/h/i);
  if(!m) m = text.match(/([0-9]+(?:\.[0-9]+)?)\s*mm\/h/i);
  if(m) out.rr = Number(m[1]);

  // totals (today/storm) — supports Penteli/NOA pages like Chalandri:
  // "Today's Rain / Σημερινός Υετός" and "Storm Total / Τρέχουσα κακοκαιρία"
  let today = null, storm = null;

  const mtoday1 = text.match(/Σύνολο\s*Ημέρας[\s\S]{0,80}?([0-9]+(?:\.[0-9]+)?)\s*mm/i);
  const mtoday2 = text.match(/(?:Today's\s*Rain|Σημερινός\s*Υετός)[\s\S]{0,80}?([0-9]+(?:\.[0-9]+)?)\s*mm/i);
  if(mtoday1) today = Number(mtoday1[1]);
  else if(mtoday2) today = Number(mtoday2[1]);

  const mstorm1 = text.match(/Σύνολο\s*Καταιγίδας[\s\S]{0,80}?([0-9]+(?:\.[0-9]+)?)\s*mm/i);
  const mstorm2 = text.match(/(?:Storm\s*Total|Τρέχουσα\s*κακοκαιρία)[\s\S]{0,80}?([0-9]+(?:\.[0-9]+)?)\s*mm/i);
  if(mstorm1) storm = Number(mstorm1[1]);
  else if(mstorm2) storm = Number(mstorm2[1]);

  let total = null, totalSrc = null;
  if(storm != null){ total = storm; totalSrc = 'storm'; }
  else if(today != null){ total = today; totalSrc = 'today'; }

  if(total != null) out.totals = { today, storm, total, totalSrc };

    // ---------- Latest Values (full line) ----------
    const latest = {};
    latest.temp = pickNumFromText(text, /(?:Temperature|Θερμοκρασία)[\s\S]{0,80}?(-?\d+(?:\.\d+)?)\s*°\s*C/i);
    latest.hum  = pickNumFromText(text, /(?:Humidity|Υγρασία)[\s\S]{0,80}?(\d+(?:\.\d+)?)\s*%/i);
    latest.dew  = pickNumFromText(text, /(?:Dew\s*Point|Σημείο\s*Δρόσου)[\s\S]{0,80}?(-?\d+(?:\.\d+)?)\s*°\s*C/i);

    // Wind: "4.8 Km/h at W"
    const windSpeed = pickNumFromText(text, /(?:Wind|Άνεμος)[\s\S]{0,80}?(\d+(?:\.\d+)?)\s*(?:Km\/h|km\/h)/i);
    const windDir   = pickMatchFromText(text, /(?:Wind|Άνεμος)[\s\S]{0,80}?\d+(?:\.\d+)?\s*(?:Km\/h|km\/h)\s*(?:at\s*)?([A-Za-z]{1,3})/i);
    if(windSpeed!=null){
      latest.wind = `${Number(windSpeed).toFixed(1)} km/h${windDir ? (' ' + windDir.toUpperCase()) : ''}`;
    }

    latest.baro = pickNumFromText(text, /(?:Barometer|Βαρόμετρο)[\s\S]{0,80}?(\d+(?:\.\d+)?)\s*hPa/i);

    // Rain fields
    latest.today = (today!=null ? today : null);
    latest.storm = (storm!=null ? storm : null);
    latest.rr    = (out.rr!=null ? out.rr : null);
    latest.month = pickNumFromText(text, /(?:Monthly\s*Rain|Μηνιαίος\s*Υετός)[\s\S]{0,80}?(\d+(?:\.\d+)?)\s*mm/i);
    latest.year  = pickNumFromText(text, /(?:Yearly\s*Rain|Ετήσιος\s*Υετός)[\s\S]{0,80}?(\d+(?:\.\d+)?)\s*mm/i);

    // Derived indices
    latest.chill = pickNumFromText(text, /(?:Wind\s*Chill|Αίσθηση\s*ψύχους)[\s\S]{0,80}?(-?\d+(?:\.\d+)?)\s*°\s*C/i);
    latest.heat  = pickNumFromText(text, /(?:Heat\s*Index|Δείκτης\s*δυσφορίας)[\s\S]{0,80}?(-?\d+(?:\.\d+)?)\s*°\s*C/i);

    // Sunrise / Sunset
    latest.sunrise = pickMatchFromText(text, /(?:Sunrise|Ανατολή)[\s\S]{0,80}?(\d{1,2}:\d{2})/i);
    latest.sunset  = pickMatchFromText(text, /(?:Sunset|Δύση)[\s\S]{0,80}?(\d{1,2}:\d{2})/i);

    out.latest = latest;
    out.latestLine = buildLatestLine(latest);

  return out;
}

function parseMeteoPage(text){
  // very lightweight heuristic (may vary by station page)
  // Try to find a mm/h value near "Rain Rate" or "mm/h"
  const rx = /([0-9]+(?:\.[0-9]+)?)\s*mm\/h/i;
  const m = text.match(rx);
  const rainRate = m ? parseFloat(m[1]) : null;

  // Try to find a timestamp-like pattern
  const tx = /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/;
  const t = text.match(tx);
  const timestamp = t ? t[1] : null;

  return { rainRate, timestamp };
}

function updateStationMonitor(rainRate, tsText, totals){
  setTxt('stationTimestamp', tsText ? ts24(tsText) : '—');
  setTxt('stationRainRate', (rainRate!=null && isFiniteNumber(rainRate)) ? rainRate.toFixed(1) : '—');

  // dp/r60 derived from series
  if(totals && totals.total!=null){
    setTxt('stationTotalSrc', totals.totalSrc === 'storm' ? '(Storm)' : (totals.totalSrc === 'today' ? '(Σήμερα)' : ''));
  } else {
    setTxt('stationTotalSrc','');
  }
  updateStationReadouts();
}

function storeSampleForKey(seriesKey, sampleKey, tsText, val, label, totals, updateUI, latest) {
  const key = seriesKey || 'open-meteo';
  if(!sampleKey) return;

  const series = stationSeriesByKey[key] || [];
  // allow update-in-place when the same timestamp key arrives again (e.g. hourly Open‑Meteo refresh)
  const existingIdx = series.findIndex(s => s.key === sampleKey);
  const prev = (existingIdx >= 0)
    ? (existingIdx > 0 ? series[existingIdx-1] : null)
    : (series.length ? series[series.length-1] : null);

  const l = (latest && typeof latest === 'object') ? latest : {};
  const dewV = isFiniteNumber(l.dewPoint) ? l.dewPoint : (isFiniteNumber(l.dew) ? l.dew : null);

  let dp = null;
  if(totals && totals.total!=null && prev && prev.total!=null && prev.totalSrc && prev.totalSrc === totals.totalSrc){
    dp = totals.total - prev.total;
    if(dp < 0) dp = totals.total;
  }

  const dParsed = parseAnyDateTime(tsText) || new Date();
  const dateMs = dParsed.getTime();

  const sampleObj = {
    key: sampleKey,
    tsText: tsText || sampleKey,
    tsMs: dateMs,
    val,
    rainRate: (typeof val === 'number') ? val : null,
    label,
    stationName: (typeof label === 'string' && label.trim()) ? label : null,
    total: totals ? totals.total : null,
    totalSrc: totals ? totals.totalSrc : null,
    dp,
    dateMs,

    // extra metrics (match the "cards" UI + DB table)
    temp: isFiniteNumber(l.temp) ? l.temp : null,
    hum:  isFiniteNumber(l.hum) ? l.hum : null,
    dewPoint: dewV,
    wind: (typeof l.wind === 'string' && l.wind.trim()) ? l.wind : null,
    baro: isFiniteNumber(l.baro) ? l.baro : null,

    today: isFiniteNumber(l.today) ? l.today : (totals && isFiniteNumber(totals.today) ? totals.today : null),
    storm: isFiniteNumber(l.storm) ? l.storm : (totals && isFiniteNumber(totals.storm) ? totals.storm : null),
    month: isFiniteNumber(l.month) ? l.month : null,
    year:  isFiniteNumber(l.year)  ? l.year  : null,

    chill: isFiniteNumber(l.chill) ? l.chill : null,
    heat:  isFiniteNumber(l.heat)  ? l.heat  : null,
    sunrise: (typeof l.sunrise === 'string' && l.sunrise.trim()) ? l.sunrise : null,
    sunset:  (typeof l.sunset  === 'string' && l.sunset.trim())  ? l.sunset  : null
  };

  if(existingIdx >= 0){
    series[existingIdx] = Object.assign(series[existingIdx], sampleObj);
  } else {
    series.push(sampleObj);
  }

  const __lim = getSeriesLimit();
  if(series.length > __lim){
    series.splice(0, series.length - __lim);
  }

  stationSeriesByKey[key] = series;
  stationLastKeyByKey[key] = sampleKey;

  // keep an always-fresh snapshot for Scenario mini-panels
  try{
    if(typeof currentStationKey !== 'undefined' && key === currentStationKey){
      window.__PRIMARY_LATEST_SAMPLE = (existingIdx >= 0) ? series[existingIdx] : (series.length ? series[series.length-1] : null);
    }
  }catch(_){ }

  // ---- FIREBASE LOG (non-blocking) ----
  if(existingIdx < 0){
  try{
    const l = (latest && typeof latest === 'object') ? latest : {};

    // attach station meta (for DB table cohesion + map focus)
    let stationUrl = null, stationName = (label || null), lat = null, lon = null, elev = null;
    try{
      const sk = String(key || '');
      let u = sk;
      if(sk.startsWith('url:')) u = sk.slice(4);
      if(sk === 'open-meteo') u = (typeof OPEN_METEO_TOKEN !== 'undefined') ? OPEN_METEO_TOKEN : sk;
      stationUrl = u;
      let meta = null;
      if(typeof getStationMeta === 'function') meta = getStationMeta(u);
      stationName = meta?.name || stationName;
      lat  = (typeof meta?.lat  === 'number') ? meta.lat  : null;
      lon  = (typeof meta?.lon  === 'number') ? meta.lon  : null;
      elev = (typeof meta?.elev === 'number') ? meta.elev : null;
    }catch(_){}

    const payload = {
      tsMs: dateMs,
      tsText: (tsText || sampleKey),
      sampleKey: sampleKey,
      rainRate: (typeof val === 'number') ? val : null,
      label: label || null,
      stationUrl: stationUrl,
      stationName: stationName,
      lat: (typeof lat === "number") ? lat : null,
      lon: (typeof lon === "number") ? lon : null,
      elev: (typeof elev === "number") ? elev : null,
      dp: (typeof dp === 'number') ? dp : null,
      total: (totals && typeof totals.total === 'number') ? totals.total : null,
      totalSrc: totals ? (totals.totalSrc || null) : null,

      // extra metrics (match the "cards" UI)
      temp: isFiniteNumber(l.temp) ? l.temp : null,
      hum: isFiniteNumber(l.hum) ? l.hum : null,
      dewPoint: isFiniteNumber(l.dewPoint) ? l.dewPoint : (isFiniteNumber(l.dew) ? l.dew : null),
      wind: (typeof l.wind === 'string' && l.wind.trim()) ? l.wind : null,
      baro: isFiniteNumber(l.baro) ? l.baro : null,

      today: isFiniteNumber(l.today) ? l.today : (totals && isFiniteNumber(totals.today) ? totals.today : null),
      storm: isFiniteNumber(l.storm) ? l.storm : (totals && isFiniteNumber(totals.storm) ? totals.storm : null),
      month: isFiniteNumber(l.month) ? l.month : (totals && isFiniteNumber(totals.month) ? totals.month : null),
      year: isFiniteNumber(l.year) ? l.year : (totals && isFiniteNumber(totals.year) ? totals.year : null),

      chill: isFiniteNumber(l.chill) ? l.chill : null,
      heat: isFiniteNumber(l.heat) ? l.heat : null,
      sunrise: (typeof l.sunrise === 'string' && l.sunrise.trim()) ? l.sunrise : null,
      sunset: (typeof l.sunset === 'string' && l.sunset.trim()) ? l.sunset : null
    };
    const out = window.fbLogSample?.(key, payload);
    if(out && typeof out.catch === 'function') out.catch(()=>{});
  }catch(e){}
    }
// ---- /FIREBASE LOG ----

  // keep globals in sync if this is the active context
  if(key === currentStationKey){
    stationSeries = series;
    stationLastKey = sampleKey;
    if(updateUI !== false) updateStationReadouts();
  }
}

function onNewStationSample(sampleKey, tsText, val, label, totals, latest) {
  storeSampleForKey(currentStationKey, sampleKey, tsText, val, label, totals, true, latest);
  // Keep scenario mini-panels in sync with the latest PRIMARY sample
  try{ refreshScenarioPanels(); }catch(_){}
}

function updateStationReadouts(){
  const latest = stationSeries.length ? stationSeries[stationSeries.length-1] : null;

  // dp = last dp if available
  const dp = latest?.dp;
  setTxt('stationDP', (dp!=null && isFiniteNumber(dp)) ? dp.toFixed(1) : '—');

  // R60: sum dp over last 60 minutes if dp exists
  if(stationSeries.length && stationSeries.some(s=>s.dp!=null)){
    const now = stationSeries[stationSeries.length-1].dateMs;
    const cutoff = now - 60*60*1000;
    const sum = stationSeries.filter(s=>s.dateMs>=cutoff && s.dp!=null).reduce((a,b)=>a+b.dp,0);
    setTxt('stationR60', isFiniteNumber(sum) ? sum.toFixed(1) : '—');
  } else {
    setTxt('stationR60', '—');
  }
  renderStationSeriesList();
  try{ refreshScenarioPanels(); }catch(_){ }
}

function renderStationSeriesList(){
  // Backward-compatible name: renders the "Monitoring" history table
  try{
    if(typeof __seriesBuildRowsFromBuffer === 'function'){
      const rows = __seriesBuildRowsFromBuffer();
      if(typeof renderSeriesHead === 'function') renderSeriesHead();
      if(typeof renderSeriesRows === 'function') renderSeriesRows(rows);
      if(typeof __seriesSetStatus === 'function'){
        __seriesSetStatus(`Monitoring: ${rows.length} δείγματα`, false);
      }
      return;
    }
  }catch(e){
    console.warn('renderStationSeriesList error', e);
  }
}


/* ===================== STATION BUTTONS UI ===================== */
function updateStationButtons(){
  const autoBtn = document.getElementById('btnAutoStation');
  const liveBtn = document.getElementById('btnLiveStation');

  if(autoBtn){
    // Auto stays blue; Live is independent
    autoBtn.classList.add('btn-auto-default');
    autoBtn.classList.remove('btn-auto-live');
  }
  if(liveBtn){
    liveBtn.classList.toggle('btn-live-on', stationLiveOn);
    liveBtn.classList.toggle('btn-live-off', !stationLiveOn);
    liveBtn.textContent = stationLiveOn ? 'Live ON' : 'Live OFF';
  }

  updateLocalScenarioBtn();
}


/* ===================== MONITOR: SUB TOGGLE (arrow before station name) ===================== */
function toggleMonitorContent(){
  const wrap = document.getElementById('monitorBodyContent');
  const btn  = document.getElementById('btnToggleMonitorContent');
  if(!wrap || !btn) return;
  const isCollapsed = wrap.classList.toggle('collapsed');
  btn.textContent = isCollapsed ? '▶' : '▼';
  btn.title = isCollapsed ? 'Άνοιγμα περιεχομένου' : 'Κλείσιμο περιεχομένου';
}

function initMonitorContentToggle(){
  const wrap = document.getElementById('monitorBodyContent');
  const btn  = document.getElementById('btnToggleMonitorContent');
  if(!wrap || !btn) return;
  const isCollapsed = wrap.classList.contains('collapsed');
  btn.textContent = isCollapsed ? '▶' : '▼';
  btn.title = isCollapsed ? 'Άνοιγμα περιεχομένου' : 'Κλείσιμο περιεχομένου';
}

function flashTempGreen(btnOrId, ms=3000){
  const btn = (typeof btnOrId === 'string') ? document.getElementById(btnOrId) : btnOrId;
  if(!btn) return;
  btn.classList.add('temp-green');
  setTimeout(()=> btn.classList.remove('temp-green'), ms);
}

function applyAutoI(){
  // Use latest station rain rate if exists
  const latest = stationSeries.length ? stationSeries[stationSeries.length-1] : null;
  if(latest && latest.val!=null){
    setVal('rainI', latest.val.toFixed(1));
    setStationMsg("Load: i ενημερώθηκε από σταθμό.");
    flashTempGreen('btnAutoStation', 3000);
    runMasterCalculation();
  } else if(lastStationPayload){
    const rr = extractRainRate(lastStationPayload);
    if(rr!=null){
      setVal('rainI', rr.toFixed(1));
      setStationMsg("Load: i ενημερώθηκε από payload.");
      flashTempGreen('btnAutoStation', 3000);
      runMasterCalculation();
    } else {
      setStationMsg("Load: δεν υπάρχει τιμή βροχής.");
    }
  } else {
    setStationMsg("Load: δεν υπάρχει τιμή βροχής.");
  }
}

function toggleLive(){
  stationLiveOn = !stationLiveOn;
  updateStationButtons();

  const doFetch = ()=> {
    // prefer API fetch if ACTIVE primary OR watchlist monitoring
    const url = getPrimaryStationUrl();
    if(url || watchlist.size) fetchStationData();
    else fetchLiveMeteo();
  };

  if(stationLiveOn){
    setStationMsg("Live: ON (ανά 90s)");
    // άμεση πρώτη λήψη για να δεις αποτέλεσμα χωρίς να περιμένεις 90s
    doFetch();
    if(stationLiveTimer) clearInterval(stationLiveTimer);
    stationLiveTimer = setInterval(doFetch, 90000);
  } else {
    setStationMsg("Live: OFF");
    if(stationLiveTimer) clearInterval(stationLiveTimer);
    stationLiveTimer = null;
  }
}

function clearStationSeries(){
  const ok = __confirmClear("Καθαρισμός Χρονοσειράς Σταθμού (UI)", [
    "• Θα καθαριστεί η προσωρινή χρονοσειρά (buffer) για τον τρέχοντα σταθμό.",
    "• Θα μηδενιστούν οι υπολογισμοί ΔP (storm) και R60 στην οθόνη."
  ]);
  if(!ok) return;

  stationSeries = [];
  stationLastKey = null;

  // update store for current station context
  stationSeriesByKey[currentStationKey] = stationSeries;
  stationLastKeyByKey[currentStationKey] = stationLastKey;

  setTxt('stationDP','—');
  setTxt('stationR60','—');
  setStationMsg("Series καθαρίστηκε.");

  // οπτική επιβεβαίωση: πράσινο για 3s και μετά επιστροφή
  flashTempGreen('btnClearStation', 3000);
}



/* ===================== AI ANALYSIS (copy + open AI tab) ===================== */
const AI_TARGETS = {
  chatgpt: { name: "ChatGPT", url: "https://chatgpt.com/" },
  gemini:  { name: "Gemini",  url: "https://gemini.google.com/" }
};
let AI_TARGET = "chatgpt";

function initAIAnalysisUI(){
  // Restore last choice
  try{
    const saved = localStorage.getItem("NIREAS_AI_TARGET");
    if(saved && AI_TARGETS[saved]) AI_TARGET = saved;
  }catch(_){}
  // Sync dropdown (or pills in older builds)
  const wrap = document.getElementById("aiTargetGroup");
  const sel = document.getElementById("aiProviderSelect");
  if(sel){
    try{ sel.value = AI_TARGET; }catch(_){}
    sel.classList.remove("ai-chatgpt","ai-gemini");
    sel.classList.add(AI_TARGET === "gemini" ? "ai-gemini" : "ai-chatgpt");
    const t = getAITargetInfo();
    sel.title = `AI: ${t.name} (αποθηκεύεται)`;
  }else if(wrap){
    // Backward compatibility if someone still has pills
    wrap.querySelectorAll(".ai-pill").forEach(btn=>{
      btn.classList.toggle("active", btn.dataset.ai === AI_TARGET);
    });
  }
  // Update AI analysis button tooltip (target shown via dropdown)
  const btn = document.getElementById("btnAIAnalysis");
  if(btn){
    const t = getAITargetInfo();
    btn.title = `Συλλογή δεδομένων & ανάλυση με AI (Shift+Click = EXTRA FULL) | Target: ${t.name}`;
  }
}

function setAITarget(key){
  if(!AI_TARGETS[key]) return;
  AI_TARGET = key;
  try{ localStorage.setItem("NIREAS_AI_TARGET", key); }catch(_){}
  initAIAnalysisUI();
}

function getAITargetInfo(){
  return AI_TARGETS[AI_TARGET] || AI_TARGETS.chatgpt;
}

function __aiGetTxt(id){
  const el = document.getElementById(id);
  return (el && (el.innerText!=null)) ? el.innerText.trim() : '—';
}
function __aiGetVal(id){
  const el = document.getElementById(id);
  if(!el) return '';
  const tag = (el.tagName||'').toLowerCase();
  if(tag === 'select'){
    const opt = el.options && el.selectedIndex>=0 ? el.options[el.selectedIndex] : null;
    return (opt && opt.text!=null) ? String(opt.text).trim() : (el.value ?? '');
  }
  const type = (el.type||'').toLowerCase();
  if(type === 'checkbox' || type === 'radio') return el.checked ? 'checked' : 'not-checked';
  return (el.value ?? '');
}
function __aiSafeSlice(s, limit){
  const t = String(s ?? '');
  if(t.length <= limit) return t;
  return t.slice(0, limit) + `\n… [TRUNCATED ${t.length-limit} chars]`;
}
function __aiNormalizeText(s){
  return String(s ?? '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function __aiCopySync(text){
  // Works in many contexts, keeps user-gesture so popups are allowed.
  try{
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly","");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return !!ok;
  }catch(_){
    return false;
  }
}

function __aiCopyAsync(text){
  if(navigator.clipboard && navigator.clipboard.writeText){
    return navigator.clipboard.writeText(text).then(()=>true).catch(()=>false);
  }
  return Promise.resolve(false);
}

function __aiShowCopyFallback(text, targetName, targetUrl){
  // Minimal in-page modal for manual copy if Clipboard API fails (e.g. file:// restrictions)
  const prev = document.getElementById('aiCopyOverlay');
  if(prev) prev.remove();

  const overlay = document.createElement('div');
  overlay.id = 'aiCopyOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;max-width:980px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,.35);overflow:hidden">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#2c3e50;color:#fff;font-weight:900">
        <div>AI analysis – Αντιγραφή prompt</div>
        <button id="aiCopyClose" style="border:none;background:rgba(255,255,255,.18);color:#fff;border-radius:8px;width:34px;height:28px;cursor:pointer;font-weight:900">✕</button>
      </div>
      <div style="padding:10px 12px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="font-size:12px;color:#4b4b4b">
            Πατήστε <b>Ctrl+C</b> (ή ⌘C) για αντιγραφή. Μετά ανοίξτε <b>${targetName}</b> και κάντε Paste.
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <button id="aiOpenTarget" class="mini-btn btn-on" style="height:28px;line-height:1" title="Άνοιγμα σε νέο tab">${targetName}</button>
            <button id="aiSelectAll" class="mini-btn btn-gray" style="height:28px;line-height:1" title="Επιλογή όλων">Select</button>
          </div>
        </div>
        <textarea id="aiCopyText" style="width:100%;height:360px;border:1px solid #d6dde4;border-radius:10px;padding:10px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;white-space:pre;resize:vertical;"></textarea>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const ta = overlay.querySelector('#aiCopyText');
  ta.value = text;
  ta.focus();
  ta.select();
  overlay.querySelector('#aiCopyClose').onclick = ()=> overlay.remove();
  overlay.onclick = (e)=>{ if(e.target === overlay) overlay.remove(); };
  overlay.querySelector('#aiSelectAll').onclick = ()=>{ ta.focus(); ta.select(); };
  overlay.querySelector('#aiOpenTarget').onclick = ()=>{ window.open(targetUrl, "_blank"); };
}

function __aiShowOpenFallback(targetName, targetUrl){
  // Popup blocked after copy: offer a clear clickable open
  const prev = document.getElementById('aiOpenOverlay');
  if(prev) prev.remove();

  const overlay = document.createElement('div');
  overlay.id = 'aiOpenOverlay';
  overlay.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:99999;background:#fff;border:1px solid #dfe7ee;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.18);padding:10px 12px;max-width:420px;';
  overlay.innerHTML = `
    <div style="font-weight:900;margin-bottom:6px">Popup blocker</div>
    <div style="font-size:12px;color:#4b4b4b;margin-bottom:8px">Αντιγράφηκε το prompt, αλλά δεν άνοιξε νέο tab. Πάτησε εδώ:</div>
    <button class="mini-btn btn-on" id="aiOpenNow" style="height:28px;line-height:1">${targetName}</button>
    <button class="mini-btn btn-gray" id="aiOpenClose" style="height:28px;line-height:1;margin-left:6px">Κλείσιμο</button>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#aiOpenNow').onclick = ()=> window.open(targetUrl, "_blank");
  overlay.querySelector('#aiOpenClose').onclick = ()=> overlay.remove();
}

function __aiToast(msg){
  try{
    const id = 'aiToast';
    let el = document.getElementById(id);
    if(!el){
      el = document.createElement('div');
      el.id = id;
      el.style.cssText = 'position:fixed;left:12px;top:12px;z-index:99999;background:rgba(0,0,0,.78);color:#fff;padding:8px 10px;border-radius:12px;font-size:12px;font-weight:900;max-width:520px;box-shadow:0 10px 30px rgba(0,0,0,.25);';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = 'block';
    if(el._t) clearTimeout(el._t);
    el._t = setTimeout(()=>{ el.style.display = 'none'; }, 5200);
  }catch(_){}
}


function runAIAnalysis(ev){
  // Shift+Click => EXTRA FULL (more raw page text). Default already includes the full structured data.
  const extraFull = !!(ev && ev.shiftKey);
  const now = new Date();
  const target = getAITargetInfo();

  const scenarioSel = document.getElementById('modelScenario');
  const scenarioValue = scenarioSel ? scenarioSel.value : '';
  const scenarioLabel = scenarioSel ? (scenarioValue ? (scenarioSel.options[scenarioSel.selectedIndex]?.text || scenarioValue) : '—') : (scenarioValue || '—');

  // Station flags (try globals, fallback to button text)
  const liveOn = (typeof stationLiveOn !== 'undefined') ? !!stationLiveOn : /ON/i.test(document.getElementById('btnLiveStation')?.innerText || '');
  const localOn = (typeof LOCAL_SCENARIO_ON !== 'undefined') ? !!LOCAL_SCENARIO_ON : (document.getElementById('localScenarioToggle')?.checked || false);

  // Layer flags (if exist)
  let meteoLayer = '—';
  try{
    meteoLayer = `Κύριος:${METEO_PRIMARY_VISIBLE ? 'ON' : 'OFF'} | Παρακολούθηση:${METEO_WATCH_VISIBLE ? 'ON' : 'OFF'}`;
  }catch(_){ }
  // Visible GeoJSON layers (if exist)
  let visibleLayers = [];
  try{
    if(typeof VISIBLE !== 'undefined' && VISIBLE && typeof VISIBLE[Symbol.iterator] === 'function'){
      visibleLayers = Array.from(VISIBLE);
    }
  }catch(_){}

  // Derived results (hydrology box)
  const calc = {
    slope_S: __aiGetTxt('res-slope'),
    tc_kirpich_min: __aiGetTxt('res-tc'),
    qpeak_m3s: __aiGetTxt('res-qsel'),
    qcap_network_m3s: __aiGetTxt('res-drains'),
    qcap_stream_m3s: __aiGetTxt('res-stream'),
    adequacy_check: __aiGetTxt('res-adequacy')
  };

  // Table preview (first rows)
  let tablePreview = '';
  try{
    const rows = Array.from(document.querySelectorAll('#tableBody tr')).slice(0, 24);
    if(rows.length){
      tablePreview = rows.map(tr => Array.from(tr.children).map(td => td.innerText.trim()).join(' | ')).join('\n');
    }
  }catch(_){}

  // Optional extra station list / watchlist
  const multiList = document.getElementById('stationMultiList');
  let multiText = '';
  if(multiList && multiList.innerText && multiList.innerText.trim()){
    multiText = __aiNormalizeText(multiList.innerText);
  }
  const watchlistEl = document.getElementById('watchlist');
  let watchlistText = '';
  if(watchlistEl && watchlistEl.innerText && watchlistEl.innerText.trim()){
    watchlistText = __aiNormalizeText(watchlistEl.innerText);
  }

  // Station series (last 12)
  const seriesText = __aiNormalizeText(__aiGetTxt('seriesTable'));

  // DB history (loaded from Firestore, if available)
  let dbHistText = '';
  try{
    const rows = (window.__dbLastSamples || []).slice(0, 120);
    if(rows.length){
      dbHistText = rows.map(r => {
        const ts = r.tsText || (typeof r.tsMs==='number' ? new Date(r.tsMs).toLocaleString() : (r.id||''));
        const rain = (typeof r.rainRate==='number') ? r.rainRate.toFixed(1) : '—';
        const dp = (typeof r.dp==='number') ? r.dp.toFixed(1) : '—';
        const total = (typeof r.total==='number') ? r.total.toFixed(1) : '—';
        const temp = (typeof r.temp==='number') ? r.temp.toFixed(1) : '—';
        const hum = (typeof r.hum==='number') ? String(Math.round(r.hum)) : '—';
        return `${ts} | rain=${rain} | dp=${dp} | total=${total} | T=${temp} | RH=${hum}`;
      }).join('\n');
    }
  }catch(_){ dbHistText = ''; }


  // Collect form values (id-based, compact)
  const formLines = [];
  document.querySelectorAll('input[id], select[id], textarea[id]').forEach(el => {
    const id = el.id;
    if(!id) return;
    const tag = el.tagName.toLowerCase();
    const type = (el.type||'').toLowerCase();
    if(tag === 'input' && (type === 'button' || type === 'submit' || type === 'reset')) return;

    let v = '';
    if(type === 'checkbox' || type === 'radio') v = el.checked ? 'checked' : 'not-checked';
    else if(tag === 'select'){
      const opt = el.options && el.selectedIndex>=0 ? el.options[el.selectedIndex] : null;
      v = (opt && opt.text!=null) ? String(opt.text).trim() : (el.value ?? '');
    }else{
      v = (el.value ?? '');
    }
    if(v === '' || v == null) return;
    formLines.push(`${id}: ${String(v).trim()}`);
  });

  // Build compact, structured context (best results, less noise)
  const context = {
    url: location.href,
    title: document.title,
    captured_at_local: now.toLocaleString(),
    captured_at_iso: now.toISOString(),
    ai_target: target.name,
    mode: extraFull ? 'EXTRA_FULL' : 'FULL',
    active: {
      basin: __aiGetTxt('selectedBasinName'),
      scenario: scenarioLabel,
      live: liveOn ? 'ON' : 'OFF',
      local_scenario: localOn ? 'ON' : 'OFF',
      meteo_selected_markers_layer: meteoLayer,
      visible_geojson_layers: visibleLayers
    },
    station: {
      name: __aiGetTxt('stationName'),
      timestamp: __aiGetTxt('stationTimestampInline'),
      lat: __aiGetTxt('stationLat'),
      lon: __aiGetTxt('stationLon'),
      elev_m: __aiGetTxt('stationElev'),
      latest_chips: __aiGetTxt('stationLatestChips'),
      rain_rate: __aiGetTxt('stationRainRate'),
      dp_mm: __aiGetTxt('stationDP'),
      r60_mm: __aiGetTxt('stationR60')
    },
    inputs: {
      i_mm_h: __aiGetVal('rainI'),
      D_min: __aiGetVal('rainD'),
      A_m2: __aiGetVal('area'),
      L_m: __aiGetVal('length'),
      H_m: __aiGetVal('height'),
      C: __aiGetVal('coef')
    },
    calculations: calc
  };

  // Page text snapshot (bounded). EXTRA_FULL adds more.
  const rawText = __aiNormalizeText(document.body.innerText || '');
  const pageText = __aiSafeSlice(rawText, extraFull ? 120000 : 55000);

  const contextJson = __aiSafeSlice(JSON.stringify(context, null, 2), 20000);

  const payloadText =
`URL: ${context.url}
TITLE: ${context.title}
CAPTURED_AT: ${context.captured_at_local}

=== CONTEXT (JSON) ===
${contextJson}

=== ACTIVE / SELECTED ===
Meteo Selected Markers Layer: ${context.active.meteo_selected_markers_layer}
Scenario: ${context.active.scenario}
Live: ${context.active.live}
Local Scenario: ${context.active.local_scenario}
Basin: ${context.active.basin}
Visible GeoJSON Layers: ${context.active.visible_geojson_layers && context.active.visible_geojson_layers.length ? context.active.visible_geojson_layers.join(', ') : '—'}

=== STATION (PRIMARY) ===
Name: ${context.station.name}
Timestamp: ${context.station.timestamp}
LAT: ${context.station.lat}   LON: ${context.station.lon}   ELEV: ${context.station.elev_m}
Latest: ${context.station.latest_chips}
Rain Rate: ${context.station.rain_rate}
ΔP: ${context.station.dp_mm}
R60: ${context.station.r60_mm}

=== STATION SERIES (${getSeriesLimit()} latest, UI buffer) ===
${seriesText}

${dbHistText ? `=== DB HISTORY (loaded) ===
${dbHistText}

` : ''}${multiText ? `=== STATIONS (EXTRA LIST) ===
${multiText}

` : ''}${watchlistText ? `=== WATCHLIST (chips) ===
${watchlistText}

` : ''}=== KEY INPUTS ===
i (mm/h): ${context.inputs.i_mm_h}
D (min): ${context.inputs.D_min}
A (m²): ${context.inputs.A_m2}
L (m): ${context.inputs.L_m}
H (m): ${context.inputs.H_m}
C: ${context.inputs.C}

=== CALC RESULTS (current) ===
S: ${calc.slope_S}
Tc: ${calc.tc_kirpich_min}
Qpeak: ${calc.qpeak_m3s}
Qcap Δικτύου: ${calc.qcap_network_m3s}
Qcap Ρέματος: ${calc.qcap_stream_m3s}
Έλεγχος: ${calc.adequacy_check}

${tablePreview ? `=== TABLE PREVIEW (top rows) ===\n(i | D | P | Qpeak | V | Risk | Network | Stream)\n${tablePreview}\n\n` : ''}=== FORM VALUES (ID: value) ===
${formLines.slice(0, 220).join('\n')}${formLines.length>220 ? `\n… [TRUNCATED ${formLines.length-220} lines]` : ''}

=== PAGE TEXT SNAPSHOT (${context.mode}) ===
${pageText}
`;

  const prompt =
`Δράσε ως μετεωρολόγος/αναλυτής επιχειρησιακού κινδύνου. Ανάλυσε ΑΠΟΚΛΕΙΣΤΙΚΑ τα δεδομένα που ακολουθούν από το σύστημα NIREAS και δώσε μου:

1) Σύντομη πρόγνωση καιρού (επόμενες 6/24/48 ώρες) για Χαλάνδρι,
2) Εκτίμηση κινδύνου (βροχή/καταιγίδες/πλημμύρα/παγετός/χιόνι – ανάλογα με το ενεργό σενάριο) με 3 σενάρια: ΧΑΜΗΛΟ – ΜΕΤΡΙΟ – ΥΨΗΛΟ,
3) 3 άμεσες επιχειρησιακές συστάσεις για τον Δήμο.

Κανόνες:
- Αν κάτι λείπει/είναι άγνωστο, γράψε «—» και ΜΗΝ το εικάσεις.
- Να είσαι σύντομος, με bullets, και να πατάς στα δεδομένα (timestamps/τιμές) που σου δίνονται.

` + payloadText;

  const n = prompt.length;
  const modeTxt = extraFull ? "EXTRA_FULL" : "FULL";

  // 1) Copy FIRST (sync if possible)
  const copiedSync = __aiCopySync(prompt);
  if(copiedSync){
    const win = window.open(target.url, "_blank");
    if(!win) __aiShowOpenFallback(target.name, target.url);
    __aiToast(`✅ Prompt αντιγράφηκε (${n.toLocaleString()} chars) [${modeTxt}] → Άνοιγμα: ${target.name}. Κάνε Paste.`);
    return;
  }

  // 2) Async clipboard fallback
  __aiCopyAsync(prompt).then(ok=>{
    if(ok){
      const win = window.open(target.url, "_blank");
      if(!win) __aiShowOpenFallback(target.name, target.url);
      __aiToast(`✅ Prompt αντιγράφηκε (${n.toLocaleString()} chars) [${modeTxt}] → Άνοιγμα: ${target.name}. Κάνε Paste.`);
    }else{
      __aiShowCopyFallback(prompt, target.name, target.url);
      __aiToast(`⚠️ Αυτόματη αντιγραφή απέτυχε. Άνοιξε το παράθυρο και κάνε χειροκίνητα αντιγραφή. Target: ${target.name} [${modeTxt}]`);
    }
  });
}
/* ===================== /AI ANALYSIS ===================== */


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

