import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
  import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
  import {
    getFirestore,
    doc,
    setDoc,
    writeBatch,
    serverTimestamp,
    collection,
    collectionGroup,
    getDocs,
    query,
    orderBy,
    limit
  } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

  // Firebase config (project: nireas-logger)
  const firebaseConfig = {
    apiKey: "AIzaSyCLMx9W0Zi91-m4NmMl6UocYHhYBWUh9VI",
    authDomain: "nireas-logger.firebaseapp.com",
    projectId: "nireas-logger",
    storageBucket: "nireas-logger.firebasestorage.app",
    messagingSenderId: "632371274630",
    appId: "1:632371274630:web:f4f50d5c3f7c9bc060c207"
  };

  // Small stable id generator (FNV-1a 32-bit)
  function fnv1a32(str){
    let h = 0x811c9dc5;
    for(let i=0;i<str.length;i++){
      h ^= str.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
  function stationIdFromKey(stationKey){
    return "s_" + fnv1a32(String(stationKey)).toString(16);
  }

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  // Start auth immediately; fbLogSample will wait for it
  const authReady = signInAnonymously(auth)
    .then(()=>console.log("Firebase auth OK ✅"))
    .catch((e)=>console.error("Firebase auth FAILED ❌", e));

  // Writes:
  // stations/<stationId>  (merge)  + lastSample
  // stations/<stationId>/samples/t_<tsMs> (merge)  (DEDUP by timestamp)
  window.fbLogSample = async (stationKey, sample) => {
    await authReady;

    const stationId = stationIdFromKey(stationKey);
    const tsMs = (typeof sample?.tsMs === "number") ? sample.tsMs : Date.now();
    const sampleDocId = "t_" + String(tsMs);

    const stationRef = doc(db, "stations", stationId);
    const sampleRef  = doc(db, "stations", stationId, "samples", sampleDocId);

    const payload = {
      stationId,
      stationKey: String(stationKey),
      label: sample?.label ?? null,

      stationName: sample?.stationName ?? null,
      stationUrl: sample?.stationUrl ?? null,
      lat: (typeof sample?.lat === "number") ? sample.lat : null,
      lon: (typeof sample?.lon === "number") ? sample.lon : null,
      elev: (typeof sample?.elev === "number") ? sample.elev : null,

      sampleKey: sample?.sampleKey ?? null,
      tsMs,
      tsText: sample?.tsText ?? null,

      rainRate: (typeof sample?.rainRate === "number") ? sample.rainRate : null,
      dp: (typeof sample?.dp === "number") ? sample.dp : null,
      total: (typeof sample?.total === "number") ? sample.total : null,
      totalSrc: sample?.totalSrc ?? null,

      // extra metrics
      temp: (typeof sample?.temp === "number") ? sample.temp : null,
      hum: (typeof sample?.hum === "number") ? sample.hum : null,
      dewPoint: (typeof sample?.dewPoint === "number") ? sample.dewPoint : null,
      wind: (typeof sample?.wind === "string") ? sample.wind : null,
      baro: (typeof sample?.baro === "number") ? sample.baro : null,

      today: (typeof sample?.today === "number") ? sample.today : null,
      storm: (typeof sample?.storm === "number") ? sample.storm : null,
      month: (typeof sample?.month === "number") ? sample.month : null,
      year: (typeof sample?.year === "number") ? sample.year : null,

      chill: (typeof sample?.chill === "number") ? sample.chill : null,
      heat: (typeof sample?.heat === "number") ? sample.heat : null,
      sunrise: (typeof sample?.sunrise === "string") ? sample.sunrise : null,
      sunset: (typeof sample?.sunset === "string") ? sample.sunset : null,

      fetchedAt: serverTimestamp(),
      clientTsMs: Date.now()
    };

    const batch = writeBatch(db);

    // ensure station doc exists + keep lastSample for dashboard
    batch.set(stationRef, {
      stationId,
      stationKey: String(stationKey),
      label: sample?.label ?? null,

      stationName: sample?.stationName ?? null,
      stationUrl: sample?.stationUrl ?? null,
      lat: (typeof sample?.lat === "number") ? sample.lat : null,
      lon: (typeof sample?.lon === "number") ? sample.lon : null,
      elev: (typeof sample?.elev === "number") ? sample.elev : null,
      lastSeen: serverTimestamp(),
      lastSample: {
        tsMs,
        tsText: payload.tsText,
        stationName: payload.stationName,
        stationUrl: payload.stationUrl,
        lat: payload.lat,
        lon: payload.lon,
        elev: payload.elev,
        rainRate: payload.rainRate,
        dp: payload.dp,
        total: payload.total,
        totalSrc: payload.totalSrc,

        temp: payload.temp,
        hum: payload.hum,
        dewPoint: payload.dewPoint,
        wind: payload.wind,
        baro: payload.baro,

        today: payload.today,
        storm: payload.storm,
        month: payload.month,
        year: payload.year,

        chill: payload.chill,
        heat: payload.heat,
        sunrise: payload.sunrise,
        sunset: payload.sunset
      }
    }, { merge: true });

    // dedup by docId (t_<tsMs>)
    batch.set(sampleRef, payload, { merge: true });

    await batch.commit();
  };

  // Reads:
  // stations/<stationId>/samples (orderBy tsMs desc)
  window.fbFetchRecentSamples = async (stationKey, limitN = 50) => {
    await authReady;

    const stationId = stationIdFromKey(stationKey);
    const lim = Math.max(1, Math.min(500, Number(limitN) || 50));
    const colRef = collection(db, "stations", stationId, "samples");
    const q = query(colRef, orderBy("tsMs", "desc"), limit(lim));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  };

  // Reads (ALL stations) via collectionGroup("samples") (orderBy tsMs desc)
  // NOTE: Requires Firestore rules to allow collectionGroup read.
  window.fbFetchRecentSamplesAll = async (limitN = 200) => {
    await authReady;
    const lim = Math.max(1, Math.min(500, Number(limitN) || 200));
    const q = query(collectionGroup(db, "samples"), orderBy("tsMs", "desc"), limit(lim));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  };

  console.log("Firebase logger ready ✅");
