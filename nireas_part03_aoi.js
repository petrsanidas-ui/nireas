/* ===================== AOI (Area of Interest) ===================== */

// --- Admin Areas Registry helpers ---
function normalizeAdminAreaType(t){
  const s = String(t||'').toLowerCase().trim();
  if(s === 'region_unit') return 'pref_unit'; // legacy
  if(s === 'pref_unit' || s === 'municipality' || s === 'region') return s;
  return s;
}

function bindAOITypeChangeOnce(){
  const sel = document.getElementById('aoiType');
  if(!sel || sel.dataset.bound === '1') return;
  sel.dataset.bound = '1';

  sel.addEventListener('change', ()=>{
    const newType = normalizeAdminAreaType(sel.value || 'municipality');

    // Reset selection on type change to avoid mixing incompatible ids
    AOI_STATE = AOI_STATE || {};
    AOI_STATE.type = newType;
    AOI_STATE.selected = emptyAoiSelected();
    AOI_STATE.expanded = emptyAoiSelected();
    AOI_STATE.items = [];
    AOI_STATE.names = [];
    AOI_STATE.paths = [];

    try{ renderAOIList(); }catch(e){ console.warn('renderAOIList failed', e); }
    try{ updateAOIUI(); }catch(e){ console.warn('updateAOIUI failed', e); }
    try{ syncAoiLayerToMap(); }catch(_){ }
    try{ renderHumanResources(); }catch(_){ }
    try{ renderVehicles(); }catch(_){ }
    try{ renderMaterials(); }catch(_){ }
  });
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

    const resp = await fetch(DATA_BASE + f.path, { cache: 'no-store' });
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

async function loadProjectLayersRegistryFromTree(files){
  // This registry provides stable layer names + AOI tags (municipality_ids) for GeoJSON filtering.
  // IMPORTANT: In DATA_MODE === 'local', the GitHub tree list may be unavailable, so we also try direct fetch.
  const candidates = [
    files?.find(f => (f?.path || '').endsWith('data/geo/project_layers_registry.json'))?.path,
    files?.find(f => (f?.path || '').endsWith('data/geo/geo_layers_registry.json'))?.path,
    'data/geo/project_layers_registry.json',
    'data/geo/geo_layers_registry.json'
  ].filter(Boolean);

  async function tryFetchJson(relPath){
    try{
      const url = (DATA_BASE || '') + relPath;
      const res = await fetch(url, { cache: 'no-store' });
      if(!res.ok) return null;
      return await res.json();
    }catch(_){
      return null;
    }
  }

  let reg = null;
  for(const p of candidates){
    reg = await tryFetchJson(p);
    if(Array.isArray(reg) && reg.length) break;
  }

  // If nothing found, DO NOT wipe any already-registered metadata (streams/basins registries may have filled it).
  if(!Array.isArray(reg) || !reg.length){
    if(!Array.isArray(PROJECT_LAYERS_REGISTRY)) PROJECT_LAYERS_REGISTRY = [];
    return;
  }

  PROJECT_LAYERS_REGISTRY = reg;

  // Merge (registry overrides existing by file key)
  const merged = (PROJECT_LAYERS_BY_FILE instanceof Map) ? new Map(PROJECT_LAYERS_BY_FILE) : new Map();
  for(const e of reg){
    if(!e || !e.file) continue;
    const prev = merged.get(e.file) || {};
    merged.set(e.file, { ...prev, ...e });
  }
  PROJECT_LAYERS_BY_FILE = merged;
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

  // === Refresh GeoJSON list (AOI filter) ===
  try{ renderFileList(); }catch(e){ console.warn(e); }

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

  // === Refresh GeoJSON list (AOI filter) ===
  try{ renderFileList(); }catch(e){ console.warn(e); }

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




function bindGeoFilesUI(){
  try{
    const cat = document.getElementById('geoCategory');
    const q = document.getElementById('geoSearch');
    const useAOI = document.getElementById('geoUseAOI');

    if(cat && !cat.dataset.bound){
      cat.addEventListener('change', ()=>{ GEO_FILTER.category = cat.value || 'all'; renderFileList(); });
      cat.dataset.bound = 'true';
    }
    if(useAOI && !useAOI.dataset.bound){
      useAOI.addEventListener('change', ()=>{ GEO_FILTER.useAOI = !!useAOI.checked; renderFileList(); });
      useAOI.dataset.bound = 'true';
    }
    if(q && !q.dataset.bound){
      q.addEventListener('input', debounce(()=>{ GEO_FILTER.q = q.value || ''; renderFileList(); }, 120));
      q.dataset.bound = 'true';
    }
  }catch(_){}
}

function geoClearFilters(){
  try{
    const cat = document.getElementById('geoCategory');
    const q = document.getElementById('geoSearch');
    const useAOI = document.getElementById('geoUseAOI');

    if(cat) cat.value = 'all';
    if(q) q.value = '';
    if(useAOI) useAOI.checked = true;

    GEO_FILTER = { useAOI: true, category: 'all', q: '' };
    renderFileList();
  }catch(_){}
}

async function geoReload(){
  const loader = document.getElementById('loader');
  if(loader) loader.style.display = 'block';
  try{
    let files = [];
    if(DATA_MODE === 'github'){
      files = await buildGithubFilesIndex();
    }else{
      files = await buildLocalFilesIndex();
    }

    await loadAdminAreasRegistryFromTree(files);
    DATA_GROUPS.boundaries = (ADMIN_AREAS_REGISTRY || []).filter(e=>e && e.file).map(e=>({path:String(e.file).trim()}));


    // AOI: render early so you always see choices even if other parts fail
    try{ bindAOITypeChangeOnce(); }catch(e){ console.warn("bindAOITypeChangeOnce failed", e); }
    try{ renderAOIList(); }catch(e){ console.warn("renderAOIList failed", e); }
    try{ updateAOIUI(); }catch(e){ console.warn("updateAOIUI failed", e); }

    await loadProjectLayersRegistryFromTree(files);

    try{ upgradeLegacyAoiPathsToSelected(); computeAoiDerived(); computeAoiExpanded(); }catch(_){}
    renderFileList();
    try{ renderBoundariesList(); }catch(_){}
    try{ renderAOIList(); updateAOIUI(); }catch(_){}
  }catch(e){
    console.warn('geoReload failed:', e);
    const msg = document.getElementById('filesMsg');
    if(msg){
      msg.style.display = 'block';
      msg.textContent = 'Σφάλμα επαναφόρτωσης: ' + (e?.message || e);
    }
  }finally{
    if(loader) loader.style.display = 'none';
  }
}


function renderFileList(){
  const tbody = document.getElementById('fileRows');
  if(!tbody) return;

  tbody.innerHTML = '';

  // read latest UI values (in case called before bind)
  try{
    const cat = document.getElementById('geoCategory');
    const q = document.getElementById('geoSearch');
    const useAOI = document.getElementById('geoUseAOI');

    if(cat) GEO_FILTER.category = cat.value || GEO_FILTER.category || 'all';
    if(q)   GEO_FILTER.q = q.value || '';
    if(useAOI) GEO_FILTER.useAOI = !!useAOI.checked;
  }catch(_){}

  const q = (GEO_FILTER.q || '').trim().toLowerCase();
  const wantCat = GEO_FILTER.category || 'all';
  const useAOI = !!GEO_FILTER.useAOI;

  const expanded = AOI_STATE?.expanded?.municipality_ids || [];
  const expandedSet = new Set(expanded.map(String));

  const stats = { total: 0, shown: 0, on: 0, streams: 0, basins: 0 };

  const addCategory = (catKey, title, list, icon) => {
    if(wantCat !== 'all' && wantCat !== catKey) return;

    const rows = (list || []).filter(f=>{
      // Name for search
      const meta = PROJECT_LAYERS_BY_FILE.get(f.path);
      const nameFromMeta = meta?.name ? meta.name : '';
      const nameFallback = f.path.split('/').pop().replace('.geojson','');
      const name = (nameFromMeta || nameFallback || '').toLowerCase();

      if(q && !name.includes(q)) return false;

      // Optional AOI filter (strict: when AOI filter is ON, hide layers that don't declare municipality_ids)
      if(useAOI && expandedSet.size){
        const mu = meta?.municipality_ids || [];
        if(mu.length){
          for(const id of mu){
            if(expandedSet.has(String(id))) return true;
          }
          return false;
        }
        // No municipality_ids declared => hide under AOI filter
        return false;
      }
      return true;
    });

    if(!rows.length) return;

    const trHead = document.createElement('tr');
    trHead.className = 'cat-row';
    trHead.innerHTML = `
      <td colspan="2" class="cat-row">
        <div class="cat-head">
          <span class="cat-title">${icon} ${title}</span>
        </div>
      </td>`;
    tbody.appendChild(trHead);

    rows.forEach(f=>{
      const meta = PROJECT_LAYERS_BY_FILE.get(f.path);
      const reg = ADMIN_AREAS_BY_FILE.get(f.path); // kept for backward-compat (names)
      const name = (meta?.name || reg?.name || f.path.split('/').pop().replace('.geojson','')).trim();

      const on = VISIBLE.has(f.path);

      // meta line
      const tags = (meta?.tags || []).slice(0,4);
      const cov = (meta?.municipality_ids || []).length ? `Κάλυψη: ${(meta.municipality_ids||[]).length} δήμοι` : 'Κάλυψη: —';
      const metaLine = `${title}${tags.length ? ' • ' + tags.join(', ') : ''} • ${cov}`;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="text-align:left;padding-left:10px;">
          <div class="geo-name">${escapeHtml(name)}</div>
          <div class="geo-meta">${escapeHtml(metaLine)}</div>
        </td>
        <td>
          <div class="actions-row">
            <button class="mini-btn btn-on" onclick="geoAddFromRow('${f.path}','${escapeHtmlAttr(name)}')" title="➕ Προσθήκη στο κεντρικό panel">➕</button>
            <button class="mini-btn btn-gray" onclick="geoClearCategory('${catKey}')" title="🧹 Εκκαθάριση από το κεντρικό panel">🧹</button>
            <button class="mini-btn btn-map" onclick="previewOnMap('${f.path}','${escapeHtmlAttr(name)}')" title="Προεπισκόπηση στον χάρτη χωρίς αλλαγή On/Off"><span class="ico-map">🗺</span> Map</button>
            <button class="mini-btn map-only-btn ${on ? 'btn-on' : 'btn-off'}" id="btn-onoff-${cssSafe(f.path)}"
                    onclick="toggleLayer('${f.path}','${escapeHtmlAttr(name)}')"><span class="ico-eye">👁</span> ${on ? 'On' : 'Off'}</button>
          </div>
        </td>
      `;

      tbody.appendChild(tr);

      stats.total += 1;
      stats.shown += 1;
      if(on) stats.on += 1;
      if(catKey === 'streams') stats.streams += 1;
      if(catKey === 'basins') stats.basins += 1;
    });
  };

  addCategory("streams", "Υδρογραφικό Δίκτυο", DATA_GROUPS.streams, "💧");
  addCategory("basins", "Λεκάνες Απορροής", DATA_GROUPS.basins, "🏞️");

  const sum = document.getElementById('geoSummary');
  if(sum){
    sum.textContent = `Στρώματα: ${stats.shown}  |  On: ${stats.on}`;
  }
}



function cssSafe(s){
  return btoa(unescape(encodeURIComponent(s))).replace(/=+/g,'').replace(/[+/]/g,'_');
}
