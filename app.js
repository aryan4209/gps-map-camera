'use strict';

/* ---------------- Settings ---------------- */

const DEFAULTS = {
  dateFormat: 'DD/MM/YYYY',
  hour12: true,
  showSeconds: false,
  mapType: 'satellite',   // satellite | street
  showMap: true,
  showFlag: true,
  showAddress: true,
  showPlus: true,
  showLatLon: true,
  showTime: true,
  showBrand: true,
  brandText: 'GPS Map Camera',
};

const STORE_KEY = 'gps-photo-stamp-settings';
let settings = loadSettings();

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const s = Object.assign({}, DEFAULTS, raw ? JSON.parse(raw) : {});
    if (s.brandText === 'GPS Photo Stamp') s.brandText = DEFAULTS.brandText; // old default name
    return s;
  } catch (e) {
    return Object.assign({}, DEFAULTS);
  }
}

function saveSettings() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
}

/* ---------------- Helpers ---------------- */

const $ = (id) => document.getElementById(id);
const pad = (n, w = 2) => String(n).padStart(w, '0');

function toast(msg, ms = 2500) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// "+05:30" -> 330 minutes. Returns null when invalid.
function parseTz(str) {
  const m = /^\s*(?:GMT|UTC)?\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?\s*$/i.exec(str || '');
  if (!m) return null;
  const mins = Number(m[2]) * 60 + Number(m[3] || 0);
  return m[1] === '-' ? -mins : mins;
}

function formatTz(mins) {
  const sign = mins < 0 ? '-' : '+';
  const a = Math.abs(mins);
  return `${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

function deviceTzMinutes() {
  return -new Date().getTimezoneOffset();
}

// Wall-clock date/time strings for an instant in a given offset.
function wallClock(ms, offsetMin) {
  const d = new Date(ms + offsetMin * 60000);
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`,
  };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// "Friday, 02/10/2026 11:25 AM GMT +05:30"
function formatStampTime(dateStr, timeStr, tzStr) {
  const [y, mo, d] = (dateStr || '').split('-').map(Number);
  if (!y || !mo || !d) return '';
  const [h = 0, mi = 0, s = 0] = (timeStr || '00:00').split(':').map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];

  let date;
  if (settings.dateFormat === 'MM/DD/YYYY') date = `${pad(mo)}/${pad(d)}/${y}`;
  else if (settings.dateFormat === 'YYYY-MM-DD') date = `${y}-${pad(mo)}-${pad(d)}`;
  else date = `${pad(d)}/${pad(mo)}/${y}`;

  const sec = settings.showSeconds ? `:${pad(s)}` : '';
  let time;
  if (settings.hour12) {
    const h12 = h % 12 === 0 ? 12 : h % 12;
    time = `${pad(h12)}:${pad(mi)}${sec} ${h < 12 ? 'AM' : 'PM'}`;
  } else {
    time = `${pad(h)}:${pad(mi)}${sec}`;
  }

  const tz = parseTz(tzStr);
  const tzText = tz === null ? '' : ` GMT ${formatTz(tz)}`;
  return `${wd}, ${date} ${time}${tzText}`;
}

function flagEmoji(cc) {
  if (!cc || cc.length !== 2) return '';
  return String.fromCodePoint(...cc.toUpperCase().split('').map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/* ---------------- Plus code (Open Location Code) ---------------- */

const OLC_ALPHABET = '23456789CFGHJMPQRVWX';

function plusCode(lat, lon) {
  lat = Math.min(Math.max(lat, -90), 90 - 1e-9);
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  const latVal = Math.floor((lat + 90) * 8000);
  const lonVal = Math.floor((lon + 180) * 8000);
  let code = '';
  for (let i = 0; i < 5; i++) {
    const div = Math.pow(20, 4 - i);
    code += OLC_ALPHABET[Math.floor(latVal / div) % 20] + OLC_ALPHABET[Math.floor(lonVal / div) % 20];
    if (i === 3) code += '+';
  }
  // Short form (relative to the nearby locality), like "H6J2+WF"
  return code.slice(4);
}

/* ---------------- Location ---------------- */

function getGps() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('GPS not supported in this browser'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) => reject(new Error(e.message || 'Location permission denied')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 }
    );
  });
}

const geoCache = new Map();

async function reverseGeocode(lat, lon) {
  const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&accept-language=en&lat=${lat}&lon=${lon}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Address lookup failed');
  const j = await res.json();
  const a = j.address || {};
  const city = a.city || a.town || a.village || a.municipality || a.county || a.state_district || '';
  const title = [city, a.state, a.country].filter(Boolean).join(', ');
  const parts = [
    a.house_number && a.road ? `${a.house_number} ${a.road}` : a.road,
    a.neighbourhood || a.suburb || a.quarter,
    city,
    a.state,
    [a.postcode].filter(Boolean).join(''),
    a.country,
  ].filter(Boolean);
  const address = [...new Set(parts)].join(', ');
  const out = { title: title || j.display_name || '', address, cc: a.country_code || '' };
  geoCache.set(key, out);
  return out;
}

/* ---------------- Map thumbnail ---------------- */

const TILE_URLS = {
  satellite: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  street: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
};
const MAP_ZOOM = 17;
const MAP_VIEW = 220; // tile pixels shown in the thumbnail
const mapCache = new Map();

function loadImg(src, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => { img.src = ''; reject(new Error('timeout')); }, timeoutMs);
    img.crossOrigin = 'anonymous';
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = (e) => { clearTimeout(timer); reject(e); };
    img.src = src;
  });
}

async function buildMap(lat, lon, type) {
  const key = `${type}|${lat.toFixed(5)}|${lon.toFixed(5)}`;
  if (mapCache.has(key)) return mapCache.get(key);

  const z = MAP_ZOOM, n = Math.pow(2, z);
  const px = ((lon + 180) / 360) * n * 256;
  const latR = (lat * Math.PI) / 180;
  const py = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n * 256;

  const c = document.createElement('canvas');
  c.width = c.height = MAP_VIEW;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c9c4b5';
  ctx.fillRect(0, 0, MAP_VIEW, MAP_VIEW);

  const x0 = px - MAP_VIEW / 2, y0 = py - MAP_VIEW / 2;
  const jobs = [];
  for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + MAP_VIEW) / 256); tx++) {
    for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + MAP_VIEW) / 256); ty++) {
      const wx = ((tx % n) + n) % n;
      jobs.push(
        loadImg(TILE_URLS[type](z, wx, ty))
          .then((img) => ctx.drawImage(img, tx * 256 - x0, ty * 256 - y0))
          .catch(() => {})
      );
    }
  }
  await Promise.all(jobs);

  // Verify canvas is not tainted; if it is, fall back to a plain background.
  try { ctx.getImageData(0, 0, 1, 1); } catch (e) {
    ctx.clearRect(0, 0, MAP_VIEW, MAP_VIEW);
    ctx.fillStyle = '#c9c4b5';
    ctx.fillRect(0, 0, MAP_VIEW, MAP_VIEW);
  }

  // Direction cone + pin
  const cx = MAP_VIEW / 2, cy = MAP_VIEW / 2;
  ctx.fillStyle = 'rgba(70,130,255,0.45)';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, 55, -0.35, 0.55);
  ctx.closePath();
  ctx.fill();
  drawPin(ctx, cx, cy, 30);

  // Attribution
  ctx.font = '600 11px Roboto, Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.textBaseline = 'bottom';
  ctx.fillText(type === 'satellite' ? '© Esri' : '© OpenStreetMap', 6, MAP_VIEW - 4);

  mapCache.set(key, c);
  return c;
}

function drawPin(ctx, x, tipY, h) {
  const r = h * 0.36;
  const cy = tipY - h + r;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 4;
  ctx.fillStyle = '#e53935';
  ctx.beginPath();
  ctx.arc(x, cy, r, Math.PI * 0.85, Math.PI * 0.15);
  ctx.lineTo(x, tipY);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#7f0000';
  ctx.beginPath();
  ctx.arc(x, cy, r * 0.42, 0, Math.PI * 2);
  ctx.fill();
}

/* ---------------- Stamp rendering ---------------- */

const FONT = 'Roboto, "Segoe UI", "Noto Color Emoji", "Apple Color Emoji", Arial, sans-serif';
const MAX_SIDE = 4096;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function renderStamp(canvas, img, st, mapCanvas) {
  let W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const scale = Math.min(1, MAX_SIDE / Math.max(W, H));
  W = Math.round(W * scale);
  H = Math.round(H * scale);
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, W, H);

  const u = Math.min(W / 960, H / 900);
  const margin = 40 * u;
  const pad = 20 * u;
  const mapSize = settings.showMap ? 230 * u : 0;
  const gap = settings.showMap ? 20 * u : 0;

  const boxX = margin + mapSize + gap;
  const boxW = W - boxX - margin;
  const innerW = boxW - pad * 2;

  // Text lines
  const titleSize = 34 * u, bodySize = 22 * u;
  const titleFont = `400 ${titleSize}px ${FONT}`;
  const bodyFont = `400 ${bodySize}px ${FONT}`;
  const lat = Number(st.lat), lon = Number(st.lon);
  const hasCoords = st.lat !== '' && st.lon !== '' && isFinite(lat) && isFinite(lon);

  ctx.font = titleFont;
  const titleText = [st.title, settings.showFlag ? flagEmoji(st.cc) : ''].filter(Boolean).join(' ');
  const titleLines = titleText ? wrap(ctx, titleText, innerW) : [];

  ctx.font = bodyFont;
  const body = [];
  if (settings.showAddress) {
    const addr = [settings.showPlus && hasCoords ? plusCode(lat, lon) : '', st.address].filter(Boolean).join(', ');
    if (addr) body.push(...wrap(ctx, addr, innerW));
  } else if (settings.showPlus && hasCoords) {
    body.push(plusCode(lat, lon));
  }
  if (settings.showLatLon && hasCoords) {
    body.push(...wrap(ctx, `Lat ${lat.toFixed(6)}° Long ${lon.toFixed(6)}°`, innerW));
  }
  if (settings.showTime) {
    const t = formatStampTime(st.date, st.time, st.tz);
    if (t) body.push(...wrap(ctx, t, innerW));
  }

  const titleLH = titleSize * 1.2, bodyLH = bodySize * 1.25;
  const textH = titleLines.length * titleLH + (titleLines.length && body.length ? 6 * u : 0) + body.length * bodyLH;
  const boxH = Math.max(mapSize, textH + pad * 2);
  const boxY = H - margin - boxH;

  // Map thumbnail
  if (settings.showMap) {
    const my = boxY + boxH - mapSize;
    ctx.save();
    roundRect(ctx, margin, my, mapSize, mapSize, 10 * u);
    ctx.clip();
    if (mapCanvas) ctx.drawImage(mapCanvas, margin, my, mapSize, mapSize);
    else { ctx.fillStyle = 'rgba(80,80,80,0.8)'; ctx.fillRect(margin, my, mapSize, mapSize); }
    ctx.restore();
  }

  // Text box
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  roundRect(ctx, boxX, boxY, boxW, boxH, 10 * u);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'top';
  let y = boxY + pad;
  if (boxH > textH + pad * 2) y = boxY + (boxH - textH) / 2;
  ctx.font = titleFont;
  for (const l of titleLines) { ctx.fillText(l, boxX + pad, y); y += titleLH; }
  if (titleLines.length && body.length) y += 6 * u;
  ctx.font = bodyFont;
  for (const l of body) { ctx.fillText(l, boxX + pad, y); y += bodyLH; }

  // Label tag above the box
  if (settings.showBrand && settings.brandText) {
    const tagSize = 17 * u;
    ctx.font = `400 ${tagSize}px ${FONT}`;
    const iconS = 24 * u;
    const tw = ctx.measureText(settings.brandText).width;
    const tagW = tw + iconS + 30 * u, tagH = 38 * u;
    const tagX = boxX + boxW - tagW, tagY = boxY - tagH;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    roundRect(ctx, tagX, tagY, tagW, tagH, 6 * u);
    ctx.fill();
    // Icon: small pin in a rounded square
    const ix = tagX + 10 * u, iy = tagY + (tagH - iconS) / 2;
    ctx.fillStyle = '#2f80ed';
    roundRect(ctx, ix, iy, iconS, iconS, 5 * u);
    ctx.fill();
    drawPin(ctx, ix + iconS / 2, iy + iconS * 0.85, iconS * 0.7);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(settings.brandText, ix + iconS + 10 * u, tagY + tagH / 2);
  }
}

/* ---------------- Editor state ---------------- */

const ed = {
  img: null,
  title: '', address: '', cc: '',
  lat: '', lon: '',
  date: '', time: '', tz: '',
  map: null,
};

const preview = $('preview');

function render() {
  if (!ed.img) return;
  renderStamp(preview, ed.img, ed, ed.map);
}

const refreshMap = debounce(async () => {
  const lat = Number(ed.lat), lon = Number(ed.lon);
  if (!settings.showMap || ed.lat === '' || ed.lon === '' || !isFinite(lat) || !isFinite(lon)) {
    ed.map = null;
    render();
    return;
  }
  $('busy').classList.remove('hidden');
  try {
    ed.map = await buildMap(lat, lon, settings.mapType);
  } finally {
    $('busy').classList.add('hidden');
  }
  render();
}, 500);

function fillEditorFields() {
  $('fTitle').value = ed.title;
  $('fAddress').value = ed.address;
  $('fLat').value = ed.lat === '' ? '' : Number(ed.lat).toFixed(6);
  $('fLon').value = ed.lon === '' ? '' : Number(ed.lon).toFixed(6);
  $('fDate').value = ed.date;
  $('fTime').value = ed.time;
  $('fTz').value = ed.tz;
}

function setActualTime() {
  const tzMin = deviceTzMinutes();
  const wc = wallClock(Date.now(), tzMin);
  ed.date = wc.date; ed.time = wc.time; ed.tz = formatTz(tzMin);
  fillEditorFields();
  render();
}

// Fill location name + address for the current coordinates.
async function lookupAddress() {
  const lat = Number(ed.lat), lon = Number(ed.lon);
  if (ed.lat === '' || ed.lon === '' || !isFinite(lat) || !isFinite(lon)) return;
  try {
    const g = await reverseGeocode(lat, lon);
    if (Number(ed.lat) !== lat || Number(ed.lon) !== lon) return; // changed meanwhile
    ed.title = g.title; ed.address = g.address; ed.cc = g.cc;
    $('fTitle').value = ed.title;
    $('fAddress').value = ed.address;
    render();
  } catch (e) {
    toast('Could not fetch address (offline?). You can type it manually.');
  }
}

function setLocation(lat, lon) {
  ed.lat = lat; ed.lon = lon;
  fillEditorFields();
  refreshMap();
  lookupAddress();
}

async function setActualLocation() {
  if (live.pos) setLocation(live.pos.lat, live.pos.lon); // show last known right away
  try {
    const p = await getGps();
    live.pos = p;
    setLocation(p.lat, p.lon);
  } catch (e) {
    if (!live.pos) toast(`${e.message}. You can type the location manually.`);
  }
}

function openEditor(file) {
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    ed.img = img;
    ed.title = ''; ed.address = ''; ed.cc = ''; ed.map = null;
    ed.lat = ''; ed.lon = '';
    showScreen('editor');
    setActualTime();
    setActualLocation();
  };
  img.onerror = () => toast('Could not open this image.');
  img.src = URL.createObjectURL(file);
}

/* ---------------- Save / share ---------------- */

function fileName() {
  const d = (ed.date || '').replace(/-/g, '');
  const t = (ed.time || '').replace(/:/g, '');
  return `GPS_${d}_${t}.jpg`;
}

function canvasBlob() {
  return new Promise((resolve) => preview.toBlob(resolve, 'image/jpeg', 0.92));
}

async function savePhoto() {
  const blob = await canvasBlob();
  if (!blob) return toast('Could not create image.');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('Photo saved to Downloads.');
}

async function sharePhoto() {
  const blob = await canvasBlob();
  if (!blob) return toast('Could not create image.');
  const file = new File([blob], fileName(), { type: 'image/jpeg' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'GPS Photo' }); } catch (e) { /* cancelled */ }
  } else {
    toast('Sharing not supported here — saving instead.');
    savePhoto();
  }
}

/* ---------------- Home: live location card ---------------- */

const live = { pos: null, geo: null };

async function refreshLive() {
  $('liveTitle').textContent = 'Detecting location…';
  $('liveAddress').textContent = '';
  $('liveCoords').textContent = '';
  try {
    live.pos = await getGps();
    $('liveCoords').textContent = `Lat ${live.pos.lat.toFixed(6)}° Long ${live.pos.lon.toFixed(6)}°`;
    live.geo = await reverseGeocode(live.pos.lat, live.pos.lon);
    $('liveTitle').textContent = `${live.geo.title} ${flagEmoji(live.geo.cc)}`.trim();
    $('liveAddress').textContent = `${plusCode(live.pos.lat, live.pos.lon)}, ${live.geo.address}`;
  } catch (e) {
    $('liveTitle').textContent = live.pos ? 'Address unavailable' : 'Location unavailable';
    $('liveAddress').textContent = e.message;
  }
}

function tickClock() {
  const tz = deviceTzMinutes();
  const wc = wallClock(Date.now(), tz);
  $('liveTime').textContent = formatStampTime(wc.date, wc.time, formatTz(tz));
}

/* ---------------- Navigation ---------------- */

function showScreen(name) {
  $('home').classList.toggle('hidden', name !== 'home');
  $('editor').classList.toggle('hidden', name !== 'editor');
  $('backBtn').classList.toggle('hidden', name === 'home');
  window.scrollTo(0, 0);
}

/* ---------------- Settings UI ---------------- */

const SETTING_FIELDS = [
  ['sDateFmt', 'dateFormat', 'value'],
  ['sHour12', 'hour12', 'bool'],
  ['sSeconds', 'showSeconds', 'checked'],
  ['sMapType', 'mapType', 'value'],
  ['sShowMap', 'showMap', 'checked'],
  ['sShowFlag', 'showFlag', 'checked'],
  ['sShowAddress', 'showAddress', 'checked'],
  ['sShowPlus', 'showPlus', 'checked'],
  ['sShowLatLon', 'showLatLon', 'checked'],
  ['sShowTime', 'showTime', 'checked'],
  ['sShowBrand', 'showBrand', 'checked'],
  ['sBrand', 'brandText', 'value'],
];

function syncSettingsUI() {
  for (const [id, key, kind] of SETTING_FIELDS) {
    const el = $(id);
    if (kind === 'checked') el.checked = !!settings[key];
    else if (kind === 'bool') el.value = settings[key] ? '1' : '0';
    else el.value = settings[key];
  }
}

function onSettingChange(id, key, kind) {
  const el = $(id);
  const prevMapType = settings.mapType, prevShowMap = settings.showMap;
  if (kind === 'checked') settings[key] = el.checked;
  else if (kind === 'bool') settings[key] = el.value === '1';
  else settings[key] = el.value;
  saveSettings();
  syncSettingsUI();
  tickClock();
  if (settings.mapType !== prevMapType || settings.showMap !== prevShowMap) refreshMap();
  else render();
}

/* ---------------- Wire up ---------------- */

function init() {
  syncSettingsUI();
  for (const [id, key, kind] of SETTING_FIELDS) {
    $(id).addEventListener(kind === 'checked' || $(id).tagName === 'SELECT' ? 'change' : 'input', () => onSettingChange(id, key, kind));
  }

  $('settingsBtn').onclick = () => { syncSettingsUI(); $('settings').classList.remove('hidden'); };
  $('closeSettings').onclick = () => $('settings').classList.add('hidden');
  $('settings').addEventListener('click', (e) => { if (e.target.id === 'settings') $('settings').classList.add('hidden'); });
  $('resetSettings').onclick = () => {
    settings = Object.assign({}, DEFAULTS);
    saveSettings();
    syncSettingsUI();
    tickClock();
    refreshMap();
    toast('Settings reset.');
  };

  $('backBtn').onclick = () => showScreen('home');
  $('refreshLoc').onclick = refreshLive;

  for (const id of ['cameraInput', 'uploadInput']) {
    $(id).addEventListener('change', (e) => {
      openEditor(e.target.files[0]);
      e.target.value = '';
    });
  }

  // Editor fields
  const bindText = (id, key, after) => $(id).addEventListener('input', (e) => {
    ed[key] = e.target.value;
    if (after) after();
    render();
  });
  // Typing new coordinates moves the map and refreshes the address.
  const coordsChanged = () => { refreshMap(); lookupAddressSoon(); };
  const lookupAddressSoon = debounce(lookupAddress, 1200);
  bindText('fTitle', 'title');
  bindText('fAddress', 'address');
  bindText('fDate', 'date');
  bindText('fTime', 'time');
  bindText('fTz', 'tz');
  bindText('fLat', 'lat', coordsChanged);
  bindText('fLon', 'lon', coordsChanged);

  $('resetActual').onclick = () => { setActualTime(); setActualLocation(); };

  $('saveBtn').onclick = savePhoto;
  $('shareBtn').onclick = sharePhoto;

  tickClock();
  setInterval(tickClock, 1000);
  refreshLive();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
