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
    const resp = await fetch(DATA_BASE + path, { cache: 'no-store' });
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

    const resp = await fetch(DATA_BASE + f.path, { cache: 'no-store' });
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
const VEH_SHEET_DEFAULT_ID = '1EkTVFr6r5cGSAfHzC2wlhl2PAmfrG4G6sqGgEJSgbU8';
const VEH_SHEET_LINK_PATH = 'data/resources/Technical Means_Vehicles.txt';
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

function vehExtractSheetId(value){
  const raw = String(value || '').trim();
  if(!raw) return '';
  const match = raw.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if(match) return match[1];
  return raw;
}

function vehCsvParse(text){
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for(let i = 0; i < text.length; i++){
    const ch = text[i];
    if(ch === '"'){
      if(inQuotes && text[i + 1] === '"'){
        cell += '"';
        i++;
      }else{
        inQuotes = !inQuotes;
      }
      continue;
    }
    if(ch === ',' && !inQuotes){
      row.push(cell);
      cell = '';
      continue;
    }
    if((ch === '\n' || ch === '\r') && !inQuotes){
      if(ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if(row.length > 1 || row[0] !== ''){
        rows.push(row);
      }
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  if(row.length > 1 || row[0] !== ''){
    rows.push(row);
  }
  return rows;
}

function vehMapStatus(value){
  const raw = String(value || '').trim();
  if(!raw) return 'available';
  const lowered = raw.toLowerCase();
  const mapping = {
    'in_service': 'assigned',
    'in service': 'assigned',
    'decommissioned': 'unavailable',
    'reserved': 'assigned',
    'out_of_service': 'unavailable',
    'out of service': 'unavailable',
    'awaiting_parts': 'maintenance',
    'inspection_kteo': 'maintenance',
    'available': 'available',
    'unavailable': 'unavailable'
  };
  return mapping[lowered] || raw;
}

function vehSheetRowsToVehicles(rows){
  if(!rows.length) return [];
  const headerRow = rows[0].map(c => String(c || '').trim().toLowerCase().replace(/[\s\-]+/g, ' '));
  const idx = (name) => headerRow.indexOf(name);
  const get = (row, name) => {
    const i = idx(name);
    return i >= 0 ? String(row[i] || '').trim() : '';
  };
  const vehicles = [];
  let counter = 0;
  for(const row of rows.slice(1)){
    if(!row.some(c => String(c || '').trim())) continue;
    const municipalityId = get(row, 'municipality_id') || 'chalandri';
    counter += 1;
    const brand = get(row, 'brand');
    const model = get(row, 'model');
    const nameParts = [brand, model].filter(x => x && x !== '-');
    const name = nameParts.length ? nameParts.join(' ') : get(row, 'type');
    vehicles.push({
      vehicle_id: `veh_${municipalityId}_${String(counter).padStart(3, '0')}`,
      name: name,
      plate: get(row, 'registration number'),
      type: get(row, 'type'),
      category: get(row, 'category'),
      fuel: get(row, 'fuel'),
      base: get(row, 'parking'),
      service: get(row, 'department'),
      license_category: get(row, 'license category'),
      status: vehMapStatus(get(row, 'status')),
      municipality_id: municipalityId,
      brand: brand,
      model: model,
      notes: get(row, 'special category')
    });
  }
  return vehicles;
}

async function vehReload(){
  const loader = document.getElementById('vehLoader');
  const msg = document.getElementById('vehMsg');
  if(loader) loader.style.display = 'block';
  if(msg){ msg.style.display='none'; msg.textContent=''; }

  const path = VEH_LAST_LOADED_PATH || VEH_DEFAULT_PATH;
  try{
    const resp = await fetch(DATA_BASE + path, { cache: 'no-store' });
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

async function vehLoadFromSheetId(sheetId){
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv`;
  const resp = await fetch(url, { cache: 'no-store' });
  if(!resp.ok) throw new Error('Αποτυχία λήψης Google Sheet (HTTP ' + resp.status + ')');
  const text = await resp.text();
  const rows = vehCsvParse(text);
  const vehicles = vehSheetRowsToVehicles(rows);
  if(!vehicles.length) throw new Error('Το Sheet δεν περιέχει δεδομένα.');
  VEH_DATA = vehicles;
  renderVehicles();
}

async function vehReloadAuto(){
  const loader = document.getElementById('vehLoader');
  const msg = document.getElementById('vehMsg');
  if(loader) loader.style.display = 'block';
  if(msg){ msg.style.display='none'; msg.textContent=''; }

  try{
    const resp = await fetch(encodeURI(VEH_SHEET_LINK_PATH), { cache: 'no-store' });
    if(resp.ok){
      const linkText = await resp.text();
      const sheetId = vehExtractSheetId(linkText.split('\n')[0]);
      if(sheetId){
        const input = document.getElementById('vehSheetId');
        if(input) input.value = sheetId;
        await vehLoadFromSheetId(sheetId);
        return;
      }
    }
    await vehReload();
  }catch(e){
    console.warn('Vehicles auto load:', e);
    VEH_DATA = [];
    if(msg){
      msg.style.display='block';
      msg.textContent = 'Vehicles (Auto): ' + (e?.message || String(e));
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

    const resp = await fetch(DATA_BASE + f.path, { cache: 'no-store' });
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

async function vehReloadFromSheet(){
  const loader = document.getElementById('vehLoader');
  const msg = document.getElementById('vehMsg');
  if(loader) loader.style.display = 'block';
  if(msg){ msg.style.display='none'; msg.textContent=''; }

  const input = document.getElementById('vehSheetId');
  const sheetId = vehExtractSheetId(input?.value || VEH_SHEET_DEFAULT_ID);
  try{
    if(!sheetId) throw new Error('Δεν βρέθηκε Sheet ID.');
    await vehLoadFromSheetId(sheetId);
  }catch(e){
    console.warn('Vehicles sheet load:', e);
    VEH_DATA = [];
    if(msg){
      msg.style.display='block';
      msg.textContent = 'Vehicles (Sheet): ' + (e?.message || String(e));
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
  const sheet = document.getElementById('vehSheetId');
  if(sheet && !sheet.value) sheet.value = VEH_SHEET_DEFAULT_ID;

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
    const resp = await fetch(DATA_BASE + path, { cache: 'no-store' });
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

    const resp = await fetch(DATA_BASE + f.path, { cache: 'no-store' });
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
  const resp = await fetch(DATA_BASE + path);
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
