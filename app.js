// --- Optional Supabase init (uncomment when configured in index.html) ---
// const sb = (window.SUPABASE_URL && window.SUPABASE_ANON_KEY)
//   ? supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
//   : null;

// --- Utilities ---
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

const STORAGE_KEYS = {
  CONFIGS: 'sc_configs',
  SUBMISSIONS: 'sc_submissions',
  DRAFT_CONFIG: 'sc_draft_config'
};

function loadStore(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function saveStore(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

function genCode(maxLen=10) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const len = Math.floor(6 + Math.random()*4); // 6-9 chars (<=10)
  let out = '';
  for (let i=0;i<len;i++) out += alphabet[Math.floor(Math.random()*alphabet.length)];
  return out.slice(0, maxLen);
}

function fileToDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// --- State ---
let draftConfig = loadStore(STORAGE_KEYS.DRAFT_CONFIG, {
  code: '',
  name: '',
  countries: [] // [{name, flagDataUrl}]
});

// --- UI wiring (mode switch) ---
const organisePanel = $('#organise');
const votePanel = $('#vote');
$('#btn-organise').onclick = () => {
  $('#btn-organise').classList.add('active');
  $('#btn-vote').classList.remove('active');
  organisePanel.classList.add('active');
  votePanel.classList.remove('active');
};
$('#btn-vote').onclick = () => {
  $('#btn-vote').classList.add('active');
  $('#btn-organise').classList.remove('active');
  votePanel.classList.add('active');
  organisePanel.classList.remove('active');
};

// --- Organise: render countries ---
const countriesList = $('#countries-list');
const tplCountry = $('#country-item-tpl');

function renderCountries() {
  countriesList.innerHTML = '';
  draftConfig.countries.forEach((c, idx) => {
    const node = tplCountry.content.firstElementChild.cloneNode(true);
    node.querySelector('.flag').src = c.flagDataUrl;
    node.querySelector('.name').textContent = c.name;
    node.querySelector('.remove').onclick = () => {
      draftConfig.countries.splice(idx, 1);
      saveStore(STORAGE_KEYS.DRAFT_CONFIG, draftConfig);
      renderCountries();
    };
    countriesList.appendChild(node);
  });
}

$('#comp-name').value = draftConfig.name || '';
renderCountries();

$('#add-country').onclick = async () => {
  const name = $('#country-name').value.trim();
  const file = $('#flag-file').files[0];
  if (!name || !file) { alert('Please provide both country name and flag.'); return; }
  const dataUrl = await fileToDataURL(file);
  draftConfig.countries.push({name, flagDataUrl: dataUrl});
  $('#country-name').value = '';
  $('#flag-file').value = '';
  saveStore(STORAGE_KEYS.DRAFT_CONFIG, draftConfig);
  renderCountries();
};

$('#comp-name').addEventListener('input', e => {
  draftConfig.name = e.target.value;
  saveStore(STORAGE_KEYS.DRAFT_CONFIG, draftConfig);
});

// Generate + save config under code
$('#generate-code').onclick = async () => {
  if (!draftConfig.name) { alert('Enter a competition name first.'); return; }
  if (draftConfig.countries.length < 10) {
    if (!confirm('Fewer than 10 countries added. Continue?')) return;
  }
  const code = genCode(10);
  draftConfig.code = code;

  // Local storage (default)
  const configs = loadStore(STORAGE_KEYS.CONFIGS, {});
  configs[code] = structuredClone(draftConfig);
  saveStore(STORAGE_KEYS.CONFIGS, configs);

  // Supabase upsert (optional)
  // if (sb) {
  //   const payload = { code, name: draftConfig.name, countries: draftConfig.countries };
  //   const { error } = await sb.from('competitions').upsert(payload);
  //   if (error) { alert('Supabase save failed: ' + error.message); }
  // }

  $('#share-code').textContent = code;
  history.replaceState(null, '', `#${code}`);
  alert('Code generated and saved.');
};

// Copy link with code
$('#copy-link').onclick = async () => {
  if (!draftConfig.code) { alert('Generate a code first.'); return; }
  const url = `${location.origin}${location.pathname}#${draftConfig.code}`;
  await navigator.clipboard.writeText(url);
  alert('Link copied.');
};

// Save draft config to local file
$('#save-config').onclick = () => {
  const blob = new Blob([JSON.stringify(draftConfig, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${draftConfig.name || 'competition'}.json`;
  a.click();
};

// Load config from file (replaces draft)
$('#load-config').onclick = () => $('#load-config-input').click();
$('#load-config-input').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const txt = await file.text();
    const cfg = JSON.parse(txt);
    if (!cfg.countries?.length) throw new Error('Invalid config file.');
    draftConfig = cfg;
    saveStore(STORAGE_KEYS.DRAFT_CONFIG, draftConfig);
    $('#comp-name').value = draftConfig.name || '';
    $('#share-code').textContent = draftConfig.code || '—';
    renderCountries();
    alert('Config loaded.');
  } catch (err) {
    alert('Failed to load config: ' + err.message);
  } finally {
    e.target.value = '';
  }
};

// Download stored config JSON by code
$('#download-config').onclick = () => {
  const code = draftConfig.code || $('#share-code').textContent || '';
  if (!code) { alert('Generate a code first.'); return; }
  const configs = loadStore(STORAGE_KEYS.CONFIGS, {});
  const cfg = configs[code] || draftConfig;
  const blob = new Blob([JSON.stringify(cfg, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${cfg.name || 'competition'}_${code}.json`;
  a.click();
};

// --- Submissions storage helpers (local) ---
function getSubmissionsMap() { return loadStore(STORAGE_KEYS.SUBMISSIONS, {}); }
function saveSubmission(code, submission) {
  const map = getSubmissionsMap();
  map[code] = map[code] || [];
  const idx = map[code].findIndex(s => s.fromCountry === submission.fromCountry && s.voteType === submission.voteType);
  if (idx >= 0) map[code][idx] = submission; else map[code].push(submission);
  saveStore(STORAGE_KEYS.SUBMISSIONS, map);
}
function loadSubmissions(code) { return getSubmissionsMap()[code] || []; }

// Import submission JSON (from voters)
$('#import-submission').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const txt = await file.text();
    const sub = JSON.parse(txt);
    if (!sub.code || !sub.fromCountry || !sub.voteType || !sub.points) throw new Error('Invalid submission.');
    if (sub.code !== draftConfig.code) {
      if (!confirm(`Submission code ${sub.code} differs from current code ${draftConfig.code}. Import anyway?`)) return;
    }
    saveSubmission(sub.code, sub);
    alert(`Imported ${sub.voteType} votes from ${sub.fromCountry}.`);
  } catch (err) {
    alert('Failed to import: ' + err.message);
  } finally {
    e.target.value = '';
  }
};

// Clear all submissions for current code
$('#clear-submissions').onclick = async () => {
  if (!draftConfig.code) { alert('No competition code yet.'); return; }

  // Local clear
  const map = getSubmissionsMap();
  delete map[draftConfig.code];
  saveStore(STORAGE_KEYS.SUBMISSIONS, map);

  // Optional Supabase delete
  // if (sb) {
  //   const { error } = await sb.from('submissions').delete().eq('code', draftConfig.code);
  //   if (error) alert('Supabase clear failed: ' + error.message);
  // }

  $('#results').innerHTML = '';
  alert('All submissions cleared for this competition.');
};

// Compute and show results (local or Supabase)
const tplResult = $('#result-line-tpl');

$('#compute-results').onclick = async () => {
  const code = draftConfig.code;
  if (!code) { alert('Generate a code first.'); return; }

  // Load config
  let cfg = null;
  const configs = loadStore(STORAGE_KEYS.CONFIGS, {});
  cfg = configs[code] || draftConfig;

  // Optional: fetch from Supabase
  // if (sb) {
  //   const { data, error } = await sb.from('competitions').select('*').eq('code', code).single();
  //   if (data) cfg = { code: data.code, name: data.name, countries: data.countries };
  //   if (error) alert('Supabase config fetch failed: ' + error.message);
  // }

  if (!cfg) { alert('Config not found.'); return; }

  // Load submissions
  let subs = loadSubmissions(code);

  // Optional: from Supabase
  // if (sb) {
  //   const { data, error } = await sb.from('submissions').select('*').eq('code', code);
  //   if (!error && data) {
  //     // Normalize to local shape
  //     subs = data.map(d => ({
  //       code: d.code,
  //       fromCountry: d.from_country,
  //       voteType: d.vote_type,
  //       points: d.points
  //     }));
  //   }
  // }

  const countries = cfg.countries.map(c => c.name);

  const totals = {};
  const juryTotals = {};
  const teleTotals = {};
  countries.forEach(n => { totals[n]=0; juryTotals[n]=0; teleTotals[n]=0; });

  const resultsBox = $('#results');
  resultsBox.innerHTML = '';

  function addLine(text, flagDataUrl) {
    const node = tplResult.content.firstElementChild.cloneNode(true);
    node.querySelector('.flag-bg').style.backgroundImage = `url(${flagDataUrl})`;
    node.querySelector('.text').textContent = text;
    resultsBox.appendChild(node);
  }

  const flagMap = Object.fromEntries(cfg.countries.map(c => [c.name, c.flagDataUrl]));

  for (const sub of subs) {
    const isJury = sub.voteType === 'jury';
    Object.entries(sub.points).forEach(([toCountry, pts]) => {
      totals[toCountry] = (totals[toCountry] ?? 0) + pts;
      if (isJury) juryTotals[toCountry]+=pts; else teleTotals[toCountry]+=pts;
      const line = `The country receiving ${pts} points from ${sub.fromCountry} is ${toCountry}.`;
      addLine(line, flagMap[toCountry] || '');
    });
  }

  const summary = document.createElement('div');
  summary.style.marginTop = '12px';
  summary.innerHTML = `
    <h3>Jury Totals</h3>
    ${countries.map(n=>`${n}: ${juryTotals[n]} pts`).join(' · ')}
    <h3>Televote Totals</h3>
    ${countries.map(n=>`${n}: ${teleTotals[n]} pts`).join(' · ')}
    <h3>Combined Totals</h3>
    ${countries.map(n=>`<b>${n}: ${totals[n]} pts</b>`).join(' · ')}
  `;
  resultsBox.appendChild(summary);
};

// --- Vote mode ---
const tplScoreRow = $('#score-row-tpl');
const scoreboard = $('#scoreboard');
let loadedVoteConfig = null;

function renderScoreboard(cfg) {
  scoreboard.innerHTML = '';
  cfg.countries.forEach(c => {
    const row = tplScoreRow.content.firstElementChild.cloneNode(true);
    row.querySelector('.flag').src = c.flagDataUrl;
    row.querySelector('.name').textContent = c.name;
    row.querySelector('.points').onchange = enforceUniquePoints;
    scoreboard.appendChild(row);
  });
}

function enforceUniquePoints() {
  const selects = $$('.points', scoreboard);
  const chosen = selects.map(s => s.value).filter(Boolean);
  selects.forEach(s => {
    for (const opt of s.options) {
      if (!opt.value) continue;
      opt.disabled = chosen.includes(opt.value) && s.value !== opt.value;
    }
  });
}

async function loadByCode(code) {
  // Local
  const configs = loadStore(STORAGE_KEYS.CONFIGS, {});
  const cfg = configs[code];

  // Optional Supabase
  // let data = null;
  // if (sb) {
  //   const res = await sb.from('competitions').select('*').eq('code', code).single();
  //   if (!res.error && res.data) data = res.data;
  // }
  // const cfgFromSb = data ? { code: data.code, name: data.name, countries: data.countries } : null;

  const finalCfg = cfg /*|| cfgFromSb*/;
  if (!finalCfg) { alert('Competition code not found on this device. The organiser must share the config file or host it.'); return; }
  loadedVoteConfig = finalCfg;
  renderScoreboard(finalCfg);
}

$('#load-by-code').onclick = () => {
  const code = $('#vote-code').value.trim().toUpperCase();
  if (!code) { alert('Enter a code.'); return; }
  loadByCode(code);
};

window.addEventListener('load', async () => {
  const hashCode = location.hash.replace('#','').trim().toUpperCase();
  if (hashCode) {
    $('#share-code').textContent = hashCode;

    // Local populate
    const configs = loadStore(STORAGE_KEYS.CONFIGS, {});
    if (configs[hashCode]) {
      draftConfig = configs[hashCode];
      $('#comp-name').value = draftConfig.name || '';
      renderCountries();
    }

    // Optional Supabase fetch into draft
    // if (sb) {
    //   const { data } = await sb.from('competitions').select('*').eq('code', hashCode).single();
    //   if (data) {
    //     draftConfig = { code: data.code, name: data.name, countries: data.countries };
    //     $('#comp-name').value = draftConfig.name || '';
    //     renderCountries();
    //   }
    // }
    $('#vote-code').value = hashCode;
  }
});

// Clear votes
$('#clear-scores').onclick = () => {
  $$('.points', scoreboard).forEach(s => s.value='');
  enforceUniquePoints();
};

// Submit votes -> download JSON + save locally
$('#submit-votes').onclick = async () => {
  const fromCountry = $('#voter-country').value.trim();
  if (!loadedVoteConfig) { alert('Load a competition by code first.'); return; }
  if (!fromCountry) { alert('Enter the voting country name.'); return; }
  const voteType = $('input[name="vote-type"]:checked').value;

  const required = ['12','10','8','7','6','5','4','3','2','1'];
  const selected = $$('.score-row').map(row => {
    const name = row.querySelector('.name').textContent;
    const val = row.querySelector('.points').value;
    return {name, val};
  }).filter(r => r.val);

  const picked = selected.map(s=>s.val);
  const missing = required.filter(x => !picked.includes(x));
  if (missing.length) { alert(`Missing these point values: ${missing.join(', ')}`); return; }

  if (selected.some(s => s.name.toLowerCase() === fromCountry.toLowerCase())) {
    if (!confirm('You are assigning points to your own country. Continue?')) return;
  }

  const pointsMap = {};
  selected.forEach(s => { pointsMap[s.name] = Number(s.val); });

  const submission = {
    code: loadedVoteConfig.code,
    fromCountry,
    voteType,
    points: pointsMap,
    timestamp: new Date().toISOString()
  };

  // Download JSON as transport
  const blob = new Blob([JSON.stringify(submission, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${fromCountry}_${voteType}_votes_${loadedVoteConfig.code}.json`;
  a.click();

  // Save locally so organiser on same device can aggregate
  saveSubmission(submission.code, submission);

  // Optional: Supabase insert
  // if (sb) {
  //   const payload = {
  //     code: submission.code,
  //     from_country: submission.fromCountry,
  //     vote_type: submission.voteType,
  //     points: submission.points
  //   };
  //   const { error } = await sb.from('submissions').insert(payload);
  //   if (error) alert('Supabase submit failed: ' + error.message);
  // }

  $('#submit-confirm').textContent = `Submitted ${voteType} votes from ${fromCountry}. A JSON file was downloaded — send it to the organiser.`;
};

// Keep draft config persisted
window.addEventListener('beforeunload', () => {
  saveStore(STORAGE_KEYS.DRAFT_CONFIG, draftConfig);
});


// ======================
// Presentation utilities
// ======================

function getCurrentConfigForPresentation() {
  const code = draftConfig?.code;
  if (!code) throw new Error('No competition code. Generate or load competition first.');
  const configs = loadStore(STORAGE_KEYS.CONFIGS, {});
  const cfg = configs[code] || draftConfig;
  if (!cfg?.countries?.length) throw new Error('No countries configured.');
  const subs = loadSubmissions(code);

  const televoteSubs = subs.filter(s => s.voteType === 'televote').sort((a,b)=>a.fromCountry.localeCompare(b.fromCountry));
  const jurySubs = subs.filter(s => s.voteType === 'jury').sort((a,b)=>a.fromCountry.localeCompare(b.fromCountry));

  const flagMap = Object.fromEntries(cfg.countries.map(c => [c.name, c.flagDataUrl]));
  const countryNames = cfg.countries.map(c => c.name);

  return { code, cfg, flagMap, countryNames, televoteSubs, jurySubs };
}

function aggregateTotals(countryNames, subs){
  const totals = Object.fromEntries(countryNames.map(n=>[n,0]));
  for(const sub of subs){
    for(const [toCountry, pts] of Object.entries(sub.points)){
      totals[toCountry] = (totals[toCountry] ?? 0) + pts;
    }
  }
  return totals;
}

function rankingRows(countryNames, flagMap, totals){
  return countryNames
    .map(n => ({ name:n, pts: totals[n] || 0 }))
    .sort((a,b)=> b.pts - a.pts || a.name.localeCompare(b.name))
    .map((row, idx) => ({
      pos: idx+1,
      name: row.name,
      pts: row.pts,
      flag: flagMap[row.name] || ''
    }));
}

// Build slide data
function buildPresentationSlides() {
  const { cfg, flagMap, countryNames, televoteSubs, jurySubs } = getCurrentConfigForPresentation();

  const televoteTotals = aggregateTotals(countryNames, televoteSubs);
  const juryTotals = aggregateTotals(countryNames, jurySubs);
  const overallTotals = countryNames.reduce((acc,n)=> (acc[n]=(televoteTotals[n]||0)+(juryTotals[n]||0), acc), {});

  const slides = [];

  slides.push({ kind: 'title', title: cfg.name || 'Song Contest', subtitle: 'Presentation' });

  const order = ['12','10','8','7','6','5','4','3','2','1'].map(Number);

  televoteSubs.forEach(s => {
    const awards = Object.entries(s.points)
      .map(([to, pts]) => ({ to, pts, flag: flagMap[to] || '' }))
      .sort((a,b)=> order.indexOf(b.pts) - order.indexOf(a.pts));
    slides.push({ kind: 'award', voteType: 'televote', fromCountry: s.fromCountry, fromFlag: flagMap[s.fromCountry] || '', awards });
  });

  slides.push({ kind: 'table', title: 'Televote — Live Table', rows: rankingRows(countryNames, flagMap, televoteTotals) });

  jurySubs.forEach(s => {
    const awards = Object.entries(s.points)
      .map(([to, pts]) => ({ to, pts, flag: flagMap[to] || '' }))
      .sort((a,b)=> order.indexOf(b.pts) - order.indexOf(a.pts));
    slides.push({ kind: 'award', voteType: 'jury', fromCountry: s.fromCountry, fromFlag: flagMap[s.fromCountry] || '', awards });
  });

  slides.push({ kind: 'table', title: 'Jury — Live Table', rows: rankingRows(countryNames, flagMap, juryTotals) });
  slides.push({ kind: 'table', title: 'Overall — Combined', rows: rankingRows(countryNames, flagMap, overallTotals) });

  return slides;
}

// Rendering + navigation
const presEl = document.getElementById('presentation');
const stageEl = document.getElementById('pres-stage');
const btnExit = document.getElementById('pres-exit');

let presSlides = [];
let slideIdx = 0;
let fragmentIdx = 0;

function clearStage(){ stageEl.innerHTML=''; }

function renderTitleSlide(s) {
  const slide = document.createElement('div');
  slide.className = 'pres-slide';
  slide.innerHTML = `
    <div class="flag-bg"></div>
    <div class="content">
      <h2 class="pres-title">${s.title}</h2>
      <div class="pres-subtitle">${s.subtitle || ''}</div>
      <div style="margin-top:auto; opacity:.8">Press Space to begin</div>
    </div>`;
  slide.__fragments = [];
  return slide;
}

function renderAwardSlide(s) {
  const slide = document.createElement('div');
  slide.className = 'pres-slide';
  slide.innerHTML = `
    <div class="flag-bg" style="background-image:url('${s.fromFlag}')"></div>
    <div class="content">
      <div class="pres-subtitle">${s.voteType === 'televote' ? 'Televote' : 'Jury'}</div>
      <div class="award-header">
        <img src="${s.fromFlag}" alt="">
        <div class="name">${s.fromCountry}</div>
      </div>
      <div class="points-grid"></div>
    </div>`;
  const grid = slide.querySelector('.points-grid');

  s.awards.forEach(({to, pts, flag}) => {
    const card = document.createElement('div');
    card.className = 'point-card';
    card.innerHTML = `
      <img src="${flag}" alt="">
      <div class="country">${to}</div>
      <div class="pts">${pts}</div>
    `;
    grid.appendChild(card);
  });

  slide.__fragments = Array.from(grid.children);
  return slide;
}

function renderTableSlide(s) {
  const slide = document.createElement('div');
  slide.className = 'pres-slide';
  slide.innerHTML = `
    <div class="flag-bg"></div>
    <div class="content">
      <h3 class="pres-title" style="font-size:32px">${s.title}</h3>
      <div class="table" style="margin-top:10px">
        <div class="thead">
          <div class="cell">Position</div>
          <div class="cell">Flag</div>
          <div class="cell">Country</div>
          <div class="cell" style="text-align:right">Points</div>
        </div>
        <div class="tbody"></div>
      </div>
    </div>`;
  const tbody = slide.querySelector('.tbody');
  s.rows.forEach(r => {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `
      <div class="cell">${r.pos}</div>
      <div class="cell"><img class="flag" src="${r.flag}" alt=""></div>
      <div class="cell">${r.name}</div>
      <div class="cell" style="text-align:right; font-weight:800">${r.pts}</div>
    `;
    tbody.appendChild(row);
  });
  slide.__fragments = [];
  return slide;
}

function mountSlide() {
  clearStage();
  const s = presSlides[slideIdx];
  let node;
  if (s.kind === 'title') node = renderTitleSlide(s);
  else if (s.kind === 'award') node = renderAwardSlide(s);
  else if (s.kind === 'table') node = renderTableSlide(s);
  else node = document.createElement('div');

  stageEl.appendChild(node);
  fragmentIdx = 0;

  if (s.kind === 'table') {
    const rows = stageEl.querySelectorAll('.tbody .row');
    rows.forEach((r,i)=>{ if (i<3) r.classList.add('bump'); });
    setTimeout(()=> rows.forEach(r=> r.classList.remove('bump')), 600);
  }
}

function nextFragmentOrSlide() {
  const slide = stageEl.querySelector('.pres-slide');
  const fragments = slide?.__fragments || [];
  if (fragmentIdx < fragments.length) {
    fragments[fragmentIdx].classList.add('revealed','bump');
    fragmentIdx++;
    return;
  }
  if (slideIdx < presSlides.length - 1) {
    slideIdx++;
    mountSlide();
  }
}

function prevFragmentOrSlide() {
  const slide = stageEl.querySelector('.pres-slide');
  const fragments = slide?.__fragments || [];
  if (fragmentIdx > 0) {
    fragmentIdx--;
    fragments[fragmentIdx].classList.remove('revealed','bump');
    return;
  }
  if (slideIdx > 0) {
    slideIdx--;
    mountSlide();
    const newSlide = stageEl.querySelector('.pres-slide');
    const fr = newSlide?.__fragments || [];
    fr.forEach(el => el.classList.add('revealed'));
    fragmentIdx = fr.length;
  }
}

function openPresentation() {
  try {
    presSlides = buildPresentationSlides();
  } catch (e) {
    alert(e.message);
    return;
  }
  slideIdx = 0;
  fragmentIdx = 0;
  presEl.classList.remove('hidden');
  presEl.setAttribute('aria-hidden','false');
  mountSlide();
}

function closePresentation() {
  presEl.classList.add('hidden');
  presEl.setAttribute('aria-hidden','true');
  stageEl.innerHTML = '';
}

document.getElementById('start-presentation').onclick = openPresentation;
document.getElementById('pres-exit').onclick = closePresentation;

function onPresKeydown(e){
  if (presEl.classList.contains('hidden')) return;
  const code = e.key;
  if (code === 'Escape') { e.preventDefault(); closePresentation(); return; }
  if (code === 'ArrowRight' || code === ' ' || code === 'Enter') { e.preventDefault(); nextFragmentOrSlide(); return; }
  if (code === 'ArrowLeft' || code === 'Backspace') { e.preventDefault(); prevFragmentOrSlide(); return; }
}
window.addEventListener('keydown', onPresKeydown);
