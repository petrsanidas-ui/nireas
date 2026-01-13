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

  const results = [];
  let primaryErr = null;
  let primaryOk = false;
  const extrasErrors = [];

  const handleResult = (t, value, errorMsg)=>{
    if(value) results.push(value);
    if(t.primary){
      if(value && value.ok === true){
        primaryOk = true;
      } else {
        const er = errorMsg || ((value && value.error) ? value.error : 'δεν φορτώθηκαν δεδομένα');
        primaryErr = `${t.name || t.url}: ${er}`;
      }
    } else {
      if(!(value && value.ok === true)){
        const nm = (value?.name || t.name || t.url);
        const er = errorMsg || (value?.error || 'δεν φορτώθηκαν δεδομένα');
        extrasErrors.push(`${nm}: ${er}`);
      }
    }
    if(mode !== 'primary'){
      renderStationMultiList(results);
    }
  };

  const tasks = targets.map(t =>
    fetchStationDataSingle(t.url, t.name, t.primary)
      .then(value => handleResult(t, value, null))
      .catch(err => {
        const er = (err && err.message) ? err.message : String(err || 'σφάλμα');
        handleResult(t, null, er);
      })
  );

  await Promise.allSettled(tasks);

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

function getAIAutoSendConfig(){
  return {
    enabled: localStorage.getItem('NIREAS_AI_AUTO_SEND') === '1',
    provider: localStorage.getItem('NIREAS_AI_AUTO_SEND_PROVIDER') || 'openai',
    model: localStorage.getItem('NIREAS_AI_AUTO_SEND_MODEL') || '',
    key: localStorage.getItem('NIREAS_AI_AUTO_SEND_KEY') || '',
    endpoint: localStorage.getItem('NIREAS_AI_AUTO_SEND_ENDPOINT') || ''
  };
}

function sendAIPromptAuto(prompt, cfg){
  if(!cfg || !cfg.enabled) return Promise.resolve(false);
  const provider = cfg.provider || 'openai';
  const model = cfg.model || (provider === 'gemini' ? 'gemini-1.5-pro' : 'gpt-4o-mini');
  const headers = { 'Content-Type': 'application/json' };

  let url = '';
  let body = {};

  if(provider === 'gemini'){
    if(!cfg.key) return Promise.resolve(false);
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(cfg.key)}`;
    body = { contents: [{ parts: [{ text: prompt }] }] };
  }else if(provider === 'custom'){
    if(!cfg.endpoint) return Promise.resolve(false);
    url = cfg.endpoint;
    if(cfg.key) headers.Authorization = `Bearer ${cfg.key}`;
    body = { prompt };
  }else{
    if(!cfg.key) return Promise.resolve(false);
    url = cfg.endpoint || 'https://api.openai.com/v1/chat/completions';
    headers.Authorization = `Bearer ${cfg.key}`;
    body = { model, messages: [{ role: 'user', content: prompt }], temperature: 0.2 };
  }

  return fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
    .then(resp => {
      if(!resp.ok) throw new Error(`HTTP ${resp.status}`);
      __aiToast(`✅ Αυτόματη αποστολή ολοκληρώθηκε (${provider}).`);
      return true;
    })
    .catch(err => {
      __aiToast(`⚠️ Αυτόματη αποστολή απέτυχε (${provider}): ${err?.message || err}`);
      return false;
    });
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

  const autoSendCfg = getAIAutoSendConfig();
  if(autoSendCfg.enabled){
    sendAIPromptAuto(prompt, autoSendCfg);
  }

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
