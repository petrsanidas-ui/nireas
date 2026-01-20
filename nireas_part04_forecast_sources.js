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

    const resp = await fetch(DATA_BASE + f.path, { cache: 'no-store' });
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

/* ===================== WEATHER FORECAST (OPEN-METEO) ===================== */
const WEATHER_FORECAST_DEFAULT_URL = 'https://api.open-meteo.com/v1/forecast?latitude=38.0237&longitude=23.8007&hourly=temperature_2m,rain,snowfall,precipitation,wind_speed_10m,wind_gusts_10m,soil_temperature_0_to_7cm,surface_temperature&models=ecmwf_ifs&forecast_days=1';
const weatherForecastState = {
  sources: [],
  selected: []
};

const WEATHER_HEADER_MAP = {
  source: { id: 'weatherThSource', label: 'Πηγή' },
  temperature_2m: { id: 'weatherThTemp', label: 'Θερμοκρασία' },
  rain: { id: 'weatherThRain', label: 'Βροχή' },
  snowfall: { id: 'weatherThSnowfall', label: 'Χιονόπτωση' },
  precipitation: { id: 'weatherThPrecip', label: 'Κατακρήμν.' },
  wind_speed_10m: { id: 'weatherThWind', label: 'Άνεμος' },
  wind_gusts_10m: { id: 'weatherThGusts', label: 'Ριπές' },
  soil_temperature_0_to_7cm: { id: 'weatherThSoilTemp', label: 'Θερμ. εδάφους' },
  surface_temperature: { id: 'weatherThSurfaceTemp', label: 'Θερμ. επιφάνειας' }
};

function formatWeatherNumber(value){
  if(value === null || value === undefined || Number.isNaN(value)) return '—';
  if(typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(1);
  return String(value);
}

function formatWeatherTime(value){
  if(!value) return '—';
  const d = new Date(value);
  if(Number.isNaN(d.getTime())) return String(value);
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${hh}:${min} ${dd}-${mm}-${yyyy}`;
}

function setWeatherHeaderUnits(units){
  Object.entries(WEATHER_HEADER_MAP).forEach(([key, meta]) => {
    const el = document.getElementById(meta.id);
    if(!el) return;
    if(key === 'source'){
      el.textContent = meta.label;
      return;
    }
    const unit = units?.[key];
    el.textContent = `${meta.label}${unit ? ` (${unit})` : ''}`;
  });
}

function renderWeatherForecastRows(payloads){
  const tbody = document.getElementById('weatherForecastRows');
  if(!tbody) return;
  tbody.innerHTML = '';

  const validPayloads = Array.isArray(payloads) ? payloads.filter(Boolean) : [];
  if(!validPayloads.length){
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="10" style="padding:10px;color:#6b7a86;">(Δεν βρέθηκαν δεδομένα)</td>`;
    tbody.appendChild(tr);
    return;
  }

  validPayloads.forEach(payload => {
    const hourly = payload?.data?.hourly;
    const times = Array.isArray(hourly?.time) ? hourly.time : [];
    if(!times.length) return;
    const sourceLabel = payload?.label || '—';
    for(let i = 0; i < times.length; i += 1){
      const tr = document.createElement('tr');
      const cols = [
        sourceLabel,
        formatWeatherTime(times[i]),
        formatWeatherNumber(hourly?.temperature_2m?.[i]),
        formatWeatherNumber(hourly?.rain?.[i]),
        formatWeatherNumber(hourly?.snowfall?.[i]),
        formatWeatherNumber(hourly?.precipitation?.[i]),
        formatWeatherNumber(hourly?.wind_speed_10m?.[i]),
        formatWeatherNumber(hourly?.wind_gusts_10m?.[i]),
        formatWeatherNumber(hourly?.soil_temperature_0_to_7cm?.[i]),
        formatWeatherNumber(hourly?.surface_temperature?.[i])
      ];

      cols.forEach((val, idx) => {
        const td = document.createElement('td');
        if(idx <= 1){
          td.style.textAlign = 'left';
          td.style.paddingLeft = '10px';
          if(idx === 1) td.style.whiteSpace = 'nowrap';
        }else{
          td.style.textAlign = 'center';
        }
        td.textContent = val;
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    }
  });
}

function renderWeatherForecastSourcePicker(){
  const select = document.getElementById('weatherForecastSourceSelect');
  if(!select) return;
  select.innerHTML = '';

  if(!Array.isArray(weatherForecastState.sources) || !weatherForecastState.sources.length){
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Δεν βρέθηκαν πηγές πρόγνωσης';
    select.appendChild(opt);
    select.disabled = true;
    return;
  }

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Επιλογή πηγής πρόγνωσης...';
  select.appendChild(placeholder);

  weatherForecastState.sources.forEach(source => {
    const opt = document.createElement('option');
    opt.value = source.url;
    opt.textContent = source.label || source.url || '—';
    select.appendChild(opt);
  });
  select.disabled = false;
}

function updateWeatherForecastSummary(){
  const summary = document.getElementById('weatherForecastSelectedSummary');
  if(!summary) return;
  const names = weatherForecastState.selected.map(s => s.label || s.url).filter(Boolean);
  if(!names.length){
    summary.textContent = '—';
    return;
  }
  const trimmed = names.slice(0, 3);
  summary.textContent = trimmed.join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '');
}

function renderWeatherForecastSelectedList(){
  const wrap = document.getElementById('weatherForecastSelectedList');
  if(!wrap) return;
  wrap.innerHTML = '';

  weatherForecastState.selected.forEach(source => {
    const chip = document.createElement('div');
    chip.className = 'chip watch';
    chip.title = source.url || '';

    const label = document.createElement('b');
    label.textContent = source.label || source.url || '—';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '✕';
    btn.title = 'Αφαίρεση';
    btn.addEventListener('click', () => removeWeatherForecastSource(source.url));

    chip.appendChild(label);
    chip.appendChild(btn);
    wrap.appendChild(chip);
  });

  updateWeatherForecastSummary();
}

function addWeatherForecastSource(){
  const select = document.getElementById('weatherForecastSourceSelect');
  if(!select) return;
  const url = select.value;
  if(!url) return;
  const source = weatherForecastState.sources.find(item => item.url === url);
  if(!source) return;
  if(!weatherForecastState.selected.some(item => item.url === url)){
    weatherForecastState.selected.push(source);
  }
  renderWeatherForecastSelectedList();
  loadWeatherForecastSelected();
}

function removeWeatherForecastSource(url){
  if(!url) return;
  weatherForecastState.selected = weatherForecastState.selected.filter(item => item.url !== url);
  renderWeatherForecastSelectedList();
  loadWeatherForecastSelected();
}

function clearWeatherForecastSelection(){
  weatherForecastState.selected = [];
  renderWeatherForecastSelectedList();
  loadWeatherForecastSelected();
}

function openSelectedWeatherForecastWeb(){
  const select = document.getElementById('weatherForecastSourceSelect');
  if(!select) return;
  const source = weatherForecastState.sources.find(item => item.url === select.value);
  if(source?.url) openForecastWeb(source.url);
}

function parseWeatherForecastSources(text){
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('//'));
  return lines.map(url => ({
    url,
    label: forecastLabelFromUrl(url)
  }));
}

function pickWeatherForecastFiles(treeFiles){
  const files = Array.isArray(treeFiles) ? treeFiles : [];
  const matches = files.filter(entry =>
    entry?.path &&
    (/data\/forecast\/Weather Forecast$/i.test(entry.path) ||
      /data\/forecast\/Weather Forecast\//i.test(entry.path))
  );
  return matches.length ? matches : [];
}

async function loadWeatherForecastSourcesFromTree(treeFiles){
  const matches = pickWeatherForecastFiles(treeFiles);
  if(!matches.length) return [{ url: WEATHER_FORECAST_DEFAULT_URL, label: 'Open‑Meteo' }];

  const sources = [];
  for(const file of matches){
    try{
      const resp = await fetch(DATA_BASE + file.path, { cache: 'no-store' });
      if(!resp.ok) continue;
      const text = await resp.text();
      sources.push(...parseWeatherForecastSources(text));
    }catch(_){
      // ignore bad file
    }
  }
  const deduped = [];
  const seen = new Set();
  sources.forEach(source => {
    if(!source?.url || seen.has(source.url)) return;
    seen.add(source.url);
    deduped.push(source);
  });
  return deduped.length ? deduped : [{ url: WEATHER_FORECAST_DEFAULT_URL, label: 'Open‑Meteo' }];
}

async function initWeatherForecast(treeFiles){
  const loader = document.getElementById('weatherForecastSourceLoader');
  const msg = document.getElementById('weatherForecastSourceMsg');
  if(loader) loader.style.display = 'block';
  if(msg){ msg.style.display = 'none'; msg.textContent = ''; }

  try{
    const sources = await loadWeatherForecastSourcesFromTree(treeFiles);
    weatherForecastState.sources = sources;
    renderWeatherForecastSourcePicker();
    renderWeatherForecastSelectedList();
    loadWeatherForecastSelected();
  }catch(e){
    console.warn('Weather Forecast:', e);
    if(msg){
      msg.style.display = 'block';
      msg.textContent = 'Weather Forecast: ' + (e?.message || String(e));
    }
    weatherForecastState.sources = [];
    renderWeatherForecastSourcePicker();
    renderWeatherForecastSelectedList();
    renderWeatherForecastRows([]);
  }finally{
    if(loader) loader.style.display = 'none';
  }
}

async function loadWeatherForecastSelected(){
  const loader = document.getElementById('weatherForecastMainLoader');
  const msg = document.getElementById('weatherForecastMainMsg');
  const hint = document.getElementById('weatherForecastMainHint');
  if(loader) loader.style.display = 'block';
  if(msg){ msg.style.display = 'none'; msg.textContent = ''; }

  const selected = weatherForecastState.selected;
  if(!Array.isArray(selected) || !selected.length){
    renderWeatherForecastRows([]);
    if(hint){
      hint.textContent = 'Επίλεξε πηγή από το αριστερό panel «⛅ Weather Forecast».';
    }
    if(typeof updateWeatherForecastStatus === 'function'){
      updateWeatherForecastStatus('Weather Forecast: (δεν έχει επιλεγεί)', 'warn');
    }
    if(loader) loader.style.display = 'none';
    return;
  }

  if(hint){
    hint.textContent = 'Τα δεδομένα αντλούνται από τις πηγές του φακέλου data/forecast/Weather Forecast.';
  }
  if(typeof updateWeatherForecastStatus === 'function'){
    updateWeatherForecastStatus('Weather Forecast: Λήψη…', 'neutral');
  }

  try{
    const payloads = [];
    const errors = [];
    for(const source of selected){
      try{
        const resp = await fetch(source.url, { cache: 'no-store' });
        if(!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        if(data?.hourly_units) setWeatherHeaderUnits(data.hourly_units);
        payloads.push({ label: source.label, data });
      }catch(e){
        errors.push(source?.label || source?.url || '—');
        console.warn('Weather Forecast source failed:', source?.url, e);
      }
    }
    renderWeatherForecastRows(payloads);
    if(errors.length && msg){
      msg.style.display = 'block';
      msg.textContent = `Weather Forecast: Αποτυχία φόρτωσης για ${errors.join(', ')}`;
    }
    if(typeof updateWeatherForecastStatus === 'function'){
      if(payloads.length && !errors.length){
        updateWeatherForecastStatus('Weather Forecast: Λήψη OK', 'ok');
      }else if(payloads.length && errors.length){
        updateWeatherForecastStatus('Weather Forecast: Μερική φόρτωση', 'warn');
      }else{
        updateWeatherForecastStatus('Weather Forecast: Αποτυχία φόρτωσης', 'warn');
      }
    }
  }catch(e){
    console.warn('Weather Forecast:', e);
    if(msg){
      msg.style.display = 'block';
      msg.textContent = 'Weather Forecast: ' + (e?.message || String(e));
    }
    renderWeatherForecastRows([]);
    if(typeof updateWeatherForecastStatus === 'function'){
      updateWeatherForecastStatus('Weather Forecast: Σφάλμα λήψης δεδομένων', 'warn');
    }
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

    const resp = await fetch(DATA_BASE + f.path, { cache: 'no-store' });
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
