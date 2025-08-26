/* Pasadas GPS - main.js */
(() => {
  const $ = sel => document.querySelector(sel);
  const stateBadge = s => `<span class="badge ${s}">${s.toUpperCase()}</span>`;
  const fmtTime = s => { const m = Math.floor(s/60), ss = (s%60).toString().padStart(2,'0'); return `${m}:${ss}`; };
  function speak(text){ try { const u = new SpeechSynthesisUtterance(text); u.lang='es-AR'; speechSynthesis.cancel(); speechSynthesis.speak(u);} catch{} }
  async function notify(text){ try { if ('Notification' in window && Notification.permission==='granted') new Notification(text);} catch{} }
  function vibrate(pattern=[300,150,300]){ try { navigator.vibrate(pattern);} catch{} }

  // Haversine (metros)
  function haversine(lat1, lon1, lat2, lon2) {
    const R=6371000, toRad=d=>d*Math.PI/180;
    const dLat=toRad(lat2-lat1), dLon=toRad(lon2-lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
    return 2*R*Math.asin(Math.sqrt(a));
  }

  // ---- Global State ----
  let watchId=null, wakeLock=null;
  let mode='idle'; // 'work'|'rest'|'done'
  let totalReps=10, currentRep=0;
  let targetWork=400, targetRest=60;
  let segmentDist=0;
  let lastPos=null;
  let restTimer=null, restRemaining=0;

  // Tracking for map/GPX
  const track = []; // {lat, lon, t, mode}
  let map, path, currentMarker;

  function setStatus(html, cls){ $('#status').innerHTML = `${stateBadge(cls)} ${html}`; }
  function log(msg){ $('#log').textContent = `[${new Date().toLocaleTimeString()}] ${msg}\n` + $('#log').textContent; }
  function updateProgress(){
    $('#progress').innerHTML = `<div><b>Rep:</b> ${currentRep}/${totalReps}</div>
      <div><b>Dist. trabajo:</b> ${segmentDist.toFixed(1)} m / ${targetWork} m</div>
      ${mode==='rest'?`<div><b>Pausa:</b> ${fmtTime(restRemaining)}</div>`:''}`;
  }

  async function requestPerms(){
    try { await navigator.permissions.query({name:'geolocation'}); } catch {}
    try { if ('Notification' in window && Notification.permission==='default') await Notification.requestPermission(); } catch {}
  }

  async function keepAwake(){
    try {
      if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
      document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState==='visible' && wakeLock && wakeLock.released){
          try { wakeLock = await navigator.wakeLock.request('screen'); } catch {}
        }
      });
    } catch {}
  }

  function initMap(){
    if (map) return;
    map = L.map('map');
    // OSM tiles (be kind)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    path = L.polyline([], { weight: 5 }).addTo(map);
  }

  function fitIfNeeded(lat, lon){
    if (!map) return;
    if (!map._loaded || path.getLatLngs().length<2){
      map.setView([lat, lon], 17);
    }
  }

  function pushTrack(lat, lon, t){
    track.push({lat, lon, t, mode});
    if (path) {
      const ll = L.latLng(lat, lon);
      path.addLatLng(ll);
      if (!currentMarker) currentMarker = L.circleMarker(ll, { radius: 7 }).addTo(map);
      else currentMarker.setLatLng(ll);
    }
  }

  function startSession(){
    totalReps = +$('#reps').value || 10;
    targetWork = +$('#workMeters').value || 400;
    targetRest = +$('#restSecs').value || 60;

    currentRep = 0; segmentDist = 0; lastPos = null;
    mode = 'work'; track.length = 0;
    $('#startBtn').disabled = true;
    $('#stopBtn').disabled = false;
    $('#exportBtn').disabled = true;

    setStatus('Comenzá a correr.', 'work'); updateProgress();
    speak(`Iniciamos ${totalReps} pasadas de ${targetWork} metros.`); vibrate();
    initMap();

    watchId = navigator.geolocation.watchPosition(onPos, onErr, {
      enableHighAccuracy: true, timeout: 10000, maximumAge: 1000
    });
  }

  function stopSession(reason='Detenido'){
    try { if (watchId!==null) navigator.geolocation.clearWatch(watchId); } catch {}
    watchId=null;
    if (restTimer) { clearInterval(restTimer); restTimer=null; }
    if (wakeLock) { try { wakeLock.release(); } catch {} }
    mode='done';
    $('#exportBtn').disabled = track.length===0;
    setStatus(reason, 'done');
    $('#startBtn').disabled = false; $('#stopBtn').disabled = true;
    speak(reason); vibrate([200]);
  }

  function nextRepOrFinish(){
    currentRep++;
    if (currentRep >= totalReps){
      stopSession('¡Listo! Completaste todas las pasadas.');
      notify('Sesión completada ✅');
      return;
    }
    // Rest
    mode='rest'; restRemaining = targetRest;
    setStatus('Pausa activa. Recuperá.', 'rest'); updateProgress();
    speak(`Objetivo alcanzado. Pausa de ${Math.round(targetRest/60)} minuto${targetRest>=120?'s':''}.`);
    vibrate();
    restTimer = setInterval(() => {
      restRemaining--;
      updateProgress();
      if (restRemaining<=0){
        clearInterval(restTimer); restTimer=null;
        // New work segment
        mode='work'; segmentDist=0; lastPos=null;
        setStatus(`¡A correr! Pasada ${currentRep+1} de ${totalReps}.`, 'work');
        updateProgress();
        speak(`¡Vamos! Pasada ${currentRep+1}.`); vibrate([200,120,200]);
      }
    }, 1000);
  }

  function onPos(pos){
    const { latitude, longitude, accuracy } = pos.coords;
    if (accuracy && accuracy > 25) { log(`Descartada por baja precisión: ~${Math.round(accuracy)} m`); return; }
    const t = pos.timestamp;
    pushTrack(latitude, longitude, t);
    fitIfNeeded(latitude, longitude);

    if (mode!=='work'){ lastPos = {lat:latitude, lon:longitude, t}; return; }

    if (lastPos){
      const d = haversine(lastPos.lat, lastPos.lon, latitude, longitude);
      const dt = (t - lastPos.t)/1000;
      const speed = d/(dt||1);
      if (d>=1 && speed <= 6){ // <= ~21.6 km/h para filtrar saltos
        segmentDist += d;
        updateProgress();
        if (segmentDist >= targetWork){
          notify('Objetivo de distancia alcanzado'); nextRepOrFinish();
        }
      }
    }
    lastPos = {lat:latitude, lon:longitude, t};
  }

  function onErr(err){
    log(`GPS error: ${err.message||err}`);
    setStatus('Error de GPS. Andá a cielo abierto y revisá permisos.', 'done');
  }

  function exportGPX(){
    const name = `pasadas_${new Date().toISOString().replace(/[:.]/g,'-')}.gpx`;
    const trkpts = track.map(p => `<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><time>${new Date(p.t).toISOString()}</time></trkpt>`).join('\n');
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="PasadasGPS" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Sesión de pasadas</name><trkseg>
${trkpts}
  </trkseg></trk>
</gpx>`;
    const blob = new Blob([gpx], {type:'application/gpx+xml'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Install prompt
  let deferredPrompt=null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt=e;
    $('#installBtn').style.display='inline-block';
  });
  $('#installBtn')?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt=null;
    $('#installBtn').style.display='none';
  });

  // UI hooks
  $('#startBtn').addEventListener('click', async () => { await requestPerms(); await keepAwake(); startSession(); });
  $('#stopBtn').addEventListener('click', () => stopSession('Sesión detenida.'));
  $('#exportBtn').addEventListener('click', exportGPX);
})();
