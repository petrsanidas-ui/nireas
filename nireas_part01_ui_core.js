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
  window.__closeStartupSplash = close;
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
function emptyAoiSelected(){
  return { municipality_ids: [], pref_unit_ids: [], region_ids: [] };
}

function emptyAoiSelected(){
  return { municipality_ids: [], pref_unit_ids: [], region_ids: [] };
}

function emptyAoiSelected(){
  return { municipality_ids: [], pref_unit_ids: [], region_ids: [] };
}

function emptyAoiSelected(){
  return { municipality_ids: [], pref_unit_ids: [], region_ids: [] };
}

// Data loading mode:
// - 'local' : load from local "data/" folder (works on localhost and GitHub Pages; supports offline local server)
// - 'github': auto-discover files via GitHub API tree (requires internet and is rate-limited)

const DEFAULT_DATA_MODE = 'local';
const FORCE_RAW_ON_FILE = (location.protocol === 'file:');
let DATA_MODE = DEFAULT_DATA_MODE;


let DATA_BASE = (DATA_MODE === 'github') ? RAW_URL : '';
if(FORCE_RAW_ON_FILE){
  DATA_BASE = RAW_URL;
}

let DATA_GROUPS = { boundaries: [], streams: [], basins: [] }; // NOTE ORDER

// Admin areas registry (for AOI & boundaries typing)
let ADMIN_AREAS_REGISTRY = [];
let ADMIN_AREAS_BY_KEY = new Map();
let ADMIN_AREAS_BY_FILE = new Map();

// Project GeoJSON layers registry (optional): data/geo/project_layers_registry.json
let PROJECT_LAYERS_REGISTRY = [];
let PROJECT_LAYERS_BY_FILE = new Map();
let GEO_FILTER = { useAOI: true, category: 'all', q: '' };


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
var METEO_PRIMARY_VISIBLE = false;
var METEO_WATCH_VISIBLE = false;
var METEO_STATIONS_LAYER = null;  // persistent selected markers layer
var METEO_STATIONS_PREVIEW = null;// preview-only layer (Map button)
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
  MODEL_SCENARIO = (val == null) ? '' : String(val).trim();
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
}

/* ===== Scenario-based UI: show only relevant panels (from 'Λεκάνη και κάτω') ===== */
function applyScenarioUI(scn){
  const val = (scn == null) ? '' : String(scn).trim();

  const root = document.getElementById('scenarioArea');
  if(!root) return;

  const panels = root.querySelectorAll('.scenario-panel');
  const panelEls = Array.from(panels);

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

  if(target && !panelEls.some(p=>p.id === target)){
    panelEls.forEach(p=>{
      p.classList.add('active');
      try{ p.setAttribute('aria-hidden', 'false'); }catch(_){}
    });
  }

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
    ['rainNow','rainRisk','windNow','windDir','windRisk','heatTempNow','heatIndexNow','heatRisk','frostTempNow','frostChillNow','frostRisk','iceRisk']
      .forEach(id=>{ const el=document.getElementById(id); if(el) el.innerHTML='—'; });
    return;
  }

  // ---- RAIN ----
  const rr = (typeof s.rainRate === 'number') ? s.rainRate : ((typeof s.rr === 'number') ? s.rr : null);
  const rainWarn = Number(document.getElementById('rainWarnMmH')?.value);
  const rainHigh = Number(document.getElementById('rainHighMmH')?.value);

  let rLevel = 'none';
  if(Number.isFinite(rr)){
    if(Number.isFinite(rainHigh) && rr >= rainHigh) rLevel = 'high';
    else if(Number.isFinite(rainWarn) && rr >= rainWarn) rLevel = 'med';
    else rLevel = 'low';
  }

  const rainNowEl = document.getElementById('rainNow');
  if(rainNowEl) rainNowEl.textContent = Number.isFinite(rr) ? __fmt(rr, ' mm/h') : '—';
  const rainRiskEl = document.getElementById('rainRisk');
  if(rainRiskEl) rainRiskEl.innerHTML = __riskLabel(rLevel);

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

  const v = String(sel.value || '').trim();

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

  try{ applyScenarioUI(v); }catch(_){ }

  try{ setScenarioSummaryPlaceholder(false); }catch(_){ }
  try{ ensurePanelExpanded('scenarioCardBody'); }catch(_){ }

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

function ensurePanelExpanded(id){
  const el = document.getElementById(id);
  if(!el || !el.classList.contains('collapsed')) return;

  el.classList.remove('collapsed');
  const card = el.closest('.panel-card');
  if(card){
    card.classList.remove('is-collapsed');
    const btn = card.querySelector(`button[onclick*="toggleCollapse('${id}'"]`) ||
      card.querySelector(`button[onclick*='toggleCollapse("${id}"']`);
    if(btn) btn.textContent = '−';
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
function updateWeatherForecastStatus(msg, level='neutral'){
  setStatusById('weatherForecastStatus', msg, level);
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
