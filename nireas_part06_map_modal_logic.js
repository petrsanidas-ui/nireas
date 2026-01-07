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

// Safe for embedding text inside inline JS string literals in HTML attributes.
// Pattern used in this app: onclick="fn('path','NAME')" (NAME wrapped in single quotes).
// 1) JS-escape (\\, ', newlines) so it can't break the JS string.
// 2) HTML-escape only characters that break HTML parsing (&, <, >, ").
function escapeHtmlAttr(s){
  const js = String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
  return js.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

// Tiny safe wrappers for localStorage.
function getStored(key){
  try{ return localStorage.getItem(String(key)); }catch(_){ return null; }
}
function setStored(key, value){
  try{ localStorage.setItem(String(key), String(value ?? '')); }catch(_){ }
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
  const resp = await fetch(DATA_BASE + path, { cache: 'no-store' });
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
    const paths = (files||[]).map(x => (typeof x === "string") ? x : (x && x.path ? x.path : "")).filter(Boolean);
    const apiTxt = paths.filter(p=>p.startsWith("data/meteostations/api/"));
    const webTxt = paths.filter(p=>p.startsWith("data/meteostations/weblinks/"));
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
    const resp = await fetch(DATA_BASE + path);
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
