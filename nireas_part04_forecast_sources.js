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
