/* ===================== GITHUB LOAD ===================== */

/* ===================== DATA BOOTSTRAP ===================== */
async function buildLocalFilesIndex(){
  const files = [];
  const seen = new Set();
  const add = (p)=>{
    p = String(p||'').trim();
    if(!p) return;
    if(seen.has(p)) return;
    seen.add(p);
    files.push({path:p});
  };

  // core files
  add('data/boundaries/admin_areas_registry.json');
  add('data/geo/project_layers_registry.json');
  add('data/forecast/forecast.txt');
  add('data/WaterLevelSensors/WaterLevelSensors.txt');
  add('data/resources/human_resources.json');
  add('data/resources/vehicles.json');
  add('data/resources/materials.json');
  add('data/meteostations/api/stations.txt');
  add('data/meteostations/weblinks/stations.txt');

  // defaults (if no registry JSON exists)
  const defaultStreams = [
    'data/streams/geojson/kleisthenous.geojson',
    'data/streams/geojson/rema.geojson',
    'data/streams/geojson/vrilissos.geojson'
  ];
  const defaultBasins = [
    'data/basins/map_2.geojson',
    'data/basins/vrilissos.geojson'
  ];

  async function tryLoadRegistry(path){
    try{
      const resp = await fetch(DATA_BASE + path, { cache: 'no-store' });
      if(!resp.ok) return null;
      const json = await resp.json();
      if(!Array.isArray(json)) return null;
      return json;
    }catch(_){
      return null;
    }
  }

    function registerLayerMetaFromRegistry(list, fallbackType){
      try{
        if(!(PROJECT_LAYERS_BY_FILE instanceof Map)) PROJECT_LAYERS_BY_FILE = new Map();
        if(!Array.isArray(list)) return;
        list.forEach(e => {
          if(!e || !e.file) return;
          const prev = PROJECT_LAYERS_BY_FILE.get(e.file) || {};
          const type = e.type || fallbackType || prev.type;
          PROJECT_LAYERS_BY_FILE.set(e.file, { ...prev, ...e, type });
        });
      }catch(_){}
    }


  const streamsReg = await tryLoadRegistry('data/streams/streams_registry.json');
  
    registerLayerMetaFromRegistry(streamsReg,'stream');
const basinsReg  = await tryLoadRegistry('data/basins/basins_registry.json');

  const streamPaths = (streamsReg && streamsReg.length)
    ? streamsReg.map(e=>String(e?.file||'').trim()).filter(Boolean)
    : defaultStreams.slice();

  const basinPaths = (basinsReg && basinsReg.length)
    ? basinsReg.map(e=>String(e?.file||'').trim()).filter(Boolean)
    : defaultBasins.slice();

  DATA_GROUPS.streams = streamPaths.map(p=>({path:p}));
  DATA_GROUPS.basins  = basinPaths.map(p=>({path:p}));

  streamPaths.forEach(add);
  basinPaths.forEach(add);

  // boundaries are filled AFTER admin_areas_registry is loaded
  return files;
}

async function buildGithubFilesIndex(){
  const resp = await fetch(API_TREE, { cache: 'no-store' });
  const data = await resp.json();
  if(data.message) throw new Error(data.message);

  const files = data.tree || [];

  DATA_GROUPS.boundaries = files.filter(f => f.path.includes('data/boundaries/') && f.path.endsWith('.geojson'));
  DATA_GROUPS.streams    = files.filter(f => (f.path.includes('data/streams/') || f.path.includes('streams/geojson/')) && f.path.endsWith('.geojson'));
  DATA_GROUPS.basins     = files.filter(f => f.path.includes('data/basins/') && f.path.endsWith('.geojson'));

  return files;
}

/* ===================== APP INIT ===================== */
async function init(){
  document.getElementById('loader').style.display = 'block';
  try{
    // IMPORTANT: if opened from file://, fetch() of local files is blocked by the browser.
    if(location.protocol === 'file:'){
      const modeNote = (DATA_BASE === RAW_URL)
        ? 'Φόρτωση από GitHub (RAW) ώστε να λειτουργήσει εκτός server.'
        : 'Άνοιξε με local server (π.χ. python -m http.server).';
      updateMeteoStatus(`⚠️ Άνοιγμα ως file://: ο browser μπλοκάρει τη φόρτωση αρχείων (fetch). ${modeNote}`);
    }

    restoreUiStateEarly();
    initAIAnalysisUI();
    try{ initAIForecastInstructions(); }catch(e){ console.warn("initAIForecastInstructions failed", e); }
    updateMeteoStationsRowButton();

    const files = (DATA_MODE === 'github')
      ? await buildGithubFilesIndex()
      : await buildLocalFilesIndex();

    // Registries
    await loadAdminAreasRegistryFromTree(files);
    // boundaries list: only entries that have a concrete GeoJSON file
    DATA_GROUPS.boundaries = (ADMIN_AREAS_REGISTRY || []).filter(e=>e && e.file).map(e=>({path:String(e.file).trim()}));


    // AOI: render early so you always see choices even if other parts fail
    try{ bindAOITypeChangeOnce(); }catch(e){ console.warn("bindAOITypeChangeOnce failed", e); }
    try{ renderAOIList(); }catch(e){ console.warn("renderAOIList failed", e); }
    try{ updateAOIUI(); }catch(e){ console.warn("updateAOIUI failed", e); }

    await loadProjectLayersRegistryFromTree(files);

    // UI binds
    bindGeoFilesUI();

    // Upgrade legacy AOI selections (paths) -> ids (once registry exists)
    try{ upgradeLegacyAoiPathsToSelected(); computeAoiDerived(); computeAoiExpanded(); }catch(_){ }
    // Render lists (never break init)
    try{ renderFileList(); }catch(e){ console.warn("renderFileList failed", e); }
    try{ renderBoundariesList(); }catch(e){ console.warn("renderBoundariesList failed", e); }
    try{ renderAOIList(); }catch(e){ console.warn("renderAOIList failed", e); }
    try{ updateAOIUI(); }catch(e){ console.warn("updateAOIUI failed", e); }

    // keep AOI type choice consistent with selected entries
    try{ loadPersistedAOIType(); }catch(_){ }

    // Forecast / water level sources
    try{ await loadForecastSourcesFromTree(files); }catch(e){ console.warn('Forecast sources load failed', e); }
    try{ await loadWeatherForecast(files); }catch(e){ console.warn('Weather forecast load failed', e); }
    try{ await loadWaterLevelSourcesFromTree(files); }catch(e){ console.warn('Water level sources load failed', e); }

    // HR / Vehicles / Materials
    try{ await loadHumanResourcesFromTree(files); }catch(e){ console.warn('HR load failed', e); }
    try{ await loadVehiclesFromTree(files); }catch(e){ console.warn('Vehicles load failed', e); }
    try{ await loadMaterialsFromTree(files); }catch(e){ console.warn('Materials load failed', e); }

    // Stations (from folders) — resilient to either {path} objects or plain strings
    const loadedStations = await fetchStationsFromFolders(files);
    if(!loadedStations){
      // fallback: try the legacy single-file loader (if files exist)
      try{
        const respWeb = await fetch(DATA_BASE + 'data/meteostations/weblinks/stations.txt', { cache: 'no-store' });
        if(respWeb.ok){
          await fetchStations('data/meteostations/weblinks/stations.txt');
        }else{
          const respApi = await fetch(DATA_BASE + 'data/meteostations/api/stations.txt', { cache: 'no-store' });
          if(respApi.ok) await fetchStations('data/meteostations/api/stations.txt');
        }
      }catch(_){ }
    }

    loadCustomStationsIntoSelect();
    loadWatchlist();
    renderWatchlist();

    bindPersistenceOnce();
    await restoreUiStateLate();

    bindInputs();
    runMasterCalculation();
    updateStationButtons();
    initMonitorContentToggle();

    loadScenarioState();

    // auto-run scenario when it was saved
    try{
      const savedScenarioType = getStored(LS_SCENARIO_TYPE) || '';
      const s = SCENARIO_LIBRARY[savedScenarioType];
      if(savedScenarioType && s){
        applyScenarioUI(savedScenarioType, s);
        refreshScenarioPanels();
      }
    }catch(e){ console.warn('Scenario load error', e); }

    updateLocalScenarioBtn();
    startStationFreshnessTimer();

    // Status line
    if(!getPrimaryStationUrl()){
      updatePrimaryStatus('Κύριος: (δεν έχει επιλεγεί)', 'warn');
    }

    // If no ACTIVE primary but watchlist exists, fetch extras immediately to show values
    if(!getPrimaryStationUrl() && watchlist.size){
      fetchStationData('extras');
    }

  }catch(e){
    console.error(e);
    const msg = (DATA_MODE === 'github')
      ? ('Σφάλμα GitHub: ' + (e?.message || e))
      : ('Σφάλμα φόρτωσης τοπικών δεδομένων: ' + (e?.message || e));
    updateMeteoStatus(msg);
  }finally{
    document.getElementById('loader').style.display = 'none';
    try{
      if(typeof window.__closeStartupSplash === 'function'){
        window.__closeStartupSplash();
      }
    }catch(_){ }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  try{ init(); }catch(e){ console.error('Init failed:', e); }
});

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
