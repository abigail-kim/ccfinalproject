  
async function fetchParks(){
  // prefer search endpoint when searching live, otherwise return static list
  try{
    const res = await fetch('/api/parks');
    if(res.ok) return await res.json();
  }catch(e){ }
  try{
    const res = await fetch('/data/parks.json');
    return await res.json();
  }catch(e){ return [] }
}

// --- lightweight WebAudio ambient engine (no external files) ---
const _audioEngine = (function(){
  let ctx = null;
  let noiseBuffer = null;
  let current = null;
  let samples = {}; // name -> AudioBuffer

  async function loadSample(name, url){
    try{
      const c = ensureCtx();
      const res = await fetch(url);
      if (!res.ok) throw new Error('fetch failed');
      const ab = await res.arrayBuffer();
      const buf = await c.decodeAudioData(ab.slice(0));
      samples[name] = buf; return buf;
    }catch(e){ console.warn('sample load failed', name, url, e); return null }
  }

  function spawnSample(params){
    const c = ensureCtx();
    const now = c.currentTime;
    const name = params.sample;
    const buf = samples[name];
    if (!buf) return;
    const src = c.createBufferSource(); src.buffer = buf; src.loop = !!params.loop;
    const g = c.createGain(); g.gain.value = 0.0001;
    const filt = c.createBiquadFilter(); if (params.filterFreq) filt.frequency.value = params.filterFreq; filt.type = params.filterType || 'lowpass';
    src.connect(filt); filt.connect(g); g.connect(current.master);
    g.gain.linearRampToValueAtTime(params.amp || 0.8, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + (params.len || buf.duration));
    src.start(now);
    try{ src.stop(now + (params.len || buf.duration) + 0.02); }catch(e){}
  }

  function ensureCtx(){ if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); return ctx }
  function makeNoiseBuffer(){
    const c = ensureCtx();
    const len = c.sampleRate * 2.0; // 2s
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i=0;i<len;i++) data[i] = (Math.random()*2-1) * 0.25;
    return buf;
  }

    // versatile sound event spawner: supports noise bursts, short tones, low rumbles, and grains
    function spawnChirp(params){
      const c = ensureCtx();
      const type = params.type || 'noise';
      const now = c.currentTime;
      try{
        if (type === 'tone'){
          // soft pitched call — use triangle or sine at low amplitude
          const o = c.createOscillator(); o.type = params.wave || 'triangle';
          o.frequency.value = params.freq || 2400;
          const g = c.createGain(); g.gain.value = 0;
          o.connect(g); g.connect(current.master);
          g.gain.cancelScheduledValues(now);
          g.gain.setValueAtTime(0, now);
          g.gain.linearRampToValueAtTime(params.amp || 0.02, now + 0.006);
          g.gain.exponentialRampToValueAtTime(0.0001, now + (params.len || 0.08));
          o.start(now); o.stop(now + (params.len || 0.08) + 0.02);
          return;
        }

  if (type === 'rumble'){
          // longer low-frequency noise rumble
          const len = Math.max(1, Math.floor((params.len || 1.0) * c.sampleRate));
          const buf = c.createBuffer(1, len, c.sampleRate);
          const data = buf.getChannelData(0);
          for (let i=0;i<len;i++) data[i] = (Math.random()*2 - 1) * (params.amp || 0.02);
          const src = c.createBufferSource(); src.buffer = buf; src.loop = false;
          const filt = c.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = params.filterFreq || 600;
          const g = c.createGain(); g.gain.value = 0;
          src.connect(filt); filt.connect(g); g.connect(current.master);
          g.gain.setValueAtTime(0, now);
          g.gain.linearRampToValueAtTime(params.amp || 0.02, now + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, now + (params.len || 1.0));
          src.start(now); src.stop(now + (params.len || 1.0) + 0.02);
          return;
        }

        if (type === 'bird'){
          // if a named sample is provided and loaded, play it instead of synth
          if (params.sample && samples[params.sample]){ spawnSample(params); return; }
          // short melodic bird-like chirp: two oscillators with rapid pitch glide and bandpass
          const o1 = c.createOscillator(); const o2 = c.createOscillator();
          o1.type = params.wave1 || 'sine'; o2.type = params.wave2 || 'triangle';
          const now2 = c.currentTime;
          const base = params.freq || (1800 + Math.random()*1200);
          o1.frequency.setValueAtTime(base * (0.9 + Math.random()*0.25), now2);
          o2.frequency.setValueAtTime(base * (1.6 + Math.random()*0.6), now2);
          const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = params.filterFreq || (base*1.2);
          const g2 = c.createGain(); g2.gain.value = 0;
          o1.connect(bp); o2.connect(bp); bp.connect(g2); g2.connect(current.master);
          // quick pitch slide for a chirp
          const dur = params.len || 0.14;
          o1.frequency.exponentialRampToValueAtTime(base * (0.4 + Math.random()*0.6), now2 + dur*0.9);
          o2.frequency.exponentialRampToValueAtTime(base * (1.0 + Math.random()*0.3), now2 + dur*0.9);
          g2.gain.setValueAtTime(0.0001, now2);
          g2.gain.linearRampToValueAtTime(params.amp || 0.03, now2 + 0.005);
          g2.gain.exponentialRampToValueAtTime(0.0001, now2 + dur);
          o1.start(now2); o2.start(now2);
          o1.stop(now2 + dur + 0.02); o2.stop(now2 + dur + 0.02);
          return;
        }

        if (type === 'grain'){
          // very short percussive grain — brief noise with bandpass
          const len = Math.max(1, Math.floor((params.len || 0.03) * c.sampleRate));
          const buf = c.createBuffer(1, len, c.sampleRate);
          const data = buf.getChannelData(0);
          for (let i=0;i<len;i++) data[i] = (Math.random()*2 - 1) * (params.amp || 0.06);
          const src = c.createBufferSource(); src.buffer = buf; src.loop = false;
          const filt = c.createBiquadFilter(); filt.type = params.filterType || 'bandpass'; filt.frequency.value = params.filterFreq || 2200;
          const g = c.createGain(); g.gain.value = 0;
          src.connect(filt); filt.connect(g); g.connect(current.master);
          g.gain.setValueAtTime(0, now);
          g.gain.linearRampToValueAtTime(params.amp || 0.06, now + 0.002);
          g.gain.exponentialRampToValueAtTime(0.0001, now + (params.len || 0.03));
          src.start(now); src.stop(now + (params.len || 0.03) + 0.01);
          return;
        }

        // default: filtered noise burst (previous behaviour)
        const g = c.createGain();
        const b = c.createBufferSource();
        // make a short noise buffer if needed
        const len = Math.max(1, Math.floor((params.len || 0.35) * c.sampleRate));
        const buf = c.createBuffer(1, len, c.sampleRate);
        const data = buf.getChannelData(0);
        for (let i=0;i<len;i++) data[i] = (Math.random()*2 - 1) * (params.amp || 0.04);
        b.buffer = buf; b.loop = false;
        // gentle filtering to shape the burst
        const filt = c.createBiquadFilter(); filt.type = params.filterType || 'lowpass'; filt.frequency.value = params.filterFreq || 4500;
        g.gain.value = 0;
        b.connect(filt); filt.connect(g); g.connect(current.master);
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(0, now);
        // quick attack, slower decay
        g.gain.linearRampToValueAtTime(params.amp || 0.04, now + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, now + (params.len || 0.35));
        b.start(now); b.stop(now + (params.len || 0.35) + 0.02);
      }catch(e){ console.warn('spawnChirp error', e); }
    }

  async function startPreset(id, parkKey){
    const c = ensureCtx();
    // resume AudioContext in case it is suspended until a user gesture
    try{ if (c.state === 'suspended') await c.resume(); }catch(e){}
    // update playing indicator immediately (visual only)
    try{ updatePlayingIndicator(parkKey || id || ''); }catch(e){}
    // if this park (or id) is muted or global sound is disabled, do not start audio
    try{
      const checkKey = parkKey || id || '';
      if ((checkKey && !isSoundEnabledFor(checkKey)) || !isGlobalSoundEnabled()){
        // bail out early: indicator shown above, but do not create/start audio nodes
        return;
      }
    }catch(e){}
    if (!noiseBuffer) noiseBuffer = makeNoiseBuffer();
    stop();
    current = { master: c.createGain(), noiseSrc:null, chirpTimer:null, preset:id };
    current.master.gain.value = 0.0; current.master.connect(c.destination);

    // base noise source
    const src = c.createBufferSource(); src.buffer = noiseBuffer; src.loop = true;
    const filt = c.createBiquadFilter(); filt.type = 'lowpass';
    const gain = c.createGain(); gain.gain.value = 0.6;
    src.connect(filt); filt.connect(gain); gain.connect(current.master);
    current.noiseSrc = src;

    // map id/name to a preset key and apply preset def parameters
    const presetKey = (typeof pickPreset === 'function') ? pickPreset(id, '') : 'default';
    let def = PRESET_DEFS[presetKey] || PRESET_DEFS.default;
    // apply per-park nature style overrides
    try{
      const style = getNatureStyleFor(parkKey || presetKey || '');
      if (style === 'birds'){
        def = Object.assign({}, def, { noiseGain: 0.0, chirpTypes: (def.chirpTypes && def.chirpTypes.includes('bird')) ? def.chirpTypes : (Array.isArray(def.chirpTypes) ? ['bird'].concat(def.chirpTypes) : ['bird']) });
      }
    }catch(e){}

    filt.frequency.value = def.filterFreq || 1600;
    gain.gain.value = def.noiseGain || 0.12;
    // gentle fade-in for overall master
    const now = c.currentTime; current.master.gain.setValueAtTime(0.0, now); current.master.gain.linearRampToValueAtTime(0.9, now+1.2);
    src.start(now + 0.01);

  // mark playing indicator for this park key (if provided)
  try{ updatePlayingIndicator(parkKey || ''); }catch(e){}

    // If nature style is birds, attempt to load bird samples (non-blocking)
    try{
      const ns = getNatureStyleFor(parkKey||id||'');
      if (ns === 'birds'){
        // small set of sample names - developer should place these under /assets/birds/
        const birdSamples = ['bird1.wav','bird2.wav','bird3.wav'];
        birdSamples.forEach((fname, idx)=>{ const url = `/assets/birds/${fname}`; loadSample(`bird${idx+1}`, url).catch(()=>{}); });
      }
    }catch(e){}

    if (def.chirp){
      current.chirpTimer = setInterval(()=>{
        const f = def.chirpFreq ? (def.chirpFreq[0] + Math.random()*(def.chirpFreq[1]-def.chirpFreq[0])) : 2500;
        const amp = def.chirpAmp || 0.04;
        const len = def.chirpLen || (0.18 + Math.random()*0.45);
        // pick a type from preset's chirpTypes if available
        const types = def.chirpTypes || ['noise','grain','tone'];
        const t = types[Math.floor(Math.random()*types.length)];
        const params = { type: t, filterFreq: def.filterFreq || 1600, filterType: 'lowpass', amp: amp + (Math.random()*0.01), len: len };
        if (t === 'tone') params.freq = f * (0.5 + Math.random()*0.9);
        if (t === 'rumble') params.len = def.rumbleLen || (0.6 + Math.random()*1.2);
        spawnChirp(params);
      }, def.chirpRate || 3000);
    }
  }

  function stop(){
    try{
      if (!current) return;
      const c = ensureCtx();
      // capture the instance we're stopping so delayed cleanup won't touch a new `current` started meanwhile
      const inst = current;
      // fade out this instance
      const now = c.currentTime;
      try{ inst.master.gain.cancelScheduledValues(now); }catch(e){}
      try{ inst.master.gain.setValueAtTime(inst.master.gain.value, now); }catch(e){}
      try{ inst.master.gain.linearRampToValueAtTime(0.0, now+0.8); }catch(e){}
      if (inst.noiseSrc){ try{ inst.noiseSrc.stop(now + 0.85); }catch(e){} }
      if (inst.chirpTimer) { try{ clearInterval(inst.chirpTimer); }catch(e){} inst.chirpTimer = null; }
      // drop reference after short timeout but only clear the global `current` if it still points to this instance
      setTimeout(()=>{
        try{
          if (inst && inst.master) inst.master.disconnect();
        }catch(e){}
        try{ if (current === inst) { current = null; updatePlayingIndicator(''); } }catch(e){}
      }, 1200);
    }catch(e){ console.warn('audio stop error', e) }
  }

  return { startPreset, stop };
})();

// expose sample loader publicly
_audioEngine.loadSample = async function(name, url){ return await loadSample(name,url); };

// per-park sound enabled helpers (persisted map in localStorage)
function isSoundEnabledFor(id){
  try{ const m = JSON.parse(localStorage.getItem('soundEnabled')||'{}'); return m[id] !== false; }catch(e){ return true }
}
function setSoundEnabledFor(id, val){
  try{ const key = 'soundEnabled'; const m = JSON.parse(localStorage.getItem(key)||'{}'); m[id] = !!val; localStorage.setItem(key, JSON.stringify(m)); }catch(e){}
}

// per-park nature style (birds | wind) — default to 'birds' to avoid continuous wind noise
function getNatureStyleFor(id){ try{ const m = JSON.parse(localStorage.getItem('natureStyle')||'{}'); return m[id] || 'birds' }catch(e){ return 'birds' } }
function setNatureStyleFor(id, v){ try{ const key = 'natureStyle'; const m = JSON.parse(localStorage.getItem(key)||'{}'); m[id] = v; localStorage.setItem(key, JSON.stringify(m)); }catch(e){} }

// global sound enable/disable
function isGlobalSoundEnabled(){ try{ const v = localStorage.getItem('globalSoundEnabled'); return v === null ? true : (v === '1'); }catch(e){ return true } }
function setGlobalSoundEnabled(val){ try{ localStorage.setItem('globalSoundEnabled', val ? '1' : '0'); }catch(e){} }

// Preset definitions for different park sound types
const PRESET_DEFS = {
  // reduce continuous noise and windy events; prefer birds and soft grains
  forest: { filterFreq: 1800, noiseGain: 0.02, chirp: true, chirpFreq:[2200,3600], chirpRate: 2800, chirpAmp:0.035, chirpLen:0.34, chirpTypes:['bird','grain'] },
  coastal: { filterFreq: 900, noiseGain: 0.0, chirp: true, chirpFreq:[2800,4200], chirpRate: 4200, chirpAmp:0.032, chirpLen:0.5, swellRate:8, swellDepth:0.04, chirpTypes:['bird'] },
  mountain: { filterFreq: 2400, noiseGain: 0.0, chirp: true, chirpFreq:[1600,3000], chirpRate: 4200, chirpAmp:0.03, chirpLen:0.5, chirpTypes:['bird','grain'] },
  canyon: { filterFreq: 600, noiseGain: 0.0, chirp: true, echoDelay:0.26, chirpAmp:0.02, chirpTypes:['bird'] },
  desert: { filterFreq: 1400, noiseGain: 0.0, chirp: true, chirpAmp:0.02, chirpTypes:['bird','grain'], chirpRate:4200 },
  swamp: { filterFreq: 700, noiseGain: 0.0, chirp: true, chirpFreq:[1500,3000], chirpRate: 4200, chirpAmp:0.035, chirpLen:0.6, chirpTypes:['grain','bird'] },
  tundra: { filterFreq: 2600, noiseGain: 0.0, chirp: true, chirpAmp:0.02, chirpTypes:['bird'] },
  default: { filterFreq: 1600, noiseGain: 0.0, chirp: true, chirpFreq:[2000,3200], chirpRate:3000, chirpAmp:0.03, chirpLen:0.35, chirpTypes:['bird','grain'] },
  // specific unique presets
  yellowstone: { filterFreq: 2200, noiseGain: 0.0, chirp: true, chirpFreq:[800,1600], chirpRate: 5200, chirpAmp:0.03, chirpLen:0.6, chirpTypes:['bird'] },
  yosemitePreset: { filterFreq: 3000, noiseGain: 0.0, chirp: true, chirpFreq:[3200,4800], chirpRate: 2600, chirpAmp:0.03, chirpLen:0.28, chirpTypes:['bird'] },
  rocky: { filterFreq: 1800, noiseGain: 0.0, chirp: true, chirpFreq:[1200,2400], chirpRate: 6000, chirpAmp:0.012, chirpLen:1.2, chirpTypes:['bird'] }
};

// Map common park ids/names to presets
const PARK_PRESET_MAP = {
  'acad':'coastal', 'acadia':'coastal', 'island':'coastal',
  'yosemite':'yosemitePreset', 'yosem':'yosemitePreset', 'yell':'yellowstone', 'yellowstone':'yellowstone',
  'grandcanyon':'canyon', 'grca':'canyon', 'canyon':'canyon',
  'zion':'desert', 'bryce':'desert', 'death valley':'desert',
  'everglades':'swamp', 'denali':'tundra', 'glacier':'mountain', 'romo':'mountain', 'rocky':'rocky', 'rockymountain':'rocky', 'rocky mountain':'rocky'
};

function pickPreset(id, name){
  const a = (String(id||'') + ' ' + String(name||'')).toLowerCase();
  // exact map by id or substring
  for (const k in PARK_PRESET_MAP){ if (a.includes(k)) return PARK_PRESET_MAP[k]; }
  // heuristic fallbacks
  if (a.includes('coast')||a.includes('beach')||a.includes('island')) return 'coastal';
  if (a.includes('mount')||a.includes('peak')||a.includes('glacier')||a.includes('range')) return 'mountain';
  if (a.includes('canyon')||a.includes('gorge')||a.includes('rim')) return 'canyon';
  if (a.includes('desert')||a.includes('dune')||a.includes('valley')) return 'desert';
  if (a.includes('swamp')||a.includes('everglade')||a.includes('marsh')) return 'swamp';
  if (a.includes('tundra')||a.includes('alaska')||a.includes('denali')) return 'tundra';
  return 'forest';
}


function renderList(parks){
  const ul = document.getElementById('parks');
  if (!ul) return;
  ul.innerHTML = '';
  parks.forEach(p => {
    const li = document.createElement('li');
    li.textContent = `${p.name} — ${p.state}`;
    li.tabIndex = 0;
    li.addEventListener('click', ()=> showDetail(p));
    li.addEventListener('keypress', (e)=>{ if(e.key=== 'Enter') showDetail(p)});
  // sound UI removed per user request
    // favorite toggle
    const fav = document.createElement('button');
    fav.className = 'fav-btn';
    fav.style.marginLeft = '0.5rem';
    // set visual state based on whether it's already a favorite
    const currentFavs = (function(){ try{ return JSON.parse(localStorage.getItem('favorites')||'[]') }catch(e){return []} })();
    const isFav = !!currentFavs.find(f=>f.id===p.id);
    fav.textContent = isFav ? '★' : '☆';
    fav.setAttribute('aria-pressed', isFav ? 'true' : 'false');
    fav.addEventListener('click', (e)=>{
      e.stopPropagation();
      const nowFav = toggleFavorite(p);
      fav.textContent = nowFav ? '★' : '☆';
      fav.setAttribute('aria-pressed', nowFav ? 'true' : 'false');
    });
    li.appendChild(fav);
    ul.appendChild(li);
  });
}

// update visual playing indicator on sound buttons
function updatePlayingIndicator(activeKey){
  // sound buttons were removed from the UI; keep this as a no-op to avoid errors from callers
}

function showDetail(p){
  const d = document.getElementById('detail');
  if (!d) return;
  // images for this park (filled asynchronously from NPS proxy)
  let parkImages = [];
  d.innerHTML = `
    <div class="detail-inner">
      <div class="park-hero">
        <img id="parkImage" src="/assets/placeholder.svg" alt="" loading="lazy" />
        <div class="hero-overlay">
          <div class="hero-title" id="heroTitle">${p.name}</div>
          <div class="hero-sub" id="heroSub">${p.state} • ${p.established}</div>
          <div class="hero-credit" id="heroCredit" style="display:none"></div>
        </div>
      </div>
      <div id="map" style="height:260px;border-radius:8px;overflow:hidden"></div>
      <h2>${p.name}</h2>
      <p><strong>State:</strong> ${p.state}</p>
      <p><strong>Established:</strong> ${p.established}</p>
      <p>${p.description}</p>
      <p style="font-style:italic;margin-top:.5rem" id="parkMotivation">${p.motivation ? p.motivation : ''}</p>
  <p><button id="addCal">Add to calendar</button></p>
      <section id="visitPanel" style="margin-top:1rem;padding:.75rem;border-radius:8px;box-shadow:0 2px 6px rgba(2,6,23,0.04)">
        <h4>Goal progress</h4>
        <div style="display:flex;gap:.5rem;align-items:flex-start">
          <div style="flex:1">
            <div id="visitBarWrap" style="background:#e6eef8;border-radius:8px;height:12px;overflow:hidden">
              <div id="visitBar" style="height:12px;background:var(--accent);width:0%"></div>
            </div>
            <div style="font-size:.9rem;margin-top:.5rem"><strong id="visitCount">0</strong> / <strong id="visitTotal">0</strong> goals</div>
            <div style="margin-top:.6rem">
              <ul id="visitGoalsList" style="list-style:none;padding:0;margin:0;display:block"></ul>
            </div>
          </div>
          <div style="min-width:140px">
            <div style="display:flex;flex-direction:column;gap:.5rem"><button id="downloadGoals">Download goals</button><button id="downloadReport">Download report</button><button id="resetVisits" class="reset-btn">Reset</button></div>
            <div style="margin-top:.6rem">
              <img id="goalPreview" src="/assets/placeholder.svg" alt="Goal preview" style="width:100%;height:120px;object-fit:cover;border-radius:6px;display:none;margin-top:.5rem" />
            </div>
          </div>
        </div>
      </section>
    </div>`;

  // apply a short-bg class for specific parks where we want the panel background to stop after the visit panel
  try{
    const shortList = ['grandcanyon','grca','grand canyon','zion','everglades','ever','rockymountain','romo','rocky'];
    const keyId = String(p.id||p.parkCode||p.name||'').toLowerCase();
    const detailEl = document.getElementById('detail');
    if (detailEl){
      let has = false;
      for (const s of shortList) { if (keyId.includes(s)) { has = true; break; } }
      if (has) detailEl.classList.add('short-bg'); else detailEl.classList.remove('short-bg');
    }
  }catch(e){}
  const addCalBtn = document.getElementById('addCal');
  if (addCalBtn) addCalBtn.addEventListener('click', ()=> addToCalendar(p));
  // nature style controls removed; default style is 'wind'
  // set packing checklist name (we'll choose which activity id to use below)
  const packingNameEl = document.getElementById('packingName');
  if (packingNameEl) packingNameEl.textContent = p.name;

  // create a separate alerts box after the packing section (as its own space)
  (function ensureAlertsContainer(){
    const packingSection = document.getElementById('packing');
    const detail = document.getElementById('detail');
    if (!detail) return;
    let alerts = document.getElementById('npsAlerts');
    if (!alerts){
      alerts = document.createElement('div');
      alerts.id = 'npsAlerts';
      alerts.className = 'nps-alerts';
      alerts.style.margin = '1rem 0';
      const title = document.createElement('div'); title.textContent = 'Park alerts'; title.className = 'title'; alerts.appendChild(title);
      const list = document.createElement('div'); list.id = 'npsAlertsList'; alerts.appendChild(list);
      if (packingSection && packingSection.parentNode) packingSection.parentNode.insertBefore(alerts, packingSection.nextSibling);
      else detail.appendChild(alerts);
    }
  })();

    // fetch NPS alerts for this park and render under packing
    async function fetchNpsAlerts(park){
      try{
        // small manual mapping for demo ids -> official NPS parkCode to improve matching
        const PARK_CODE_MAP = {
          'yellowstone':'yell',
          'yosemite':'yose',
          'grandcanyon':'grca',
          'zion':'zion',
          'acadia':'acad',
          'everglades':'ever',
          'rockymountain':'romo'
        };
        // prefer explicit mapping when available
        const mapped = PARK_CODE_MAP[park.id];
        if (mapped){
          try{
            const rmap = await fetch(`/api/nps/alerts?parkCode=${encodeURIComponent(mapped)}&limit=50`);
            if (rmap.ok){ const jm = await rmap.json(); const dm = jm && jm.data; if (Array.isArray(dm) && dm.length) return dm; }
          }catch(e){ /* continue to other fallbacks */ }
        }

        // Try common parkCode/id fields
        const tryCodes = [];
        if (park.parkCode) tryCodes.push(park.parkCode);
        if (park.id) tryCodes.push(park.id);
        // de-dupe
        const seen = new Set();
        for (const c of tryCodes){ if(!c) continue; if(seen.has(c)) continue; seen.add(c);
          try{
            const res = await fetch(`/api/nps/alerts?parkCode=${encodeURIComponent(c)}&limit=50`);
            if (res.ok){ const j = await res.json(); const arr = j && j.data; if (Array.isArray(arr) && arr.length) return arr; }
          }catch(e){ /* ignore and continue */ }
        }

        // fallback: search NPS parks by name and pick the nearest (if coordinates available)
        if (park.name){
          try{
            const res2 = await fetch(`/api/nps/parks?q=${encodeURIComponent(park.name)}&limit=5`);
            if (!res2.ok) return [];
            const j2 = await res2.json();
            const arr = j2 && j2.data;
            if (Array.isArray(arr) && arr.length){
              const parseNum = s => { const v = parseFloat(s); return isFinite(v) ? v : null };
              const lat0 = parseNum(park.latitude || park.lat || (park.latLong && park.latLong.split(',')[0]));
              const lon0 = parseNum(park.longitude || park.lon || (park.latLong && park.latLong.split(',')[1]));
              let match = null;
              if (lat0 != null && lon0 != null){
                function haversine(aLat,aLon,bLat,bLon){
                  const R = 6371; const toRad = v => v*Math.PI/180;
                  const dLat = toRad(bLat-aLat); const dLon = toRad(bLon-aLon);
                  const la = toRad(aLat); const lb = toRad(bLat);
                  const t = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(la)*Math.cos(lb)*Math.sin(dLon/2)*Math.sin(dLon/2);
                  return 2*R*Math.atan2(Math.sqrt(t), Math.sqrt(1-t));
                }
                let best = Infinity;
                arr.forEach(it => {
                  const lat1 = parseNum(it.latitude || (it.latLong && it.latLong.split(',')[0]));
                  const lon1 = parseNum(it.longitude || (it.latLong && it.latLong.split(',')[1]));
                  if (lat1==null || lon1==null) return;
                  const d = haversine(lat0,lon0,lat1,lon1);
                  if (d < best){ best = d; match = it; }
                });
              }
              if (!match) match = arr.find(it => (it.fullName && it.fullName.toLowerCase().includes(park.name.toLowerCase())) || (it.name && it.name.toLowerCase().includes(park.name.toLowerCase())) ) || arr[0];
              if (match && match.parkCode){
                try{
                  const r3 = await fetch(`/api/nps/alerts?parkCode=${encodeURIComponent(match.parkCode)}&limit=50`);
                  if (r3.ok){ const j3 = await r3.json(); const a3 = j3 && j3.data; if (Array.isArray(a3)) return a3; }
                }catch(e){ /* ignore */ }
              }
            }
          }catch(e){ /* ignore */ }
        }
        return [];
      }catch(e){ return [] }
    }

    (async ()=>{
      try{
        const alerts = await fetchNpsAlerts(p);
        const list = document.getElementById('npsAlertsList');
        if (!list) return;
        list.innerHTML = '';
        if (!alerts || !alerts.length){ list.innerHTML = '<div style="opacity:.8">No current alerts.</div>'; return }
        alerts.forEach(a=>{
          const el = document.createElement('div'); el.style.marginBottom='.5rem';
          // apply yellow highlight to all alerts per request
          el.classList.add('alert-yellow');
          const h = document.createElement('div'); h.textContent = a.title || 'Alert'; h.style.fontWeight='700';
          const body = document.createElement('div'); body.innerHTML = (a.description || a.shortDescription || '').slice(0,800);
          const link = document.createElement('a'); link.href = a.url || '#'; link.textContent = a.url ? 'Read more' : ''; link.target = '_blank'; link.style.display='block'; link.style.marginTop='.25rem';
          el.appendChild(h); el.appendChild(body); if (a.url) el.appendChild(link); list.appendChild(el);
        });
      }catch(e){ /* ignore */ }
    })();

  
  // Prefer a park-specific challenge if present, otherwise fall back to activities-based mapping
  const challengeEl = document.getElementById('challengeContent');
  // set park image if available
  try{
    const imgEl = document.getElementById('parkImage');
    const creditEl = document.getElementById('heroCredit');
    const titleEl = document.getElementById('heroTitle');
    const subEl = document.getElementById('heroSub');
    if (titleEl) titleEl.textContent = p.name;
    if (subEl) subEl.textContent = `${p.state} • ${p.established || ''}`;
    if (imgEl){
      // prefer NPS-style array, otherwise p.image or p.photo
      const src = (p.images && p.images[0] && p.images[0].url) ? p.images[0].url : (p.image || p.photo || '');
      if (src){ imgEl.src = src; imgEl.alt = p.name + ' photo'; imgEl.dataset.real = '1'; }
      else { imgEl.src = '/assets/placeholder.svg'; imgEl.alt = 'No image'; imgEl.dataset.real = '0'; }
      imgEl.onerror = ()=>{ imgEl.src = '/assets/placeholder.svg'; imgEl.dataset.real = '0'; };
      imgEl.onclick = ()=>{ if (imgEl.dataset.real === '1') window.open(imgEl.src, '_blank'); };
      if (creditEl) { creditEl.style.display = 'none'; creditEl.textContent = ''; }
    }
  }catch(e){ /* ignore image errors */ }

  // try to fetch images from the NPS API via the server proxy when possible
  async function fetchNpsParkImages(park){
    try{
      // small manual mapping for demo ids -> official NPS parkCode to improve matching
      const PARK_CODE_MAP = {
        'yellowstone':'yell',
        'yosemite':'yose',
        'grandcanyon':'grca',
        'zion':'zion',
        'acadia':'acad',
        'everglades':'ever',
        'rockymountain':'romo'
      };
      const mapped = PARK_CODE_MAP[park.id];
      if (mapped){
        const rmap = await fetch(`/api/nps/parks?parkCode=${encodeURIComponent(mapped)}&limit=1`);
        if (rmap.ok){ const jm = await rmap.json(); const dm = jm && jm.data && jm.data[0]; if (dm && dm.images && dm.images.length) return { images: dm.images.map(it=>({url:it.url,credit:it.credit||it.title||''})) } }
      }
      // First try parkCode or id (some demo ids match parkCode)
      const parkCode = park.parkCode || park.id || null;
      if (parkCode){
        const res = await fetch(`/api/nps/parks?parkCode=${encodeURIComponent(parkCode)}&limit=1`);
        if (res.ok){
          const j = await res.json();
          const data = j && j.data && j.data[0];
          if (data && data.images && data.images.length) return { images: data.images.map(it=>({url:it.url,credit:it.credit||it.title||''})) };
        }
      }
      // fallback: search by park name using q param
      if (park.name){
        const res2 = await fetch(`/api/nps/parks?q=${encodeURIComponent(park.name)}&limit=5`);
  if (!res2.ok) return null;
  const j2 = await res2.json();
  const arr = j2 && j2.data;
  if (Array.isArray(arr) && arr.length){
            // if we have coordinates for our local park, pick the NPS result nearest by lat/lon
            const parseNum = s => { const v = parseFloat(s); return isFinite(v) ? v : null };
            const lat0 = parseNum(park.latitude || park.lat || (park.latLong && park.latLong.split(',')[0]));
            const lon0 = parseNum(park.longitude || park.lon || (park.latLong && park.latLong.split(',')[1]));
            let match = null;
            if (lat0 != null && lon0 != null){
              function haversine(aLat,aLon,bLat,bLon){
                const R = 6371; const toRad = v => v*Math.PI/180;
                const dLat = toRad(bLat-aLat); const dLon = toRad(bLon-aLon);
                const la = toRad(aLat); const lb = toRad(bLat);
                const t = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(la)*Math.cos(lb)*Math.sin(dLon/2)*Math.sin(dLon/2);
                return 2*R*Math.atan2(Math.sqrt(t), Math.sqrt(1-t));
              }
              let best = Infinity;
              arr.forEach(it => {
                const lat1 = parseNum(it.latitude || (it.latLong && it.latLong.split(',')[0]));
                const lon1 = parseNum(it.longitude || (it.latLong && it.latLong.split(',')[1]));
                if (lat1==null || lon1==null) return;
                const d = haversine(lat0,lon0,lat1,lon1);
                if (d < best){ best = d; match = it; }
              });
            }
            // fallback to simple name match or first item
            if (!match) match = arr.find(it => (it.fullName && it.fullName.toLowerCase().includes(park.name.toLowerCase())) || (it.name && it.name.toLowerCase().includes(park.name.toLowerCase())) ) || arr[0];
            if (match && match.images && match.images.length) return { images: match.images.map(it=>({url:it.url,credit:it.credit||it.title||''})) };
          }
      }
      return null;
    }catch(e){ return null }
  }

  // fetch and apply NPS images asynchronously (do not block UI)
  (async ()=>{
    try{
      const npsImg = await fetchNpsParkImages(p);
      const imgEl = document.getElementById('parkImage');
      const creditEl = document.getElementById('heroCredit');
      if (npsImg && Array.isArray(npsImg.images) && npsImg.images.length){
        parkImages = npsImg.images;
        imgEl.src = parkImages[0].url; imgEl.dataset.real = '1'; imgEl.alt = p.name + ' photo';
        if (creditEl && parkImages[0].credit){ creditEl.textContent = parkImages[0].credit; creditEl.style.display = 'block'; }
      }
    }catch(e){ /* ignore */ }
  })();

  // start tailored ambient sound for this park only if enabled for this park
  try{
    // Do not auto-start ambient audio when opening a park detail. Stop any playing ambient instead.
    try{ _audioEngine.stop(); }catch(e){}
  }catch(e){ console.warn('audio preset error', e); _audioEngine.stop(); }
  if (p && p.challenge) {
    const c = p.challenge;
    if (challengeEl) challengeEl.textContent = (c.title || '') + ' — ' + (c.description || '');
    _currentPackingActivity = `park-challenge:${p.id}`;
    renderPacking(_currentPackingActivity, Array.isArray(c.packing) ? c.packing : []);
  } else {
    const acts = (window && window._activities) ? window._activities : null;
    if (acts && Array.isArray(acts) && acts.length) {
      const key = (p.id || p.name || '');
      let h = 0; for (let i = 0; i < key.length; i++) { h = ((h << 5) - h) + key.charCodeAt(i); h |= 0; }
      const day = new Date().getDate();
      const idx = Math.abs(h + day) % acts.length;
      const chosen = acts[idx];
      if (challengeEl) challengeEl.textContent = chosen.title + ' — ' + (chosen.description || '');
      _currentPackingActivity = chosen.id || `challenge-${idx}-${key}`;
      renderPacking(_currentPackingActivity, chosen.packing || []);
    } else {
      if (challengeEl) challengeEl.textContent = 'No challenge available.';
      _currentPackingActivity = p.id || `park-${p.name}`;
      renderPacking(_currentPackingActivity, []);
    }
  }

  // initialize goals checklist for this park
  const goalsKey = (id)=> `visitGoals:${id}`;
  function loadGoals(parkId){ try{ return JSON.parse(localStorage.getItem(goalsKey(parkId)) || 'null'); }catch(e){ return null } }
  function saveGoals(parkId,obj){ localStorage.setItem(goalsKey(parkId), JSON.stringify(obj)); }

  const visitBarEl = document.getElementById('visitBar');
  const visitCountEl = document.getElementById('visitCount');
  const visitTotalEl = document.getElementById('visitTotal');
  const visitListEl = document.getElementById('visitGoalsList');

  function defaultGoalsForPark(p){
    // Always return 4 tailored goals: 1 default (or challenge), and 3 varied per-park items
    const goals = [];
    if (p.challenge && p.challenge.title) goals.push(p.challenge.title);
    else goals.push('Visit the main viewpoint');

    const key = String((p.id || p.parkCode || p.name || '')).toLowerCase();
    const PARK_GOALS = {
      'yellowstone': ['See Old Faithful', 'Visit a thermal area (Mammoth/Norris)', 'Look for bison or elk', 'Walk a short boardwalk trail'],
      'yosemite': ['See Yosemite Valley (Tunnel View/Glacier Point)', 'Photograph El Capitan or Half Dome', 'Visit a waterfall viewpoint', 'Take a short valley trail'],
      'grandcanyon': ['View the main rim viewpoint', 'Walk part of the Rim Trail', 'Watch sunrise or sunset at a viewpoint', 'Visit a visitor center'],
      'zion': ['Hike a scenic trail (e.g. Emerald Pools)', 'Drive the scenic canyon road', 'See a main overlook', 'Try a short slot canyon viewpoint'],
      'acadia': ['Drive or bike the Park Loop Road', 'Watch sunrise at Cadillac Mountain', 'Visit a coastal viewpoint', 'Walk a seaside trail'],
      'everglades': ['Walk a boardwalk or tram tour', 'Look for wading birds and alligators', 'Visit a visitor center', 'Explore a short mangrove trail'],
      'rockymountain': ['Drive Trail Ridge Road (if open)', 'Spot elk in the meadows', 'Hike a short alpine trail', 'Visit a mountain viewpoint']
    };

    // If we have an explicit PARK_GOALS entry, use it but ensure positions 2-4 vary deterministically
    function hashStr(s){ let h=0; for(let i=0;i<s.length;i++){ h = ((h<<5)-h) + s.charCodeAt(i); h |= 0; } return Math.abs(h); }
    const seed = hashStr(key || (p.name||''));

    if (PARK_GOALS && Object.keys(PARK_GOALS).some(k=> key.includes(k))){
      const matchedKey = Object.keys(PARK_GOALS).find(k=> key.includes(k));
      const preset = PARK_GOALS[matchedKey].slice(0,4);
      // ensure we always return 4 items; if preset has fewer, fill from candidates
      while (preset.length < 4) preset.push('Explore a short trail or viewpoint');
      // use goal 1 from earlier (challenge or default), then use items 2-4 from preset (skip duplicates)
      const rest = preset.filter(it=> !goals.includes(it));
      for (let i=0;i<3;i++){ if (rest[i]) goals.push(rest[i]); else goals.push('Explore a short trail or viewpoint'); }
      return goals.slice(0,4);
    }

    // Candidate pools for varied second thru fourth goals
    const wildlife = ['Look for local wildlife', 'Watch for birds at a viewpoint', 'Find signs of large mammals'];
    const trails = ['Try a short trail or lookout', 'Walk a scenic loop trail', 'Visit a popular short hike'];
    const visitor = ['Visit a visitor center', 'Attend a ranger talk (if available)', 'Check out the park museum or exhibits'];
    const water = ['Visit a water viewpoint (falls, river, coast)', 'Try a short lakeside or river walk', 'Explore a boardwalk over wetlands'];
    const photo = ['Take at least one photo', 'Find a sunrise or sunset viewpoint', 'Capture a scenic panorama'];

    // assemble candidates based on keywords
    let candidates = [];
    if (key.includes('beach')||key.includes('coast')||key.includes('island')) candidates = candidates.concat(water, photo, trails);
    else if (key.includes('canyon')||key.includes('gorge')||key.includes('rim')) candidates = candidates.concat(photo, trails, visitor);
    else if (key.includes('mount')||key.includes('peak')||key.includes('glacier')||key.includes('range')) candidates = candidates.concat(trails, wildlife, photo);
    else if (key.includes('swamp')||key.includes('ever')||key.includes('marsh')) candidates = candidates.concat(water, wildlife, visitor);
    else candidates = candidates.concat(trails, wildlife, photo, visitor);

    // pick three distinct items deterministically
    const picked = new Set();
    let idx = 0;
    while (picked.size < 3 && idx < 20){
      const sel = candidates[(seed + idx) % candidates.length];
      if (!goals.includes(sel) && !picked.has(sel)) picked.add(sel);
      idx++;
    }
    // fill remaining with sensible defaults if needed
    const pickedArr = Array.from(picked);
    while (goals.length < 4) goals.push(pickedArr.shift() || 'Try a short trail or lookout');
    return goals.slice(0,4);
  }

  function renderGoals(){
    const key = p.id || p.name || ('park-'+p.name);
    let state = loadGoals(key);
    if (!state){
      const goals = defaultGoalsForPark(p);
      state = { goals: goals.map(g=>({text:g,done:false})) };
      saveGoals(key,state);
    }
    const items = state.goals || [];
    visitListEl.innerHTML = '';

    // container for adding a new goal
    const addRow = document.createElement('div'); addRow.style.display='flex'; addRow.style.gap='0.4rem'; addRow.style.marginBottom='0.6rem';
    const addInput = document.createElement('input'); addInput.type='text'; addInput.placeholder='Add a goal...'; addInput.style.flex='1'; addInput.id = 'addGoalInput';
    const addBtn = document.createElement('button'); addBtn.textContent = 'Add goal'; addBtn.style.flex='0'; addBtn.addEventListener('click', ()=>{
      const txt = (addInput.value||'').trim(); if(!txt) return; items.push({text:txt,done:false}); saveGoals(key,{goals:items}); addInput.value=''; renderGoals();
    });
    addRow.appendChild(addInput); addRow.appendChild(addBtn);
    visitListEl.appendChild(addRow);

    items.forEach((it, idx)=>{
      const li = document.createElement('li'); li.style.marginBottom='0.35rem'; li.style.display='flex'; li.style.alignItems='center';
      const chk = document.createElement('input'); chk.type='checkbox'; chk.checked = !!it.done; chk.style.marginRight='0.5rem';
      chk.addEventListener('change', ()=>{
        items[idx].done = chk.checked;
        if (chk.checked) items[idx].doneAt = Date.now(); else delete items[idx].doneAt;
        saveGoals(key,{goals:items});
        updateProgress();
        renderGoals();
      });
      const span = document.createElement('span'); span.textContent = it.text; span.style.color='inherit'; span.style.flex='1'; span.style.cursor='pointer';
      const del = document.createElement('button'); del.textContent = 'Delete'; del.className = 'goal-delete'; del.style.marginLeft='0.6rem'; del.addEventListener('click', ()=>{ if(!confirm('Delete this goal?')) return; items.splice(idx,1); saveGoals(key,{goals:items}); renderGoals(); });
      // clicking the goal updates the single preview image
      span.addEventListener('click', ()=>{
        const preview = document.getElementById('goalPreview');
        if (!preview) return;
        if (parkImages && parkImages.length){ preview.src = parkImages[idx % parkImages.length].url; preview.style.display = 'block'; }
        else { preview.src = '/assets/placeholder.svg'; preview.style.display = 'block'; }
      });
      li.appendChild(chk); li.appendChild(span); li.appendChild(del); visitListEl.appendChild(li);
    });
    updateProgress();
  }

  function updateProgress(){
    const key = p.id || p.name || ('park-'+p.name);
    const state = loadGoals(key) || {goals:[]};
    const total = (state.goals||[]).length || 0;
    const done = (state.goals||[]).filter(g=>g.done).length || 0;
    if (visitCountEl) visitCountEl.textContent = String(done);
    if (visitTotalEl) visitTotalEl.textContent = String(total);
    const pct = total>0 ? Math.round((done/total)*100) : 0;
    if (visitBarEl) visitBarEl.style.width = pct + '%';
  }

  // download goals as human-readable text
  const _downloadGoalsBtn = document.getElementById('downloadGoals');
  if (_downloadGoalsBtn) _downloadGoalsBtn.addEventListener('click', async ()=>{
    const key = p.id || p.name || ('park-'+p.name);
    const state = loadGoals(key) || {goals:[]};
    try{
      const lines = [];
      lines.push(`Goals for ${p.name} (${key})`);
      lines.push('');
      (state.goals || []).forEach(g => {
        lines.push((g.done ? '[x] ' : '[ ] ') + g.text);
      });
      const content = lines.join('\n');
      const res = await fetch('/api/save-file', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ filename: `${key}-goals.txt`, content }) });
      const j = await res.json().catch(()=>null);
      if (j && j.ok) alert('Saved to Downloads: ' + j.path);
      else alert('Save failed');
    }catch(e){ alert('Save failed: '+String(e)) }
  });

  // download a combined report (park info, goals, packing)
  const _downloadReportBtn = document.getElementById('downloadReport');
  if (_downloadReportBtn) _downloadReportBtn.addEventListener('click', async ()=>{
    const key = p.id || p.name || ('park-'+p.name);
    const state = loadGoals(key) || {goals:[]};
    const total = (state.goals||[]).length || 0;
    const done = (state.goals||[]).filter(g=>g.done).length || 0;
    const pct = total>0 ? Math.round((done/total)*100) : 0;
    // build a simple ASCII progress bar of width 30
    const width = 30;
    const filled = Math.round((pct/100)*width);
    const bar = '[' + '#'.repeat(filled) + '-'.repeat(Math.max(0, width-filled)) + `] ${pct}%`;
    // choose a positive message
    let msg = '';
    if (pct === 100) msg = 'Amazing — you completed all your goals! Time to celebrate your adventure 🎉';
    else if (pct >= 75) msg = 'Great work — you\'re nearly there! Keep going for the finish.';
    else if (pct >= 40) msg = 'Nice progress — you\'re making steady progress on your park goals.';
    else if (pct > 0) msg = 'Good start — every step counts. Add one more hike or photo today!';
    else msg = 'You haven\'t started yet — plan a short trail and begin your adventure!';

    const lines = [];
    lines.push(`Visit progress for ${p.name} (${key})`);
    lines.push('');
    lines.push(bar);
    lines.push('');
    lines.push(msg);
    lines.push('');
    lines.push(`Generated: ${new Date().toLocaleString()}`);

    try{
      const content = lines.join('\n');
      const res = await fetch('/api/save-file', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ filename: `${key}-report.txt`, content }) });
      const j = await res.json().catch(()=>null);
      if (j && j.ok) alert('Saved report to Downloads: ' + j.path);
      else alert('Save failed');
    }catch(e){ alert('Save failed: '+String(e)) }
  });

  // reset visit goals for this park
  const _resetVisitsBtn = document.getElementById('resetVisits');
  if (_resetVisitsBtn) _resetVisitsBtn.addEventListener('click', ()=>{
    const key = p.id || p.name || ('park-'+p.name);
    if (!confirm('Reset visit goals for this park?')) return;
    const defaults = defaultGoalsForPark(p).map(g=>({text:g,done:false}));
    saveGoals(key,{goals:defaults});
    renderGoals();
  });

  renderGoals();

  // map removed
  // show amenities map for this park (Leaflet + Overpass)
  try{ showAmenitiesForPark(p); }catch(e){ console.warn('amenities error',e) }
}

function icsEscape(s){
  if (s === null || s === undefined) return '';
  let out = String(s);
  // escape backslashes first
  out = out.replace(/\\/g, '\\\\');
  // replace actual newlines with the literal two-character sequence \n (per ICS escaping)
  out = out.replace(/\r\n|\r|\n/g, '\\n');
  // escape commas and semicolons
  out = out.replace(/([,;])/g, '\\$1');
  return out;
}
async function addToCalendar(p){
  // Try to fetch the official NPS fullName for better spelling/formatting. Prefer actual "National Park" designations
  let officialName = null;
  try{
    // small manual mapping for common/demo ids -> official NPS parkCode
    const PARK_CODE_MAP = {
      'yellowstone':'yell',
      'yosemite':'yose',
      'grandcanyon':'grca',
      'zion':'zion',
      'acadia':'acad',
      'everglades':'ever',
      'rockymountain':'romo'
    };
    // prefer an explicit parkCode when available; fallback to id
    let parkCode = p.parkCode || p.id || null;
    // strong special-case mappings: if the displayed name clearly indicates a well-known park, force that parkCode
    try{
      const pname = String(p.name || '').toLowerCase();
      const SPECIAL_NAME_MAP = { 'yellowstone':'yell', 'yellow stone':'yell', 'yosemite':'yose', 'grand canyon':'grca', 'zion':'zion', 'acadia':'acad', 'everglades':'ever', 'rocky mountain':'romo', 'rockymountain':'romo' };
      for (const key in SPECIAL_NAME_MAP){ if (pname.includes(key)) { parkCode = SPECIAL_NAME_MAP[key]; break; } }
      // if still unset, try substring match against PARK_CODE_MAP keys
      if (!parkCode && pname){
        for (const k in PARK_CODE_MAP){ if (pname.includes(k)) { parkCode = PARK_CODE_MAP[k]; break; } }
      }
    }catch(e){}
    // helper: haversine distance
    function haversine(aLat,aLon,bLat,bLon){ const R=6371; const toRad=v=>v*Math.PI/180; const dLat=toRad(bLat-aLat); const dLon=toRad(bLon-aLon); const la=toRad(aLat); const lb=toRad(bLat); const t=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(la)*Math.cos(lb)*Math.sin(dLon/2)*Math.sin(dLon/2); return 2*R*Math.atan2(Math.sqrt(t), Math.sqrt(1-t)); }

    if (parkCode){
      try{
        const res = await fetch(`/api/nps/parks?parkCode=${encodeURIComponent(parkCode)}&limit=1`);
        if (res.ok){ const j = await res.json(); const d = j && j.data && j.data[0]; if (d && d.fullName) officialName = d.fullName; }
      }catch(e){}
    }

    // If we still don't have an official match, search by name but prefer entries whose designation/fullName includes 'National Park'
    if (!officialName && p.name){
      try{
        const res2 = await fetch(`/api/nps/parks?q=${encodeURIComponent(p.name)}&limit=5`);
        if (res2.ok){
          const j2 = await res2.json(); const arr = j2 && j2.data ? j2.data : [];
          if (Array.isArray(arr) && arr.length){
            const norm = s => (s||'').toLowerCase();
            const isNatPark = c => {
              const des = norm(c.designation);
              const fn = norm(c.fullName);
              // only accept explicit 'national park' (exclude 'national historical park' etc.)
              if (des.includes('national park')) return true;
              if (fn.includes('national park')) return true;
              return false;
            };
            // prefer candidates that are explicitly National Parks
            let candidates = arr.slice();
            const filtered = candidates.filter(isNatPark);
            if (filtered.length) candidates = filtered;

            // if we have coordinates for the local park, pick the nearest candidate
            const parseNum = s=>{ const v=parseFloat(s); return isFinite(v)?v:null };
            const lat0 = parseNum(p.latitude || p.lat || (p.latLong && p.latLong.split(',')[0]));
            const lon0 = parseNum(p.longitude || p.lon || (p.latLong && p.latLong.split(',')[1]));
            let best = null;
            if (lat0 != null && lon0 != null){
              let bestDist = Infinity;
              candidates.forEach(c=>{
                const lat1 = parseNum(c.latitude || (c.latLong && c.latLong.split(',')[0]));
                const lon1 = parseNum(c.longitude || (c.latLong && c.latLong.split(',')[1]));
                if (lat1==null || lon1==null) return;
                const d = haversine(lat0,lon0,lat1,lon1);
                if (d < bestDist){ bestDist = d; best = c; }
              });
            }
            if (!best && candidates.length){
              // prefer a candidate whose fullName contains the local name
              best = candidates.find(c=> norm(c.fullName).includes(norm(p.name))) || candidates[0];
            }
            if (best && best.fullName) officialName = best.fullName;
          }
        }
      }catch(e){}
    }
  }catch(e){}

  // create a simple 1-hour event tomorrow at 9am local
  const start = new Date(); start.setDate(start.getDate()+1); start.setHours(9,0,0,0);
  const end = new Date(start.getTime()+60*60*1000);
  function toICSDate(d){ return d.toISOString().replace(/[-:]/g,'').split('.')[0]+'Z' }
  const nameForSummary = officialName || p.name || (p.id || 'Park visit');
  const summary = `Visit ${nameForSummary}`;
  const description = p.description || '';
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//demo//NPS Planner//EN',
    'BEGIN:VEVENT',
    `UID:${Date.now()}@nps-demo`,
    `DTSTAMP:${toICSDate(new Date())}`,
    `DTSTART:${toICSDate(start)}`,
    `DTEND:${toICSDate(end)}`,
    `SUMMARY:${icsEscape(summary)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  const blob = new Blob([ics], {type:'text/calendar;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const fileBase = (officialName || p.id || p.name || 'event').replace(/[\s/\\:]/g,'_').toLowerCase();
  const a = document.createElement('a'); a.href = url; a.download = `${fileBase}.ics`; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// Visit tracking helpers
function visitKey(parkId){ return `visits:${parkId}` }
function loadVisit(parkId){ try{ return JSON.parse(localStorage.getItem(visitKey(parkId))||'{"count":0,"goal":1}') }catch(e){ return {count:0,goal:1} } }
function saveVisit(parkId,obj){ localStorage.setItem(visitKey(parkId), JSON.stringify(obj)) }

(async ()=>{
  let parks = await fetchParks();
  // keep parks available globally so UI can refresh when favorites change
  try{ window._parks = parks }catch(e){}
  renderList(parks);
  const search = document.getElementById('search');
  const useNps = document.getElementById('useNps');

  // favorites management
  function getFavorites(){
    try{ return JSON.parse(localStorage.getItem('favorites') || '[]') }catch(e){return []}
  }
  function saveFavorites(list){ localStorage.setItem('favorites', JSON.stringify(list)); renderFavorites(); try{ renderList(window._parks || parks) }catch(e){} }
  function toggleFavorite(p){
  const favs = getFavorites();
  const exists = favs.find(f=>f.id===p.id);
  if (exists) { const next = favs.filter(f=>f.id!==p.id); saveFavorites(next); return false }
  else { saveFavorites([...favs,p]); return true }
  }
  function renderFavorites(){
    const ul = document.getElementById('favorites'); if(!ul) return; ul.innerHTML='';
    getFavorites().forEach(p=>{
      const li = document.createElement('li');
      li.style.display = 'flex'; li.style.alignItems = 'center'; li.style.justifyContent = 'space-between';
      const txt = document.createElement('span'); txt.textContent = `${p.name} — ${p.state}`; txt.style.cursor = 'pointer'; txt.addEventListener('click', ()=> showDetail(p));
      const btn = document.createElement('button'); btn.textContent = '★'; btn.title = 'Remove favorite'; btn.style.background='transparent'; btn.style.border=0; btn.style.color='#f59e0b'; btn.addEventListener('click', ()=> { toggleFavorite(p); });
      li.appendChild(txt); li.appendChild(btn); ul.appendChild(li);
    });
  // productivity chart removed
  }
  renderFavorites();

  // expose favorites helpers to global scope so renderList (top-level) can call them
  try{ window.toggleFavorite = toggleFavorite; window.getFavorites = getFavorites; window.saveFavorites = saveFavorites; window.renderFavorites = renderFavorites }catch(e){}

  let searchTimeout;
  
  if (search) search.addEventListener('input', ()=>{
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async ()=>{
      const q = (search && search.value) ? search.value.trim() : '';
      if (!q) { renderList(parks); return }
      if (useNps && useNps.checked) {
        try{
          const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
          if(res.ok){ const data = await res.json(); renderList(data); return }
        }catch(e){ /* fallthrough */ }
      }
      const lower = q.toLowerCase();
      renderList(parks.filter(p => p.name.toLowerCase().includes(lower) || p.state.toLowerCase().includes(lower) || (p.description && p.description.toLowerCase().includes(lower))));
    }, 300);
  });
})();

// Live NPS status check
async function checkNpsStatus(){
  const el = document.getElementById('npsStatus');
  if (!el) return false;
  try{
    const res = await fetch('/api/api_key');
    // handle non-JSON or non-OK responses gracefully
    if (!res.ok) {
      const text = await res.text().catch(()=>null);
      el.textContent = `Live API: unreachable`;
      el.style.background = '#fecaca'; el.style.color = '#7f1d1d';
      const useNpsEl = document.getElementById('useNps'); if (useNpsEl) useNpsEl.checked = false;
      return false;
    }
    let json = null;
    try{ json = await res.json(); }catch(e){ json = null }
    const useNpsEl = document.getElementById('useNps');
    if (json && json.ok) {
      el.textContent = 'Live API: OK'; el.style.background='#bbf7d0'; el.style.color='#065f46';
      if (useNpsEl) useNpsEl.checked = true; // enable live API toggle when server confirms key works
      return true;
    } else {
      el.textContent = `Live API: ${json && json.reason? json.reason : 'error'}`; el.style.background='#fecaca'; el.style.color='#7f1d1d';
      if (useNpsEl) useNpsEl.checked = false;
      return false;
    }
  }catch(e){ el.textContent = 'Live API: unreachable'; el.style.background='#fecaca'; el.style.color='#7f1d1d'; return false }
}
const _checkNpsBtn = document.getElementById('checkNps');
if (_checkNpsBtn) _checkNpsBtn.addEventListener('click', checkNpsStatus);
// optional: check on load
setTimeout(checkNpsStatus, 800);


// fetch activities and show a daily challenge
;(async function(){
  try{
    const res = await fetch('/api/activities');
    if(!res.ok) throw new Error('no activities');
    const acts = await res.json();
    if(acts && acts.length){
      const idx = new Date().getDate() % acts.length;
      const chosen = acts[idx];
      const challengeEl = document.getElementById('challengeContent');
      if (challengeEl) challengeEl.textContent = chosen.title + ' — ' + chosen.description;
      // set current activity for packing and render interactive checklist (persisted in localStorage)
      _currentPackingActivity = chosen.id || `challenge-${idx}`;
      renderPacking(_currentPackingActivity, chosen.packing || []);
    }
  }catch(e){ const challengeEl = document.getElementById('challengeContent'); if (challengeEl) challengeEl.textContent = 'No challenge available.' }
})();

// Packing checklist logic
function packingKey(activityId){ return `packing:${activityId}` }
function loadPacking(activityId){ try{ return JSON.parse(localStorage.getItem(packingKey(activityId))||'[]') }catch(e){ return [] } }
function savePacking(activityId, list){ localStorage.setItem(packingKey(activityId), JSON.stringify(list)); }
function renderPacking(activityId, defaults){
  const ul = document.getElementById('packingList'); if(!ul) return;
  ul.innerHTML='';
  const items = loadPacking(activityId);
  // if empty, seed with defaults
  if(items.length===0 && Array.isArray(defaults) && defaults.length){
    defaults.forEach(it=> items.push({text:it,done:false}));
    savePacking(activityId, items);
  }
  items.forEach((it, idx)=>{
    const li = document.createElement('li');
    const chk = document.createElement('input'); chk.type='checkbox'; chk.checked = !!it.done; chk.addEventListener('change', ()=>{ items[idx].done = chk.checked; savePacking(activityId, items); renderPacking(activityId, defaults); });
    const span = document.createElement('span'); span.textContent = ' ' + it.text; span.style.marginLeft='0.5rem';
  const del = document.createElement('button'); del.textContent='Delete'; del.className = 'packing-delete'; del.style.marginLeft='0.5rem'; del.addEventListener('click', ()=>{ items.splice(idx,1); savePacking(activityId, items); renderPacking(activityId, defaults); });
    li.appendChild(chk); li.appendChild(span); li.appendChild(del); ul.appendChild(li);
  });
}

const _addPackingBtn = document.getElementById('addPacking');
if (_addPackingBtn) _addPackingBtn.addEventListener('click', ()=>{
  const input = document.getElementById('packingInput'); const text = input && input.value.trim(); if(!text) return; const actId = currentActivityIdForPacking(); if(!actId) return alert('Select an activity or challenge first');
  const items = loadPacking(actId); items.push({text,done:false}); savePacking(actId, items); if (input) input.value=''; renderPacking(actId, []);
});
// support Enter key in packing input
const _packingInput = document.getElementById('packingInput');
if (_packingInput) _packingInput.addEventListener('keydown', (e)=>{
  if (e.key === 'Enter') { e.preventDefault(); const btn = document.getElementById('addPacking'); if (btn) btn.click(); }
});
const _clearPackingBtn = document.getElementById('clearPacking');
if (_clearPackingBtn) _clearPackingBtn.addEventListener('click', ()=>{
  const actId = currentActivityIdForPacking(); if(!actId) return alert('Select an activity first'); localStorage.removeItem(packingKey(actId)); renderPacking(actId, []);
});

// Download packing checklist (server-side save)
const _downloadPackingBtn = document.getElementById('downloadPacking');
if (_downloadPackingBtn) _downloadPackingBtn.addEventListener('click', async ()=>{
  const actId = currentActivityIdForPacking(); if(!actId) return alert('Select an activity first');
  const items = loadPacking(actId);
  try{
    // create a human-readable text version and save to the user's Downloads folder on the server
    const lines = [];
    // derive a friendly base name for the activity
    let friendly = actId;
    try{
      // if the current detail has a heroTitle, prefer that
      const hero = document.getElementById('heroTitle');
      if (hero && hero.textContent && hero.textContent.trim()) friendly = hero.textContent.trim();
      else if (actId && actId.startsWith('park-')) friendly = actId.replace(/^park-/, '');
      else if (actId && actId.startsWith('park-challenge:')) friendly = actId.split(':')[1] || actId;
    }catch(e){}
    const titleLine = `${friendly} Packing Checklist`;
    lines.push(titleLine);
    lines.push('');
    items.forEach(it => {
      lines.push((it.done ? '[x] ' : '[ ] ') + it.text);
    });
    const content = lines.join('\n');
    // sanitize filename
    const fileBase = titleLine.replace(/[\s/\\:]/g,'_').toLowerCase();
    const res = await fetch('/api/save-file', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ filename: `${fileBase}.txt`, content }) });
    const j = await res.json().catch(()=>null);
    if (j && j.ok) alert('Saved to Downloads: ' + j.path);
    else alert('Save failed');
  }catch(e){ alert('Save failed: '+String(e)) }
});

// track which activity is currently shown in packing (use challenge id)
let _currentPackingActivity = null;
function currentActivityIdForPacking(){ return _currentPackingActivity }

// when challenge loads, set current packing to that activity id
(function watchChallengeSelection(){
  // when challenge is set by the activities loader above, it sets packingList; we'll capture that by overriding that block is not trivial, so we also set current when showing detail using activity id fallback
})();

// ------------------ Leaflet + Overpass helpers ------------------
let _leafletMap = null;
let _amenityLayer = null;
let _npsFacilityLayer = null;
let _restroomLayer = null;
let _visitorCenterLayer = null;
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

function ensureMap(lat, lon){
  const detail = document.getElementById('detail'); if(!detail) return;
  let mapEl = document.getElementById('map');
  if(!mapEl){ mapEl = document.createElement('div'); mapEl.id = 'map'; detail.prepend(mapEl); }
  if(!_leafletMap){
    // If Leaflet isn't present, show message in the map container
    if (typeof L === 'undefined'){
      // Leaflet not loaded — show helpful message
      mapEl.innerHTML = '<div style="padding:1rem;color:#92400e;background:#fff7ed;border-radius:6px">Map library failed to load. Check your connection or CDN. If you are offline, install Leaflet locally.</div>';
      return;
    }
    try{
  // enable full map interactions (drag, scroll wheel, zoom)
  _leafletMap = L.map('map', { scrollWheelZoom:true, dragging:true }).setView([lat,lon], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19, attribution: '&copy; OpenStreetMap contributors' }).addTo(_leafletMap);
      _amenityLayer = L.layerGroup().addTo(_leafletMap);
      // Some browsers need a short delay before invalidateSize
      setTimeout(()=>{ try{ _leafletMap.invalidateSize(); }catch(e){} }, 100);
    }catch(e){ console.warn('Leaflet init failed',e); _leafletMap = null; mapEl.innerHTML = '<div style="padding:1rem;color:#92400e;background:#fff7ed;border-radius:6px">Map initialization failed.</div>'; }
  } else {
    // If the existing map's container has been removed/recreated (showDetail replaced it), recreate the Leaflet instance
    try{
      if (_leafletMap && _leafletMap._container && (_leafletMap._container.id !== 'map' || document.getElementById('map') !== _leafletMap._container)){
        try{ _leafletMap.remove(); }catch(e){}
        _leafletMap = null; _amenityLayer = null;
      }
    }catch(e){}
    if (!_leafletMap){
      // initialize fresh
      ensureMap(lat,lon);
    } else {
      _leafletMap.setView([lat,lon], 13);
      if(_amenityLayer) _amenityLayer.clearLayers();
    }
  }
}

// initialize global sound button behavior
// global header button was removed; per-park toggles still respect `isGlobalSoundEnabled()`

async function fetchAmenities(lat, lon, radius=1000){
  // default common amenities; caller may override by passing a preferences list
  const defaultAmenities = ['toilets','parking','drinking_water','picnic_table','viewpoint','camp_site','campground','information','shelter','bench'];
  const prefs = arguments[3] && Array.isArray(arguments[3]) ? arguments[3] : defaultAmenities;
  const amenityFilter = prefs.join('|');
  const query = `
    [out:json][timeout:25];
    (
      node["amenity"~"${amenityFilter}"](around:${radius},${lat},${lon});
      way["amenity"~"${amenityFilter}"](around:${radius},${lat},${lon});
      relation["amenity"~"${amenityFilter}"](around:${radius},${lat},${lon});
      node["tourism"~"${amenityFilter}"](around:${radius},${lat},${lon});
      way["tourism"~"${amenityFilter}"](around:${radius},${lat},${lon});
      node["leisure"~"${amenityFilter}"](around:${radius},${lat},${lon});
      way["leisure"~"${amenityFilter}"](around:${radius},${lat},${lon});
      node["shop"~"${amenityFilter}"](around:${radius},${lat},${lon});
    );
    out center;
  `;
  const res = await fetch(OVERPASS_URL, { method:'POST', body: query, headers:{'Content-Type':'text/plain'} });
  if(!res.ok) throw new Error('Overpass error '+res.status);
  const json = await res.json();
  return json.elements || [];
}

// returns a tailored list of amenity/tourism/leisure/shop tags for a given park
function amenityPreferencesForPark(park){
  const id = String(park.id||park.parkCode||park.name||'').toLowerCase();
  // base prefs
  let prefs = ['toilets','parking','drinking_water','picnic_table','viewpoint','camp_site','campground','information','shelter','bench'];
  if (id.includes('beach') || id.includes('coast') || id.includes('island') || id.includes('ever')){
    prefs = prefs.concat(['beach_resort','boat_rental','viewpoint','ferry']);
  }
  if (id.includes('mount')||id.includes('yosem')||id.includes('romo')||id.includes('glacier')){
    prefs = prefs.concat(['trailhead','viewpoint','camp_site','picnic_table','shelter']);
  }
  if (id.includes('yellow')||id.includes('geyser')||id.includes('volcano')){
    prefs = prefs.concat(['information','visitor_center','campground','parking']);
  }
  if (id.includes('zion')||id.includes('canyon')||id.includes('grandcanyon')){
    prefs = prefs.concat(['viewpoint','climbing','information','parking']);
  }
  // de-dup and limit size
  prefs = Array.from(new Set(prefs)).slice(0,40);
  return prefs;
}

function renderAmenitiesOnMap(elements){
  if(!_amenityLayer) return;
  _amenityLayer.clearLayers();
  if (!_restroomLayer) _restroomLayer = L.layerGroup().addTo(_leafletMap);
  if (!_visitorCenterLayer) _visitorCenterLayer = L.layerGroup().addTo(_leafletMap);
  _restroomLayer.clearLayers();
  _visitorCenterLayer.clearLayers();
  elements.forEach(el=>{
    let lat, lon;
    if(el.type === 'node'){ lat = el.lat; lon = el.lon; }
    else if(el.center){ lat = el.center.lat; lon = el.center.lon; }
    else if(el.lat && el.lon){ lat = el.lat; lon = el.lon; }
    else return;
    const name = (el.tags && (el.tags.name || el.tags.amenity)) || 'amenity';
    const type = (el.tags && el.tags.amenity) || 'amenity';
    const popup = `<strong>${name}</strong><br>${type}${el.tags && el.tags.access ? '<br>access: '+el.tags.access : ''}`;
    try{
      // use simple emoji/icon mapping for common types
      const ICON_MAP = { toilets:'🚻', parking:'🅿️', drinking_water:'💧', picnic_table:'🧺', viewpoint:'🔭', camp_site:'🏕️', campground:'🏕️', information:'ℹ️', shelter:'⛺', bench:'🪑' };
      const emoji = ICON_MAP[type] || '📍';
      const icon = L.divIcon({ className: 'amenity-icon', html: `<div style="font-size:20px;line-height:20px">${emoji}</div>`, iconSize:[24,24], iconAnchor:[12,12] });
      const m = L.marker([lat,lon], { icon }).bindPopup(popup);
      _amenityLayer.addLayer(m);
      // route to restroom or visitor center layers when applicable
      const tags = el.tags || {};
      const amen = (tags.amenity || '').toLowerCase();
      const tourism = (tags.tourism || '').toLowerCase();
      if (amen === 'toilets' || amen === 'restroom' || tags['toilets']){
        _restroomLayer.addLayer(L.marker([lat,lon], { icon: L.divIcon({ className:'restroom-icon', html:'🚻', iconSize:[20,20], iconAnchor:[10,10] }) }).bindPopup(popup));
      }
      if (tourism === 'information' || tourism === 'visitor_center' || amen === 'information'){
        _visitorCenterLayer.addLayer(L.marker([lat,lon], { icon: L.divIcon({ className:'visitor-icon', html:'🏛️', iconSize:[20,20], iconAnchor:[10,10] }) }).bindPopup(popup));
      }
    }catch(e){/* ignore marker errors */}
  });
  // no side legend — icons are visible directly on the map and map is fully interactive
}

// small in-map control for toggling restroom/visitor center layers and zoom-to-fit
function ensureAmenityLayerControls(){
  if (!_leafletMap) return;
  if (_leafletMap._amenityControls) return;
  const ctrl = L.control({ position: 'topright' });
  ctrl.onAdd = function(){
    const div = L.DomUtil.create('div', 'amenity-controls');
    div.style.background='rgba(255,255,255,0.95)'; div.style.padding='6px'; div.style.borderRadius='6px'; div.style.boxShadow='0 2px 6px rgba(2,6,23,0.08)';
    div.innerHTML = `<div style="font-weight:700;margin-bottom:6px">Map Layers</div>
      <label style="display:block"><input type="checkbox" id="ctl_restrooms" checked /> Restrooms</label>
      <label style="display:block"><input type="checkbox" id="ctl_visitors" checked /> Visitor info</label>
      <div style="margin-top:6px"><button id="ctl_zoom">Zoom to all</button></div>`;
    // prevent map clicks from propagating when interacting with controls
    L.DomEvent.disableClickPropagation(div);
    return div;
  };
  ctrl.addTo(_leafletMap);
  _leafletMap._amenityControls = ctrl;
  // wire up events
  setTimeout(()=>{
    const rcb = document.getElementById('ctl_restrooms');
    const vcb = document.getElementById('ctl_visitors');
    const zb = document.getElementById('ctl_zoom');
    if (rcb) rcb.addEventListener('change', ()=>{ if (rcb.checked) _restroomLayer.addTo(_leafletMap); else _leafletMap.removeLayer(_restroomLayer); });
    if (vcb) vcb.addEventListener('change', ()=>{ if (vcb.checked) _visitorCenterLayer.addTo(_leafletMap); else _leafletMap.removeLayer(_visitorCenterLayer); });
    if (zb) zb.addEventListener('click', ()=>{
      const bounds = L.featureGroup([_amenityLayer, _restroomLayer, _visitorCenterLayer, _npsFacilityLayer].filter(Boolean)).getBounds();
      if (bounds && bounds.isValid()) _leafletMap.fitBounds(bounds.pad(0.15));
    });
  }, 80);
}

// render NPS facilities (from /api/nps/parks/:id or /api/nps/facilities)
function renderNpsFacilitiesOnMap(facilities){
  if(!_leafletMap) return;
  if(!_npsFacilityLayer) _npsFacilityLayer = L.layerGroup().addTo(_leafletMap);
  _npsFacilityLayer.clearLayers();
  facilities.forEach(f=>{
    const lat = parseFloat(f.latitude || f.lat);
    const lon = parseFloat(f.longitude || f.lon);
    if (!isFinite(lat) || !isFinite(lon)) return;
    const title = f.name || f.title || f.facilityName || 'Facility';
    const type = (f.facilityType || f.type || '').toLowerCase() || (f.description && f.description.slice(0,80)) || '';
    const popup = `<strong>${title}</strong><br>${type}`;
    try{
      const ICON_MAP = { 'visitor center':'🏛️', 'campground':'🏕️', 'restroom':'🚻', 'trailhead':'🥾', 'parking':'🅿️', 'food service':'🍴' };
      const emoji = ICON_MAP[type] || '📍';
      const icon = L.divIcon({ className: 'nps-facility-icon', html: `<div style="font-size:18px;line-height:18px">${emoji}</div>`, iconSize:[22,22], iconAnchor:[11,11] });
      const m = L.marker([lat,lon], { icon }).bindPopup(popup);
      _npsFacilityLayer.addLayer(m);
    }catch(e){}
  });
}

// --- Simple playlist UI & player (HTMLAudioElement) ---
(function(){
  const STORAGE_KEY = 'playlist:v1';
  let playlist = [];
  let currentIndex = -1;
  const audio = new Audio(); audio.crossOrigin = 'anonymous';

  function baseNameNoExt(s){ try{ const p = String(s||'').split('/').pop(); return p.replace(/\.(mp3|wav|ogg|m4a|flac)$/i,''); }catch(e){ return String(s||''); } }

  function save(){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify({playlist, currentIndex})); }catch(e){} }
  function load(){ try{ const j = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); if (j && Array.isArray(j.playlist)) { playlist = j.playlist; currentIndex = typeof j.currentIndex === 'number' ? j.currentIndex : -1; } }catch(e){} }

  // enforce a preferred order for known tracks
  try{
    const order = ['CREEK','FEEL','SHEEP','SLEEP','GREEN','FEET','STREET','TEEVEE'];
  // map known display names to actual filenames in /assets
  const NAME_MAP = { 'FEET': 'FEET [1O58bqXvAsE].mp3' };
  // display overrides for certain tracks (strip bracketed suffixes or set custom titles)
  const DISPLAY_MAP = { 'FEET': 'FEET' };
    const desiredPaths = order.map(n=>{
      const fname = NAME_MAP[n] ? NAME_MAP[n] : (n + '.mp3');
      return encodeURI('/assets/' + fname);
    });
    // map existing playlist entries by url for reuse
    const existing = new Map(playlist.map(p=>[String(p.url||''), p]));
    const newList = [];
    desiredPaths.forEach(pth => {
      if (existing.has(pth)) newList.push(existing.get(pth));
      else {
        // compute a sensible title: if the desired path corresponds to a known display name use that override
        const base = baseNameNoExt(pth);
        const display = Object.keys(DISPLAY_MAP).find(k => (DISPLAY_MAP[k] && (base.toUpperCase().startsWith(k))) );
        const title = display ? DISPLAY_MAP[display] : base;
        newList.push({ url: pth, title });
      }
    });
    // append any other tracks that were in the previous playlist but aren't in the desired list
    playlist.forEach(p => { const u = String(p.url||''); if (!desiredPaths.includes(u)) newList.push(p); });
    playlist = newList;
    try{ save(); }catch(e){}
  }catch(e){}

  function render(){
    const ol = document.getElementById('playlist'); if(!ol) return;
    ol.innerHTML = '';
    playlist.forEach((t, idx)=>{
  const li = document.createElement('li');
  li.dataset.idx = String(idx);
  // highlight when this is the current index and audio is playing
  if (idx === currentIndex && !audio.paused && !audio.ended) li.classList.add('playing');
  const txt = document.createElement('span'); txt.textContent = t.title || t.url; txt.style.cursor='pointer'; txt.addEventListener('click', ()=> playIndex(idx));
  // remaining time span for this item (right-aligned via flex)
  const rem = document.createElement('span'); rem.className = 'item-remaining'; rem.textContent = '';
  li.appendChild(txt);
  li.appendChild(rem);
  ol.appendChild(li);
    });
    updateNowPlaying();
  }

  function formatTime(s){ if (!isFinite(s) || s===null) return '--:--'; const sec = Math.max(0, Math.floor(s)); const m = Math.floor(sec/60); const ss = String(sec%60).padStart(2,'0'); return `${m}:${ss}` }

  function updateNowPlaying(){
    const el = document.getElementById('nowPlaying'); if(!el) return;
    if(currentIndex>=0 && playlist[currentIndex]){
      const title = playlist[currentIndex].title || playlist[currentIndex].url;
      // show title only (per-item remaining is displayed next to the list item)
      el.innerHTML = 'Now playing: <span class="now-title"></span>';
      const s = el.querySelector('.now-title'); if (s) s.textContent = title;
    } else { el.textContent = 'Not playing'; }
  }

  function updateNowPlayingTime(){
    const d = audio.duration; const t = audio.currentTime;
    // if duration unknown, clear any per-item remaining
    if (!isFinite(d) || d<=0){
      try{ const curLi = document.querySelector('#playlist li.playing'); if(curLi){ const ir = curLi.querySelector('.item-remaining'); if(ir) ir.textContent = ''; } }catch(e){}
      return;
    }
    const left = Math.max(0, Math.ceil(d - t));
    // update the playing item's remaining display
    try{
      const curLi = document.querySelector('#playlist li.playing') || document.querySelector(`#playlist li[data-idx="${currentIndex}"]`);
      if (curLi){ const ir = curLi.querySelector('.item-remaining'); if(ir) ir.textContent = formatTime(left); }
    }catch(e){}
  }

  function playIndex(i){ if (!playlist[i]) return; currentIndex = i; audio.src = playlist[i].url; audio.play().catch(()=>{}); document.getElementById('plPlay').textContent = 'Pause'; save(); render(); }
  function stop(){ audio.pause(); audio.currentTime = 0; document.getElementById('plPlay').textContent = 'Play'; currentIndex = -1; save(); render(); }
  function togglePlay(){ if (!audio.src){ if (playlist.length) playIndex(0); return; } if (audio.paused) audio.play().catch(()=>{}); else audio.pause(); document.getElementById('plPlay').textContent = audio.paused ? 'Play' : 'Pause'; }
  function next(){ if (playlist.length===0) return; const nextIdx = (currentIndex+1) % playlist.length; playIndex(nextIdx); }
  function prev(){ if (playlist.length===0) return; const prevIdx = (currentIndex-1 + playlist.length) % playlist.length; playIndex(prevIdx); }

  // wire UI
  load(); document.addEventListener('DOMContentLoaded', ()=>{
    render();
  const plPlay = document.getElementById('plPlay'); const plNext = document.getElementById('plNext'); const plPrev = document.getElementById('plPrev');
    if (plPlay) plPlay.addEventListener('click', togglePlay);
    if (plNext) plNext.addEventListener('click', next);
    if (plPrev) plPrev.addEventListener('click', prev);
    audio.addEventListener('ended', ()=>{ // auto-advance
      if (playlist.length) next(); else { if (plPlay) plPlay.textContent = 'Play'; currentIndex=-1; save(); render(); }
    });
  audio.addEventListener('play', ()=>{ if (plPlay) plPlay.textContent = 'Pause'; updateNowPlaying(); render(); });
  audio.addEventListener('pause', ()=>{ if (plPlay) plPlay.textContent = 'Play'; updateNowPlaying(); render(); });
  audio.addEventListener('timeupdate', ()=>{ updateNowPlayingTime(); });
  audio.addEventListener('loadedmetadata', ()=>{ updateNowPlaying(); updateNowPlayingTime(); });
  });
})();

async function showAmenitiesForPark(p){
  const lat = parseFloat(p.latitude||p.lat||p.latLong&&p.latLong.split(',')[0]);
  const lon = parseFloat(p.longitude||p.lon||p.latLong&&p.latLong.split(',')[1]);
  if(!lat || !lon) return;
  ensureMap(lat,lon);
  const cacheKey = `amenities:${p.id||p.name}:${Math.round(lat*100000)}:${Math.round(lon*100000)}`;
  const cached = localStorage.getItem(cacheKey);
  if(cached){ try{ const els = JSON.parse(cached); renderAmenitiesOnMap(els); return; }catch(e){ /* ignore */ } }
  try{
    const prefs = amenityPreferencesForPark(p);
    const els = await fetchAmenities(lat,lon,1000, prefs);
  renderAmenitiesOnMap(els);
  try{ ensureAmenityLayerControls(); }catch(e){}
    try{ localStorage.setItem(cacheKey, JSON.stringify(els)); }catch(e){/* ignore storage full */}
    // also fetch NPS-managed facilities (if the proxy supports it)
    try{
      // prefer parkCode when available for more accurate results
      const parkCode = (p.parkCode || p.id || '').toLowerCase();
      if (parkCode){
        const r = await fetch(`/api/nps/facilities?parkCode=${encodeURIComponent(parkCode)}&limit=200`);
        if (r.ok){
          const j = await r.json().catch(()=>null);
          const facs = (j && j.data) || (Array.isArray(j) ? j : []);
          if (facs && facs.length) renderNpsFacilitiesOnMap(facs);
        }
      }
    }catch(e){ /* ignore NPS facility fetch errors */ }
  }catch(e){ console.warn('fetchAmenities failed', e); }
}

