// --- Utilities ---
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

const STORAGE_KEYS = {
  CONFIGS: 'sc_configs',         // map code -> config
  SUBMISSIONS: 'sc_submissions', // map code -> array of submissions
  DRAFT_CONFIG: 'sc_draft_config'
};

function loadStore(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function saveStore(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function genCode(maxLen=10) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/1/I/O
  const len = Math.floor(6 + Math.random()*4); // 6-9 chars; <= max 10
  let out = '';
  for (let i=0;i<len;i++) out += alphabet[Math.floor(Math.random()*alphabet.length)];
  return out;
}

// Convert file to data URL (for flags)
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
$('#generate-code').onclick = () => {
  if (!draftConfig.name) { alert('Enter a competition name first.'); return; }
  if (draftConfig.countries.length < 10) {
    if (!confirm('Fewer than 10 countries added. Continue?')) return;
  }
  const code = genCode(10);
  draftConfig.code = code;

  const configs = loadStore(STORAGE_KEYS.CONFIGS, {});
  configs[code] = structuredClone(draftConfig);
  saveStore(STORAGE_KEYS.CONFIGS, configs);

  $('#share-code').textContent = code;
  // Put code in URL hash for easy sharing
  history.replaceState(null, '', `#${code}`);
  alert('Code generated and saved locally.');
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

// --- Submissions storage helpers ---
function getSubmissionsMap() {
  return loadStore(STORAGE_KEYS.SUBMISSIONS, {});
}
function saveSubmission(code, submission) {
  const map = getSubmissionsMap();
  map[code] = map[code] || [];
  // replace if same country + type
  const idx = map[code].findIndex(s => s.fromCountry === submission.fromCountry && s.voteType === submission.voteType);
  if (idx >= 0) map[code][idx] = submission; else map[code].push(submission);
  saveStore(STORAGE_KEYS.SUBMISSIONS, map);
}
function loadSubmissions(code) {
  return getSubmissionsMap()[code] || [];
}

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
$('#clear-submissions').onclick = () => {
  if (!draftConfig.code) { alert('No competition code yet.'); return; }
  const map = getSubmissionsMap();
  delete map[draftConfig.code];
  saveStore(STORAGE_KEYS.SUBMISSIONS, map);
  $('#results').innerHTML = '';
  alert('All submissions cleared for this competition.');
};

// Compute and show results
const tplResult = $('#result-line-tpl');

$('#compute-results').onclick = () => {
  const code = draftConfig.code;
  if (!code) { alert('Generate a code first.'); return; }
  const configs = loadStore(STORAGE_KEYS.CONFIGS, {});
  const cfg = configs[code];
  if (!cfg) { alert('Config not found.'); return; }

  const subs = loadSubmissions(code);
  const countries = cfg.countries.map(c => c.name);

  // Initialize totals
  const totals = {};
  const juryTotals = {};
  const teleTotals = {};
  countries.forEach(n => { totals[n]=0; juryTotals[n]=0; teleTotals[n]=0; });

  const resultsBox = $('#results');
  resultsBox.innerHTML = '';

  // Helper: render animated line
  function addLine(text, flagDataUrl) {
    const node = tplResult.content.firstElementChild.cloneNode(true);
    node.querySelector('.flag-bg').style.backgroundImage = `url(${flagDataUrl})`;
    node.querySelector('.text').textContent = text;
    resultsBox.appendChild(node);
  }

  // Build a quick map for flags
  const flagMap = Object.fromEntries(cfg.countries.map(c => [c.name, c.flagDataUrl]));

  // For each submission, add points line by line
  for (const sub of subs) {
    const isJury = sub.voteType === 'jury';
    Object.entries(sub.points).forEach(([toCountry, pts]) => {
      totals[toCountry] = (totals[toCountry] ?? 0) + pts;
      if (isJury) juryTotals[toCountry]+=pts; else teleTotals[toCountry]+=pts;
      const line = `The country receiving ${pts} points from ${sub.fromCountry} is ${toCountry}.`;
      addLine(line, flagMap[toCountry] || '');
    });
  }

  // Summary table-like text
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
  // ensure each point value used once at most
  const selects = $$('.points', scoreboard);
  const chosen = selects.map(s => s.value).filter(Boolean);
  selects.forEach(s => {
    for (const opt of s.options) {
      if (!opt.value) continue;
      opt.disabled = chosen.includes(opt.value) && s.value !== opt.value;
    }
  });
}

function loadByCode(code) {
  const configs = loadStore(STORAGE_KEYS.CONFIGS, {});
  const cfg = configs[code];
  if (!cfg) { alert('Competition code not found on this device. The organiser must share the config file or host it.'); return; }
  loadedVoteConfig = cfg;
  renderScoreboard(cfg);
}

$('#load-by-code').onclick = () => {
  const code = $('#vote-code').value.trim().toUpperCase();
  if (!code) { alert('Enter a code.'); return; }
  loadByCode(code);
};

window.addEventListener('load', () => {
  const hashCode = location.hash.replace('#','').trim().toUpperCase();
  if (hashCode) {
    $('#share-code').textContent = hashCode;
    const configs = loadStore(STORAGE_KEYS.CONFIGS, {});
    if (configs[hashCode]) {
      draftConfig = configs[hashCode];
      $('#comp-name').value = draftConfig.name || '';
      renderCountries();
    }
    $('#vote-code').value = hashCode;
  }
});

// Clear votes
$('#clear-scores').onclick = () => {
  $$('.points', scoreboard).forEach(s => s.value='');
  enforceUniquePoints();
};

// Submit votes -> export JSON file (to be sent to organiser)
$('#submit-votes').onclick = () => {
  const fromCountry = $('#voter-country').value.trim();
  if (!loadedVoteConfig) { alert('Load a competition by code first.'); return; }
  if (!fromCountry) { alert('Enter the voting country name.'); return; }
  const voteType = $('input[name="vote-type"]:checked').value; // 'jury' or 'televote'

  // Build points map
  const pointsMap = {};
  const required = ['12','10','8','7','6','5','4','3','2','1'];
  const selected = $$('.score-row').map(row => {
    const name = row.querySelector('.name').textContent;
    const val = row.querySelector('.points').value;
    return {name, val};
  }).filter(r => r.val);

  // Basic validation: each of the 10 must appear exactly once
  const picked = selected.map(s=>s.val);
  const missing = required.filter(x => !picked.includes(x));
  if (missing.length) {
    alert(`Missing these point values: ${missing.join(', ')}`);
    return;
  }

  // Ensure no self-vote
  if (selected.some(s => s.name.toLowerCase() === fromCountry.toLowerCase())) {
    if (!confirm('You are assigning points to your own country. Continue?')) return;
  }

  selected.forEach(s => { pointsMap[s.name] = Number(s.val); });

  const submission = {
    code: loadedVoteConfig.code,
    fromCountry,
    voteType, // 'jury' | 'televote'
    points: pointsMap,
    timestamp: new Date().toISOString()
  };

  // For no-backend flow: download JSON the organiser can import
  const blob = new Blob([JSON.stringify(submission, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${fromCountry}_${voteType}_votes_${loadedVoteConfig.code}.json`;
  a.click();

  // Also show a confirmation and store locally so organiser on same device can aggregate
  saveSubmission(submission.code, submission);
  $('#submit-confirm').textContent = `Submitted ${voteType} votes from ${fromCountry}. A JSON file was downloaded — send it to the organiser.`;
};

// Keep draft config persisted
window.addEventListener('beforeunload', () => {
  saveStore(STORAGE_KEYS.DRAFT_CONFIG, draftConfig);
});
