'use strict';

/* ---------- hulpjes ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pad = n => String(n).padStart(2, '0');
const Q = new URLSearchParams(location.search);
const S = { trip: null, enc: null, key: null, dev: false, edits: ls.get('edits', {}), pos: null, watch: null, tab: null, dayIndex: 0, dayRequest: null, renderedOn: '' };
const D = { hold: 0, cleanup: null };

/* ---------- versleuteling (zelfde formaat als tools/encrypt_trip.py) ---------- */
function b64e(buf) { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function deriveKey(pass, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
async function decryptTrip(enc, key) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(enc.iv) }, key, b64d(enc.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
async function encryptTrip(obj, key, saltB64) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { v: 1, salt: saltB64, iv: b64e(iv), ct: b64e(ct) };
}
async function storeKey(key) { ls.set('k', b64e(await crypto.subtle.exportKey('raw', key))); }
async function loadKey() { const k = ls.get('k', null); if (!k) return null; return crypto.subtle.importKey('raw', b64d(k), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']); }

/* ---------- datums ---------- */
function todayStr() {
  const o = Q.get('datum');
  if (o && /^\d{4}-\d{2}-\d{2}$/.test(o)) return o;
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
const asDate = s => new Date(s + 'T12:00:00Z');
const addDay = (s, n = 1) => new Date(asDate(s).getTime() + n * 864e5).toISOString().slice(0, 10);
const diffDays = (a, b) => Math.round((asDate(b) - asDate(a)) / 864e5);
const fmt = (s, o) => asDate(s).toLocaleDateString('nl-NL', Object.assign({ timeZone: 'UTC' }, o || { weekday: 'long', day: 'numeric', month: 'long' }));
const fmtShort = s => fmt(s, { weekday: 'short', day: 'numeric', month: 'short' });
const compactDate = (a, b) => fmt(a, { day: 'numeric', month: 'short' }) + (b ? ' — ' + fmt(b, { day: 'numeric', month: 'short' }) : '');
const dur = m => { m = Math.round(m); const h = Math.floor(m / 60); return h ? h + ' u ' + pad(m % 60) : m + ' min'; };
const hhmm = iso => (iso || '').slice(11, 16);

/* ---------- gegevens ---------- */
const stayOf = s => Object.assign({}, s, (S.edits.stays || {})[s.id] || {});
const flights = () => S.edits.flights || S.trip.flights || [];
const noteOf = id => (S.edits.notes || {})[id] || '';
function saveEdits() { ls.set('edits', S.edits); }
function days() {
  const t = S.trip, out = [];
  for (let d = t.start; d <= t.end; d = addDay(d)) out.push({ date: d, stay: t.stays.find(s => s.from <= d && d < s.to), legs: t.legs.filter(l => l.date === d) });
  return out;
}
function hav(a, b) {
  const R = 6371, r = Math.PI / 180, dl = (b[0] - a[0]) * r, dg = (b[1] - a[1]) * r;
  const x = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dg / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function todayIndex() {
  const t = S.trip, td = todayStr(), ds = days();
  if (td <= t.start) return 0;
  if (td >= t.end) return ds.length - 1;
  return Math.max(0, ds.findIndex(d => d.date === td));
}
/* Alles wat een dagpagina nodig heeft. De laatste dag heeft geen overnachting: dat is de terugreis. */
function dayContext(i) {
  const ds = days(), d = ds[i], td = todayStr(), t = S.trip;
  const home = !d.stay;
  const lastStay = stayOf(t.stays[t.stays.length - 1]);
  const stay = home ? null : stayOf(d.stay);
  const place = stay || lastStay;
  const stayIndex = t.stays.findIndex(s => s.id === place.id);
  const prev = i > 0 && ds[i - 1].stay && (!d.stay || ds[i - 1].stay.id !== d.stay.id) ? stayOf(ds[i - 1].stay) : null;
  const nights = stay ? diffDays(stay.from, stay.to) : 0;
  const nightNo = stay ? diffDays(stay.from, d.date) + 1 : 0;
  const next = ds[i + 1] || null;
  return {
    i, n: ds.length, d, date: d.date, td, home, stay, place, prev, next, nights, nightNo,
    nightsLeft: stay ? diffDays(d.date, stay.to) : 0,
    arrival: !!stay && d.date === stay.from,
    isToday: d.date === td, past: d.date < td, future: d.date > td,
    beforeTrip: td < t.start, afterTrip: td > t.end,
    km: d.legs.reduce((a, l) => a + l.km, 0), min: d.legs.reduce((a, l) => a + l.min, 0),
    style: sceneStyle(place, stayIndex), variant: home ? 2 : (nightNo - 1) % 3,
    name: home ? 'Naar huis' : stay.name,
  };
}

/* ---------- iconen ---------- */
const ICONS = {
  bed: '<path d="M3 18V7m18 11V9M3 14h18M3 10h18M6 10V7h5v3m2 0V7h5v3M3 18v2m18-2v2"/>',
  route: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="19" r="2"/><path d="M8 5h7a4 4 0 0 1 0 8H9a3 3 0 0 0 0 6h7"/>',
  plane: '<path d="m22 3-6 18-4-8-8-4 18-6ZM12 13l5-5"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  distance: '<path d="m5 19 4-14h6l4 14M11 5v3m1 3v3m1 3v2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"/>',
  cloud: '<path d="M7 19a5 5 0 0 1-1-10 6 6 0 0 1 11-2 6 6 0 0 1 1 12Z"/>',
  cloudsun: '<path d="M12 3v1.5M5.6 5.6l1 1M3 12h1.5M18.4 5.6l-1 1M8.2 11.2A4 4 0 0 1 15.6 9"/><path d="M8 20a4 4 0 0 1-.5-8 5 5 0 0 1 9.6 1.2A3.5 3.5 0 0 1 17 20Z"/>',
  rain: '<path d="M7 15a4.5 4.5 0 0 1-.5-9 5.5 5.5 0 0 1 10.6 1.3A3.9 3.9 0 0 1 17 15ZM8 18l-1 3m5-3-1 3m5-3-1 3"/>',
  snow: '<path d="M7 14a4.5 4.5 0 0 1-.5-9 5.5 5.5 0 0 1 10.6 1.3A3.9 3.9 0 0 1 17 14ZM8 18h.01M12 20h.01M16 18h.01M10 22h.01M14 22h.01"/>',
  storm: '<path d="M7 15a4.5 4.5 0 0 1-.5-9 5.5 5.5 0 0 1 10.6 1.3A3.9 3.9 0 0 1 17 15M13 12l-3 5h4l-2 4"/>',
  fog: '<path d="M4 9h16M4 13h12M8 17h12M4 17h1"/>',
  drop: '<path d="M12 3S5 11 5 15a7 7 0 0 0 14 0c0-4-7-12-7-12Z"/>',
  wind: '<path d="M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7a2.5 2.5 0 1 1-2.5 2.5"/>',
  sunrise: '<path d="M4 18h16M7 18a5 5 0 0 1 10 0M12 9V4m-3 3 3-3 3 3M4.5 13.5l1.5 1M19.5 13.5l-1.5 1"/>',
  sunset: '<path d="M4 18h16M7 18a5 5 0 0 1 10 0M12 4v5m-3-3 3 3 3-3M4.5 13.5l1.5 1M19.5 13.5l-1.5 1"/>',
  waves: '<path d="M3 8c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 13c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 18c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>',
  thermo: '<path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0Z"/>',
  uv: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
  edit: '<path d="m16 3 5 5M4 15 16 3l5 5L9 20l-6 1 1-6ZM4 15l5 5"/>',
  logout: '<path d="M10 4H4v16h6m-1-8h12m-5-5 5 5-5 5"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M8 3v4m8-4v4"/>',
  leaf: '<path d="M20 3C9 2 3 7 5 14s14 5 15-11ZM4 21 15 10"/>',
  down: '<path d="M12 4v16m-6-6 6 6 6-6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  note: '<path d="M6 3h9l4 4v14H6ZM14 3v5h5M9 13h7M9 17h5"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2ZM4 21V5M8 7h7"/>',
  fork: '<path d="M7 3v7a2 2 0 0 0 4 0V3M9 12v9M17 3c-2 2-3 4-3 7h3Zm0 7v11"/>',
  star: '<path d="m12 3 2.6 5.8 6.4.7-4.8 4.2 1.4 6.3L12 16.8 6.4 20l1.4-6.3L3 9.5l6.4-.7Z"/>',
  home: '<path d="M4 11 12 4l8 7v9H4Zm6 9v-6h4v6"/>',
};
const icon = name => '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24">' + (ICONS[name] || ICONS.pin) + '</svg>';

/* ---------- weer ---------- */
function wxInfo(code, night) {
  if (code == null) return { label: 'Onbekend', icon: 'cloud', fx: '' };
  if (code <= 1) return { label: night ? 'Helder' : code === 0 ? 'Zonnig' : 'Overwegend zonnig', icon: night ? 'moon' : 'sun', fx: '' };
  if (code === 2) return { label: 'Half bewolkt', icon: night ? 'cloud' : 'cloudsun', fx: '' };
  if (code === 3) return { label: 'Bewolkt', icon: 'cloud', fx: 'cloud' };
  if (code <= 48) return { label: 'Mist', icon: 'fog', fx: 'fog' };
  if (code <= 57) return { label: 'Motregen', icon: 'rain', fx: 'drizzle' };
  if (code <= 67) return { label: 'Regen', icon: 'rain', fx: 'rain' };
  if (code <= 77) return { label: 'Sneeuw', icon: 'snow', fx: 'snow' };
  if (code <= 82) return { label: 'Buien', icon: 'rain', fx: 'rain' };
  if (code <= 86) return { label: 'Sneeuwbuien', icon: 'snow', fx: 'snow' };
  return { label: 'Onweer', icon: 'storm', fx: 'storm' };
}
const wxPending = {};
function loadWeather(place) {
  const k = 'wx3_' + place.id, c = ls.get(k, null);
  if (c && Date.now() - c.ts < 40 * 60e3) return Promise.resolve(c.d);
  if (!navigator.onLine) return Promise.resolve(c ? c.d : null);
  if (wxPending[k]) return wxPending[k];
  const at = 'latitude=' + place.lat.toFixed(2) + '&longitude=' + place.lng.toFixed(2);
  /* zwak bereik: na 8 s opgeven en terugvallen op wat er nog ligt */
  const ctl = 'AbortController' in window ? new AbortController() : null, timer = setTimeout(() => ctl && ctl.abort(), 8000), opt = ctl ? { signal: ctl.signal } : {};
  const forecast = fetch('https://api.open-meteo.com/v1/forecast?' + at + '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max&timezone=auto&forecast_days=16', opt).then(r => r.json());
  const marine = place.sea ? fetch('https://marine-api.open-meteo.com/v1/marine?' + at + '&current=sea_surface_temperature&timezone=auto', opt).then(r => r.json()).catch(() => null) : Promise.resolve(null);
  wxPending[k] = Promise.all([forecast, marine]).then(([f, m]) => {
    if (!f || !f.daily || !Array.isArray(f.daily.time)) throw new Error('geen verwachting');
    const d = { ts: Date.now(), current: f.current || null, daily: f.daily, sea: m && m.current ? m.current.sea_surface_temperature : null };
    ls.set(k, { ts: Date.now(), d });
    return d;
  }).catch(() => (c ? c.d : null)).finally(() => { clearTimeout(timer); delete wxPending[k]; });
  return wxPending[k];
}
/* Het weer voor één dagpagina: vandaag de actuele meting, anders de verwachting voor die datum. */
function dayWeather(c, w) {
  if (!w) return null;
  const i = w.daily.time.indexOf(c.date);
  /* "Nu" alleen bij een verse meting; een oude cache valt terug op de dagverwachting (en op dagstand) */
  const live = c.isToday && w.current && Date.now() - (w.ts || 0) < 90 * 60e3;
  if (i < 0 && !live) return null;
  const night = live ? w.current.is_day === 0 : false;
  const code = live ? w.current.weather_code : w.daily.weather_code[i];
  return {
    live: !!live, night, info: wxInfo(code, night),
    temp: live ? w.current.temperature_2m : w.daily.temperature_2m_max[i],
    feels: live ? w.current.apparent_temperature : null,
    wind: live ? w.current.wind_speed_10m : null,
    max: i >= 0 ? w.daily.temperature_2m_max[i] : null, min: i >= 0 ? w.daily.temperature_2m_min[i] : null,
    rain: i >= 0 ? w.daily.precipitation_probability_max[i] : null,
    sunrise: i >= 0 ? hhmm(w.daily.sunrise[i]) : '', sunset: i >= 0 ? hhmm(w.daily.sunset[i]) : '',
    uv: i >= 0 && w.daily.uv_index_max ? w.daily.uv_index_max[i] : null,
    sea: w.sea,
  };
}

/* ---------- weer en nacht in het landschap ---------- */
const FX = ['cloud', 'drizzle', 'rain', 'storm', 'snow', 'fog'];
const rnd = (a, b) => a + Math.random() * (b - a);
function fxHtml(fx) {
  if (fx === 'rain' || fx === 'drizzle' || fx === 'storm') {
    const n = fx === 'drizzle' ? 22 : fx === 'storm' ? 60 : 44, slow = fx === 'drizzle';
    return Array.from({ length: n }, () => '<i class="drop" style="left:' + rnd(0, 135).toFixed(1) + '%;height:' + rnd(slow ? 3 : 6, slow ? 6 : 11).toFixed(1) + 'vh;opacity:' + rnd(.3, .8).toFixed(2) + ';animation-duration:' + rnd(slow ? 1.3 : .65, slow ? 2 : 1.15).toFixed(2) + 's;animation-delay:-' + rnd(0, 2).toFixed(2) + 's"></i>').join('');
  }
  if (fx === 'snow') return Array.from({ length: 40 }, () => { const s = rnd(3, 7).toFixed(1); return '<i class="flake" style="left:' + rnd(0, 100).toFixed(1) + '%;width:' + s + 'px;height:' + s + 'px;--dx:' + rnd(-70, 70).toFixed(0) + 'px;opacity:' + rnd(.5, .95).toFixed(2) + ';animation-duration:' + rnd(7, 13).toFixed(1) + 's;animation-delay:-' + rnd(0, 13).toFixed(1) + 's"></i>'; }).join('');
  if (fx === 'fog') return '<i class="fogband" style="top:30%"></i><i class="fogband" style="top:52%;animation-duration:48s;animation-direction:alternate-reverse"></i>';
  return '';
}
function applyFx(el, fx, night) {
  const key = (fx || '') + '|' + (night ? 1 : 0);
  if (el.dataset.fxKey === key) return;
  el.dataset.fxKey = key;
  FX.forEach(f => el.classList.remove('wx-' + f));
  el.classList.toggle('night', !!night);
  el.classList.toggle('has-fx', !!fx);
  if (fx) el.classList.add('wx-' + fx);
  $('.scene-fx', el).innerHTML = fx ? fxHtml(fx) : '';
  const stars = $('.stars', el);
  if (night && !stars.childElementCount) stars.innerHTML = Array.from({ length: 34 }, () => '<i style="left:' + rnd(0, 100).toFixed(1) + '%;top:' + rnd(0, 48).toFixed(1) + '%;animation-delay:-' + rnd(0, 3.6).toFixed(1) + 's"></i>').join('');
  syncChrome();
}
/* Statusbalk- en kopkleur volgen het landschap van de geselecteerde dag. */
function syncChrome() {
  const meta = $('meta[name="theme-color"]');
  if (S.tab !== 'vandaag') { meta.content = '#f4f0e8'; return; }
  const el = $('.destination.selected'), shell = $('.scene-shell');
  if (!el || !shell) return;
  const night = el.classList.contains('night');
  shell.classList.toggle('is-night', night);
  meta.content = night ? '#0a1633' : el.style.getPropertyValue('--scene-sky').trim() || '#e4e8d1';
}

/* ---------- beweging ---------- */
function letters(name) {
  let i = 0;
  return String(name).split(' ').map(w => '<span class="w" aria-hidden="true">' + [...w].map(ch => '<span class="ch" style="--i:' + (i++) + '">' + esc(ch) + '</span>').join('') + '</span>').join(' ');
}
const revealer = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { const t = e.target; t.classList.add('in'); revealer.unobserve(t); t.addEventListener('transitionend', ev => { if (ev.target === t && ev.propertyName === 'transform') t.classList.remove('sr'); }); } }), { threshold: .08, rootMargin: '0px 0px -4% 0px' }) : null;
function reveal(root, sel) {
  if (!root) return;
  let d = 0;
  $$(sel, root).forEach(el => {
    if (!revealer) { el.classList.add('in'); return; }
    el.classList.add('sr'); el.style.setProperty('--d', (d++) % 5); revealer.observe(el);
  });
}
function countUps(root) {
  /* telt pas op zodra het blok in beeld is geschoven, en schrijft alleen bij een nieuwe waarde */
  $$('.cu', root).forEach(el => {
    const to = +el.dataset.to || 0, ms = 1500;
    let t0 = 0, last = -1;
    const tick = now => {
      if (!el.isConnected) return;
      const host = el.closest('.sr, .in');
      if (!t0) {
        if (host && !host.classList.contains('in')) return void setTimeout(() => requestAnimationFrame(tick), 250);
        t0 = now + 450;
      }
      const k = clamp((now - t0) / ms, 0, 1), v = Math.round(to * (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k)));
      if (v !== last) { last = v; el.textContent = v; }
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
let scrollJob = 0;
function scrollToY(y, ms = 900) {
  const job = ++scrollJob, y0 = window.scrollY, t0 = performance.now();
  if (document.hidden || ms <= 0) { window.scrollTo(0, y); return Promise.resolve(); }
  const ease = k => (k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  return new Promise(res => {
    const step = now => {
      if (job !== scrollJob) return res();
      const k = clamp((now - t0) / ms, 0, 1);
      window.scrollTo(0, y0 + (y - y0) * ease(k));
      if (k < 1) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });
}
['touchstart', 'wheel'].forEach(ev => addEventListener(ev, () => { scrollJob++; }, { passive: true }));

/* Het verhaal schuift als een vel over het landschap: het landschap krimpt en dimt mee.
   Alleen transform en opacity, rechtstreeks op de elementen: dat blijft soepel op een iPhone. */
let moveTimer = 0;
function holdScene(shell) {
  if (!shell) return;
  shell.classList.add('moving');
  clearTimeout(moveTimer);
  moveTimer = setTimeout(() => shell.classList.remove('moving'), 180);
}
let scrollTick = false;
function onScroll() {
  scrollTick = false;
  if (S.tab !== 'vandaag') return;
  const shell = $('.scene-shell');
  if (!shell) return;
  const h = shell.offsetHeight || 1, k = clamp(window.scrollY / (h * .85), 0, 1);
  if (shell._k === k) return;
  shell._k = k;
  holdScene(shell);
  $('.scene-deck', shell).style.transform = 'scale(' + (1 - .08 * k).toFixed(4) + ') translate3d(0,' + (-2.5 * k).toFixed(2) + '%,0)';
  $('.scene-dim', shell).style.opacity = (.6 * k).toFixed(3);
  const ui = clamp(1 - k * 2.4, 0, 1), nav = $('.scene-navigation', shell);
  $('.scene-top', shell).style.opacity = ui.toFixed(3);
  nav.style.opacity = ui.toFixed(3);
  nav.style.visibility = ui === 0 ? 'hidden' : ''; /* onzichtbare pijlen mogen niet tikbaar blijven */
  shell.classList.toggle('covered', k >= 1);
}
addEventListener('scroll', () => { if (!scrollTick) { scrollTick = true; requestAnimationFrame(onScroll); } }, { passive: true });

/* Uitklappers: hoogte animeren met de Web Animations API (werkt ook in Safari op iPhone). */
function toggleDetails(d) {
  const fold = $(':scope > .fold', d);
  if (!fold || !fold.animate) { d.open = !d.open; d.classList.toggle('is-open', d.open); return; }
  const h0 = d._anim ? fold.getBoundingClientRect().height : null;
  if (d._anim) d._anim.cancel();
  const opening = !d.open || d.classList.contains('closing');
  const easing = 'cubic-bezier(.2,.8,.2,1)';
  if (opening) {
    d.open = true; d.classList.remove('closing'); d.classList.add('is-open');
    d._anim = fold.animate([{ height: (h0 || 0) + 'px', opacity: h0 ? .6 : 0 }, { height: fold.scrollHeight + 'px', opacity: 1 }], { duration: 520, easing });
    d._anim.onfinish = () => { d._anim = null; };
  } else {
    d.classList.add('closing'); d.classList.remove('is-open');
    d._anim = fold.animate([{ height: (h0 != null ? h0 : fold.offsetHeight) + 'px', opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 380, easing });
    d._anim.onfinish = () => { d.open = false; d.classList.remove('closing'); d._anim = null; };
  }
}

/* ---------- Vandaag: één beeldvullende pagina per dag ---------- */
function slideHtml(c) {
  const st = c.style, place = c.place;
  let kicker = 'Dag ' + (c.i + 1) + ' van ' + c.n;
  if (c.isToday) kicker = 'Vandaag · dag ' + (c.i + 1) + ' van ' + c.n;
  if (c.beforeTrip && c.i === 0) { const n = diffDays(c.td, S.trip.start); kicker = 'Nog ' + n + ' ' + (n === 1 ? 'nachtje' : 'nachtjes') + ' slapen'; }
  if (c.afterTrip && c.i === c.n - 1) kicker = 'De reis zit erop';

  let progress = '';
  if (c.stay) {
    const dots = Array.from({ length: c.nights }, (_, k) => '<i class="' + (k < c.nightNo - 1 ? 'done' : k === c.nightNo - 1 ? 'now' : '') + '"></i>').join('');
    const label = c.isToday ? (c.nightsLeft > 1 ? 'Nog ' + c.nightsLeft + ' nachten hier' : 'Laatste nacht hier') : 'Nacht ' + c.nightNo + ' van ' + c.nights;
    progress = '<div class="stay-progress rv" style="--i:9"><span class="nights" aria-hidden="true">' + dots + '</span><span>' + label + '</span></div>';
  }

  const move = c.d.legs.length
    ? '<strong>' + icon('route') + dur(c.min) + '</strong><small>' + Math.round(c.km) + ' km onderweg</small>'
    : '<strong>' + icon('leaf') + 'Vrije dag</strong><small>Geen rit gepland</small>';
  let third;
  if (c.home) { const f = flights().find(f => f.date === c.date); third = '<strong>' + icon('plane') + esc(f && f.dep ? f.dep : '—') + '</strong><small>' + esc(f && f.nr ? 'Vlucht ' + f.nr : 'Terugvlucht') + '</small>'; }
  else if (c.arrival && c.stay.checkin) third = '<strong>' + icon('bed') + esc(c.stay.checkin) + '</strong><small>Inchecken vanaf</small>';
  else third = '<strong>' + icon('moon') + c.nightsLeft + '</strong><small>' + (c.nightsLeft === 1 ? 'Laatste nacht' : 'Nachten te gaan') + '</small>';

  return '<article class="destination scene-' + st.type + ' v' + c.variant + '" data-slide="' + c.i + '" role="group" aria-roledescription="dag" aria-label="Dag ' + (c.i + 1) + ' van ' + c.n + ': ' + esc(c.name) + '" style="--scene-sky:' + st.sky + ';--scene-ink:' + st.ink + '">'
    + '<div class="scene-art">' + illustration(st.type, 'day-' + c.i) + '</div><div class="scene-tint"></div>'
    + '<div class="scene-night"><div class="stars"></div></div><div class="scene-fx"></div><div class="scene-shade"></div>'
    + '<div class="destination-heading"><div class="scene-kicker rv" style="--i:0">' + esc(kicker) + '</div>'
    + '<h1 aria-label="' + esc(c.name) + '" style="--len:' + Math.max(5, [...c.name].length) + '">' + letters(c.name) + '</h1>'
    + '<span class="destination-dates rv" style="--i:8">' + icon('calendar') + fmt(c.date) + '</span></div>'
    + '<div class="scene-bottom">' + progress
    + '<div class="scene-facts rv" style="--i:11"><div><strong class="big f-temp">' + icon('sun') + '<span>—°</span></strong><small class="f-cap">' + esc(place.name) + '</small></div><div>' + move + '</div><div>' + third + '</div></div>'
    + '<button class="story-cue rv" style="--i:13" data-story="1">Bekijk deze dag' + icon('down') + '</button></div></article>';
}
function renderVandaag() {
  const n = days().length, req = S.dayRequest;
  S.dayRequest = null;
  S.dayIndex = Number.isInteger(req) ? clamp(req, 0, n - 1) : todayIndex();
  S.storyFor = -1;
  $('#v-vandaag').innerHTML = '<div class="scene-shell"><header class="scene-top"><span class="scene-brand">montenegro<span>.</span></span></header>'
    + '<div class="scene-deck" tabindex="0" role="region" aria-roledescription="carrousel" aria-label="De dagen van de reis. Veeg opzij of gebruik de pijltoetsen.">' + Array.from({ length: n }, (_, i) => slideHtml(dayContext(i))).join('') + '</div>'
    + '<div class="scene-navigation"><button class="scene-arrow previous" data-step="-1" aria-label="Vorige dag">' + icon('chevron') + '</button><div class="scene-dots">' + Array.from({ length: n }, (_, i) => '<button data-jump="' + i + '" aria-label="Dag ' + (i + 1) + '"><span></span></button>').join('') + '</div><button class="scene-arrow" data-step="1" aria-label="Volgende dag">' + icon('chevron') + '</button></div>'
    + '<div class="scene-dim"></div><div id="scene-announcement" class="sr-only" role="status" aria-live="polite"></div></div>'
    + '<div id="story" class="story" tabindex="-1"></div>';
  bindDeck();
  activateDay(S.dayIndex, false);
  onScroll();
}
function bindDeck() {
  const deck = $('.scene-deck'), controller = new AbortController(), opt = { passive: true, signal: controller.signal };
  const slides = $$('.destination', deck).map(el => ({ head: $('.destination-heading', el), art: $('.scene-art', el), bottom: $('.scene-bottom', el) }));
  let timer = 0, raf = 0, width = deck.clientWidth;
  D.hold = Date.now() + 700; D.goal = null;
  deck.scrollLeft = S.dayIndex * width;
  const parallax = () => {
    raf = 0;
    const w = deck.clientWidth;
    if (!w) return;
    const pos = deck.scrollLeft / w;
    slides.forEach((o, i) => {
      const p = i - pos, a = Math.abs(p);
      if (a > 1.5) return;
      o.head.style.transform = 'translate3d(' + (p * -120).toFixed(1) + 'px,0,0)';
      o.head.style.opacity = clamp(1 - a * 1.5, 0, 1).toFixed(3);
      o.bottom.style.transform = 'translate3d(' + (p * -50).toFixed(1) + 'px,0,0)';
      o.bottom.style.opacity = clamp(1 - a * 1.7, 0, 1).toFixed(3);
      o.art.style.transform = 'translate3d(' + (p * 6).toFixed(2) + '%,0,0) scale(1.13)';
    });
  };
  const settle = () => {
    const w = deck.clientWidth;
    if (!w) return;
    /* Een sprong via pijl, stip of "morgen" heeft een doel: hapert de vloeiende scroll (iOS + scroll-snap), dan telt het doel en niet de tussenstand. */
    if (D.goal != null) { const g = D.goal; D.goal = null; if (Math.abs(deck.scrollLeft - g * w) > 2) deck.scrollTo({ left: g * w, behavior: 'instant' }); return; }
    /* Vlak na laden of draaien houdt de carrousel de gekozen dag vast, wat de layout ook doet. */
    if (Date.now() < D.hold) { if (Math.abs(deck.scrollLeft - S.dayIndex * w) > 2) deck.scrollTo({ left: S.dayIndex * w, behavior: 'instant' }); return; }
    activateDay(Math.round(deck.scrollLeft / w), true);
  };
  deck.addEventListener('touchstart', () => { D.goal = null; }, opt); /* een echte veeg gaat voor op een lopende sprong */
  deck.addEventListener('scroll', () => { holdScene(deck.parentElement); D.lastScroll = Date.now(); clearTimeout(timer); timer = setTimeout(settle, 90); if (!raf) raf = requestAnimationFrame(parallax); }, opt);
  deck.addEventListener('keydown', e => {
    if (e.target !== deck) return;
    const n = days().length;
    const to = e.key === 'ArrowRight' ? S.dayIndex + 1 : e.key === 'ArrowLeft' ? S.dayIndex - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
    if (to != null) { e.preventDefault(); goDay(to); }
  }, { signal: controller.signal });
  const observer = 'ResizeObserver' in window ? new ResizeObserver(() => {
    if (deck.clientWidth === width) return;
    width = deck.clientWidth; D.hold = Date.now() + 500;
    deck.scrollTo({ left: S.dayIndex * width, behavior: 'instant' });
    parallax();
  }) : null;
  if (observer) observer.observe(deck);
  parallax();
  D.cleanup = () => { controller.abort(); if (observer) observer.disconnect(); clearTimeout(timer); };
}
function goDay(index) {
  const deck = $('.scene-deck');
  if (!deck) return;
  const n = clamp(index, 0, days().length - 1);
  D.hold = 0;
  activateDay(n, true);
  D.goal = n;
  deck.scrollTo({ left: n * deck.clientWidth, behavior: 'smooth' });
  /* vangnet: komt de vloeiende scroll niet aan (onderbroken, venster verborgen), zet de carrousel dan alsnog goed */
  clearTimeout(D.fix);
  D.fix = setTimeout(() => {
    const w = deck.clientWidth;
    if (!deck.isConnected || S.dayIndex !== n || Date.now() - (D.lastScroll || 0) < 200) return;
    D.goal = null;
    if (Math.abs(deck.scrollLeft - n * w) > 2) deck.scrollTo({ left: n * w, behavior: 'instant' });
  }, 1100);
}
function activateDay(index, announce) {
  const total = days().length, n = clamp(index, 0, total - 1);
  if (S.storyFor === n) return;
  S.dayIndex = n; S.storyFor = n;
  $$('.destination').forEach((el, i) => {
    el.classList.toggle('selected', i === n);
    el.classList.toggle('near', Math.abs(i - n) <= 1);
    el.setAttribute('aria-hidden', String(i !== n));
    const cue = $('.story-cue', el);
    if (cue) cue.tabIndex = i === n ? 0 : -1;
  });
  $$('.scene-dots button').forEach((b, i) => { b.classList.toggle('active', i === n); b.setAttribute('aria-current', String(i === n)); });
  $('.scene-arrow.previous').disabled = n === 0;
  $('.scene-arrow:not(.previous)').disabled = n === total - 1;
  const c = dayContext(n);
  if (announce) $('#scene-announcement').textContent = 'Dag ' + (n + 1) + ' van ' + total + ': ' + c.name + ', ' + fmt(c.date);
  renderStory(c);
  syncChrome();
  /* het weer van deze dag en de buren alvast ophalen, zodat vegen meteen klopt */
  [n, n + 1, n - 1].filter(i => i >= 0 && i < total).forEach(i => { const cx = i === n ? c : dayContext(i); loadWeather(cx.place).then(w => paintWeather(cx, w)); });
}
function paintWeather(c, w) {
  const el = $('[data-slide="' + c.i + '"]');
  if (!el) return;
  const dw = dayWeather(c, w), t = $('.f-temp', el), cap = $('.f-cap', el);
  if (dw) {
    t.innerHTML = icon(dw.info.icon) + '<span>' + Math.round(dw.temp) + '°</span>';
    cap.textContent = (dw.live ? 'Nu · ' : 'Verwacht · ') + dw.info.label;
  } else cap.textContent = w ? 'Nog geen verwachting' : 'Weer niet beschikbaar';
  const force = (Q.get('fx') || '').split(',').filter(Boolean);
  const fx = force.find(f => FX.includes(f)) || (force.length ? '' : dw ? dw.info.fx : '');
  applyFx(el, fx, force.includes('night') || (!force.length && dw && dw.night));
  if (c.i === S.dayIndex) paintStoryWeather(c, w, dw);
}

/* ---------- het verhaal van de dag ---------- */
function legsHtml(legs) {
  return '<div class="journey-story">' + legs.map(l => '<div class="journey-entry"><div class="journey-endpoints"><span>' + esc(l.fromName) + '</span>' + icon('arrow') + '<strong>' + esc(l.toName) + '</strong></div>'
    + '<div class="journey-drawing" aria-hidden="true"><svg viewBox="0 0 500 94"><path class="route-base" pathLength="1" d="M14 62C101-4 136 126 249 47S395 83 482 27" fill="none" stroke="#d5d7c7" stroke-width="2"/><path class="route-dash" d="M14 62C101-4 136 126 249 47S395 83 482 27" fill="none" stroke="#477c6b" stroke-width="2" stroke-dasharray="6 8"/><circle cx="14" cy="62" r="7" fill="#f4f0e8" stroke="#477c6b" stroke-width="2"/><circle cx="482" cy="27" r="7" fill="#b86f50"/><circle class="route-car" r="5.5" fill="#b86f50" stroke="#f4f0e8" stroke-width="2"/></svg></div>'
    + '<div class="journey-numbers"><strong><b class="cu" data-to="' + Math.round(l.km) + '">0</b><span> km</span></strong><strong>' + dur(l.min) + '<span> rijden</span></strong></div></div>').join('') + '</div>';
}
const flightHtml = f => '<div class="flight">' + icon('plane') + '<div class="flight-body"><div class="flight-number">' + esc(f.nr || 'Vlucht') + '</div><div class="flight-route">' + esc(f.from || 'Vertrek') + ' <span aria-hidden="true">→</span> ' + esc(f.to || 'Bestemming') + '</div><div class="flight-times">' + (f.date ? fmtShort(f.date) + ' · ' : '') + esc(f.dep || '—') + ' – ' + esc(f.arr || '—') + '</div></div></div>';
const secHtml = (eyebrow, title) => '<div class="sec"><div class="eyebrow">' + esc(eyebrow) + '</div><h3>' + esc(title) + '</h3></div>';

function stayCardHtml(c) {
  const s = c.stay, dots = Array.from({ length: c.nights }, (_, k) => '<i class="' + (k < c.nightNo - 1 ? 'done' : k === c.nightNo - 1 ? 'now' : '') + '"></i>').join('');
  const after = c.next && c.next.stay && c.next.stay.id !== s.id ? c.next.stay.name : null;
  const leaving = S.trip.stays.findIndex(x => x.id === s.id) === S.trip.stays.length - 1 ? 'naar huis' : null;
  let big, text;
  if (c.isToday) {
    big = c.nightsLeft > 1 ? 'Nog ' + c.nightsLeft + ' <small>nachten in ' + esc(s.name) + '</small>' : 'Laatste <small>nacht in ' + esc(s.name) + '</small>';
    text = 'Dag ' + c.nightNo + ' van ' + c.nights + ' hier. Vertrek op ' + fmt(s.to) + (s.checkout ? ', uitchecken vóór ' + esc(s.checkout) : '') + '.';
  } else {
    big = 'Nacht ' + c.nightNo + ' <small>van ' + c.nights + ' in ' + esc(s.name) + '</small>';
    text = compactDate(s.from, s.to) + (c.future ? ' · over ' + diffDays(c.td, c.date) + (diffDays(c.td, c.date) === 1 ? ' dag' : ' dagen') : '') + '.';
  }
  const nextDay = c.nightsLeft === 1 ? (after ? 'Morgen door naar ' + esc(after) + '.' : leaving ? 'Morgen ' + leaving + '.' : '') : '';
  return '<div class="block stay-card' + (c.future ? ' upcoming' : c.past ? ' past' : '') + '"><div class="big">' + big + '</div><p>' + text + (nextDay ? ' ' + nextDay : '') + '</p><div class="nights" aria-hidden="true">' + dots + '</div></div>';
}
function featuredHtml(c) {
  const a = c.stay && c.stay.about;
  if (!a || !a.facts || !a.facts.length) return '';
  const k = c.nightNo - 1, fact = a.facts[k % a.facts.length];
  const moment = a.history && a.history.length ? a.history[Math.floor((k + .5) * a.history.length / Math.max(1, c.nights)) % a.history.length] : null;
  const pool = k % 2 === 0 ? a.nearby : a.taste, extra = pool && pool.length ? pool[Math.floor(k / 2) % pool.length] : null;
  let h = '<div class="block">' + secHtml('Uitgelicht op dag ' + (c.i + 1), 'Weetje van de dag')
    + '<article class="fact feature"><span class="idx">' + esc(c.stay.name) + '</span><h4>' + esc(fact.title) + '</h4><p>' + esc(fact.text) + '</p></article><div class="rows">';
  if (moment) h += '<div>' + icon('book') + '<div><strong>' + esc(moment.when) + '</strong><p>' + esc(moment.text) + '</p></div></div>';
  if (extra) h += '<div>' + icon(k % 2 === 0 ? 'pin' : 'fork') + '<div><strong>' + esc(extra.name) + '</strong><p>' + esc(extra.text) + '</p></div></div>';
  return h + '</div></div>';
}
function cardsHtml(items) {
  return '<div class="cards" data-cards>' + items.map((f, i) => '<article class="fact"><span class="idx">' + pad(i + 1) + ' / ' + pad(items.length) + '</span><h4>' + esc(f.title) + '</h4><p>' + esc(f.text) + '</p></article>').join('') + '</div><div class="cards-dots" aria-hidden="true">' + items.map((_, i) => '<i' + (i ? '' : ' class="on"') + '></i>').join('') + '</div>';
}
const rowsHtml = (items, ic, key) => '<div class="rows">' + items.map(x => '<div>' + icon(ic) + '<div><strong>' + esc(x[key]) + '</strong><p>' + esc(x.text) + '</p></div></div>').join('') + '</div>';
/* De feitjes over een plek of over het land. Alle tekst komt uit de versleutelde reisgegevens. */
function aboutHtml(a, country) {
  if (!a) return '';
  let h = '<div class="block"><p class="about-intro">' + esc(a.intro || '') + '</p>';
  if (a.knownFor && a.knownFor.length) h += '<div class="chips">' + a.knownFor.map(x => '<span class="chip">' + esc(x) + '</span>').join('') + '</div>';
  if (a.season) h += '<div class="season">' + icon('leaf') + '<span>' + esc(a.season) + '</span></div>';
  h += '</div>';
  if (a.numbers && a.numbers.length) h += '<div class="block">' + secHtml('In cijfers', country ? 'Het land in getallen' : 'De plek in getallen') + '<div class="numbers">' + a.numbers.map(x => '<div class="number"><strong>' + esc(x.value) + '</strong><span>' + esc(x.label) + '</span></div>').join('') + '</div></div>';
  if (a.facts && a.facts.length) h += '<div class="block">' + secHtml('Weetjes', 'Om na te vertellen') + cardsHtml(a.facts) + '</div>';
  if (a.history && a.history.length) h += '<div class="block">' + secHtml('Historie', 'Hoe het zo gekomen is') + '<div class="timeline">' + a.history.map(m => '<div class="moment"><b>' + esc(m.when) + '</b><p>' + esc(m.text) + '</p></div>').join('') + '</div></div>';
  if (a.phrases && a.phrases.length) h += '<div class="block">' + secHtml('Taal', 'Een paar woorden') + '<div class="phrases">' + a.phrases.map(p => '<div class="phrase"><strong>' + esc(p.mne) + '</strong><span>' + esc(p.nl) + '</span><em>' + esc(p.say) + '</em></div>').join('') + '</div></div>';
  if (a.taste && a.taste.length) h += '<div class="block">' + secHtml('Op tafel', country ? 'Wat er gegeten wordt' : 'Typisch van hier') + rowsHtml(a.taste, 'fork', 'name') + '</div>';
  if (a.nearby && a.nearby.length) h += '<div class="block">' + secHtml('In de buurt', 'Vlak om de hoek') + rowsHtml(a.nearby, 'pin', 'name') + '</div>';
  if (a.practical && a.practical.length) h += '<div class="block">' + secHtml('Praktisch', 'Goed om te weten') + rowsHtml(a.practical, 'check', 'title') + '</div>';
  return h;
}
function renderStory(c) {
  const el = $('#story'), t = S.trip, s = c.stay;
  const until = diffDays(c.td, c.date);
  const eyebrow = c.isToday ? 'Vandaag' : c.past ? 'Terugblik' : until === 1 ? 'Morgen' : 'Over ' + until + ' dagen';
  const sub = c.home ? 'De terugreis' : c.arrival ? 'Aankomst in ' + s.name : 'Dag ' + c.nightNo + ' van ' + c.nights + ' in ' + s.name;
  let h = '<div class="story-inner"><div class="eyebrow">' + eyebrow + ' · dag ' + (c.i + 1) + ' van ' + c.n + '</div><div class="story-title"><h2>' + fmt(c.date) + '</h2><span>' + esc(sub) + '</span></div>';
  if (s) h += stayCardHtml(c);

  const when = c.isToday ? 'vandaag' : 'deze dag';
  h += '<div class="block">' + secHtml('Onderweg', c.d.legs.length ? 'De rit van ' + when : 'Geen kilometers ' + when);
  h += c.d.legs.length ? legsHtml(c.d.legs) : '<div class="rest-note">' + icon('leaf') + '<span>Er staat geen rit gepland. De auto mag blijven staan.</span></div>';
  h += '</div>';

  let lines = '';
  if (c.prev && c.prev.checkout) lines += '<div class="practical-line">' + icon('logout') + '<span>Uitchecken ' + esc(c.prev.name) + '</span><strong>vóór ' + esc(c.prev.checkout) + '</strong></div>';
  if (c.arrival && s.checkin) lines += '<div class="practical-line">' + icon('bed') + '<span>Inchecken ' + esc(s.name) + (s.kind ? ' · ' + esc(s.kind.toLowerCase()) : '') + '</span><strong>vanaf ' + esc(s.checkin) + '</strong></div>';
  const fl = flights().filter(f => f.date === c.date);
  lines += fl.map(flightHtml).join('');
  const last = c.d.legs[c.d.legs.length - 1];
  if (c.home && last && fl[0] && /^\d{1,2}:\d{2}$/.test(fl[0].dep || '')) {
    const [hh, mm] = fl[0].dep.split(':').map(Number), v = hh * 60 + mm - 120 - 45 - last.min;
    if (v > 0) lines += '<div class="departure-alert">' + icon('clock') + '<div>Vertrek uiterlijk<strong>' + pad(Math.floor(v / 60)) + ':' + pad(Math.round(v % 60)) + '</strong><small>' + esc((t.info && t.info.departNote) || 'Gerekend met 2 uur op de luchthaven, de rijtijd en 45 minuten marge.') + '</small></div></div>';
  }
  if (lines) h += '<div class="block">' + secHtml('Tijden', 'Om rekening mee te houden') + lines + '</div>';

  h += '<div class="block">' + secHtml('Het weer', (c.isToday ? 'Nu in ' : 'In ') + c.place.name) + '<div id="wxbox"><div class="wx-empty">Weer laden…</div></div>'
    + '<button class="loc-chip" id="locbtn">' + icon('pin') + '<span id="afstand">Hoe ver is ' + esc(c.place.name) + ' hiervandaan?</span></button></div>';

  if (s) {
    h += '<div class="block notes"><div class="notes-head">' + icon('note') + '<label for="note-' + s.id + '">Notities bij ' + esc(s.name) + '</label><span class="notes-saved">' + icon('check') + 'Bewaard</span></div>'
      + '<textarea id="note-' + s.id + '" data-note="' + s.id + '" rows="3">' + esc(noteOf(s.id)) + '</textarea><small>Blijft alleen op dit toestel staan.</small></div>';
    h += featuredHtml(c);
    if (s.about) h += '<div class="block about-head">' + secHtml('Over deze plek', s.about.name || s.name) + '</div>' + aboutHtml(s.about, false);
  } else {
    const km = t.legs.reduce((a, l) => a + l.km, 0), mn = t.legs.reduce((a, l) => a + l.min, 0);
    h += '<div class="block">' + secHtml('De reis in getallen', 'Alles bij elkaar') + '<div class="numbers"><div class="number"><strong><b class="cu" data-to="' + Math.round(km) + '">0</b> km</strong><span>gereden volgens de planner</span></div><div class="number"><strong>' + dur(mn) + '</strong><span>achter het stuur</span></div><div class="number"><strong>' + t.stays.length + '</strong><span>plekken om te slapen</span></div><div class="number"><strong>' + (c.n - 1) + '</strong><span>nachten van huis</span></div></div></div>';
  }
  h += '</div>';

  if (c.next) {
    const nx = dayContext(c.i + 1);
    const what = nx.d.legs.length ? Math.round(nx.km) + ' km · ' + dur(nx.min) + (nx.home ? ' naar de luchthaven' : ' naar ' + nx.name) : 'Nog een dag in ' + nx.name;
    h += '<button class="next-destination" data-open-day="' + nx.i + '" style="--scene-sky:' + nx.style.sky + '"><div class="teaser-art">' + illustration(nx.style.type, 'next-' + c.i) + '</div><div class="teaser-shade"></div><div class="copy"><span>' + (c.isToday ? 'Morgen' : 'De dag erna') + ' · ' + fmtShort(nx.date) + '</span><strong>' + esc(nx.name) + '</strong><small>' + esc(what) + '</small></div><span class="teaser-arrow">' + icon('arrow') + '</span></button>';
  }
  el.classList.toggle('has-next', !!c.next);
  el.innerHTML = h;
  reveal(el, '.story-title, .block, .moment, .number, .next-destination');
  countUps(el);
  bindCards(el);
  $$('textarea[data-note]', el).forEach(autoGrow);
  updateDistance();
}
function paintStoryWeather(c, w, dw) {
  const box = $('#wxbox');
  if (!box) return;
  if (!w) { box.innerHTML = '<div class="wx-empty">Het weer is nu niet op te halen. Zodra er verbinding is, verschijnt het hier.</div>'; return; }
  let h = '';
  if (dw) {
    h += '<div class="wx-now"><div class="wx-temp">' + Math.round(dw.temp) + '°</div><div class="wx-cond"><strong>' + icon(dw.info.icon) + dw.info.label + '</strong><span>' + (dw.live ? 'Gevoelstemperatuur ' + Math.round(dw.feels) + '°' : 'Verwachte maximumtemperatuur') + '</span></div></div><div class="wx-meta">';
    if (dw.max != null) h += '<div>' + icon('thermo') + 'Max / min<b>' + Math.round(dw.max) + '° / ' + Math.round(dw.min) + '°</b></div>';
    if (dw.rain != null) h += '<div>' + icon('drop') + 'Kans op regen<b>' + Math.round(dw.rain) + '%</b></div>';
    if (dw.wind != null) h += '<div>' + icon('wind') + 'Wind<b>' + Math.round(dw.wind) + ' km/u</b></div>';
    if (dw.uv != null) h += '<div>' + icon('uv') + 'Uv-index<b>' + Math.round(dw.uv) + '</b></div>';
    if (dw.sunrise) h += '<div>' + icon('sunrise') + 'Zon op<b>' + dw.sunrise + '</b></div><div>' + icon('sunset') + 'Zon onder<b>' + dw.sunset + '</b></div>';
    if (dw.sea != null) h += '<div>' + icon('waves') + 'Zeewater' + (dw.live ? '' : ' nu') + '<b>' + Math.round(dw.sea) + '°</b></div>';
    h += '</div>';
  } else h += '<div class="wx-empty">Voor deze dag is er nog geen verwachting. Die komt maximaal zestien dagen vooruit beschikbaar.</div>';
  /* de dagen op deze plek, met deze dag gemarkeerd */
  const from = c.stay ? c.stay.from : c.date, to = c.stay ? c.stay.to : c.date;
  const strip = w.daily.time.map((d, i) => ({ d, i })).filter(x => x.d >= from && x.d <= to);
  if (strip.length > 1) h += '<div class="wx-strip">' + strip.map(x => {
    const info = wxInfo(w.daily.weather_code[x.i], false);
    return '<div class="wx-day' + (x.d === c.date ? ' today' : '') + '"><b>' + fmt(x.d, { weekday: 'short' }) + ' ' + asDate(x.d).getUTCDate() + '</b>' + icon(info.icon) + '<strong>' + Math.round(w.daily.temperature_2m_max[x.i]) + '°</strong><em>' + Math.round(w.daily.temperature_2m_min[x.i]) + '°</em><small>' + icon('drop') + Math.round(w.daily.precipitation_probability_max[x.i] ?? 0) + '%</small></div>';
  }).join('') + '</div>';
  box.innerHTML = h;
}
function bindCards(root) {
  $$('[data-cards]', root).forEach(cards => {
    const dots = $$('i', cards.nextElementSibling);
    let raf = 0;
    cards.addEventListener('scroll', () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const first = cards.firstElementChild;
        if (!first) return;
        const step = first.offsetWidth + 14, idx = clamp(Math.round(cards.scrollLeft / step), 0, dots.length - 1);
        dots.forEach((d, i) => d.classList.toggle('on', i === idx));
      });
    }, { passive: true });
  });
}
function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.max(96, ta.scrollHeight) + 'px'; }

/* ---------- locatie ---------- */
function updateDistance() {
  const el = $('#afstand');
  if (!el || !S.trip) return;
  const c = dayContext(S.dayIndex);
  if (!S.pos) { el.textContent = ls.get('loc', false) ? 'Locatie zoeken…' : 'Hoe ver is ' + c.place.name + ' hiervandaan?'; return; }
  const km = hav(S.pos, [c.place.lat, c.place.lng]);
  el.textContent = km < 1 ? 'Je bent in ' + c.place.name : c.place.name + ' ligt ' + (km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)) + ' km hiervandaan (hemelsbreed)';
}
function startLocation() {
  if (!navigator.geolocation) { const el = $('#afstand'); if (el) el.textContent = 'Dit toestel deelt geen locatie'; return; }
  if (S.watch != null) return;
  ls.set('loc', true);
  updateDistance();
  S.watch = navigator.geolocation.watchPosition(p => { S.pos = [p.coords.latitude, p.coords.longitude]; updateDistance(); }, e => {
    const el = $('#afstand');
    if (el) el.textContent = e.code === 1 ? 'Locatie staat uit voor deze app. Zet hem aan in de instellingen van je browser.' : 'Locatie nog niet gevonden, we blijven zoeken…';
    if (e.code === 1) { ls.set('loc', false); navigator.geolocation.clearWatch(S.watch); S.watch = null; }
  }, { enableHighAccuracy: false, maximumAge: 60000, timeout: 30000 });
}

/* ---------- Reis ---------- */
function renderReis() {
  const t = S.trip, ds = days(), td = todayStr(), idx = ds.findIndex(d => d.date === td);
  const km = t.legs.reduce((a, l) => a + l.km, 0), mn = t.legs.reduce((a, l) => a + l.min, 0);
  const k = td < t.start ? 0 : td > t.end ? 1 : (idx + 1) / ds.length;
  const status = td < t.start ? 'Nog ' + diffDays(td, t.start) + (diffDays(td, t.start) === 1 ? ' dag' : ' dagen') : td > t.end ? 'Afgelopen' : 'Dag ' + (idx + 1) + ' van ' + ds.length;
  let h = '<div class="page"><header class="app-header"><span class="wordmark">montenegro<span>.</span></span><span class="header-caption">Samen op pad</span></header>'
    + '<div class="page-heading"><div class="eyebrow">' + compactDate(t.start, t.end) + '</div><h1>Onze reis</h1></div>'
    + '<div class="trip-progress" style="--k:' + k.toFixed(3) + '"><div class="row"><strong>' + status + '</strong><span>' + esc(t.title) + '</span></div><div class="bar"><i></i></div></div>'
    + '<div class="stats"><div><strong><b class="cu" data-to="' + Math.round(km) + '">0</b></strong><span>km</span></div><div><strong>' + Math.round(mn / 60) + '</strong><span>uur rijden</span></div><div><strong>' + (ds.length - 1) + '</strong><span>nachten</span></div><div><strong>' + t.stays.length + '</strong><span>plekken</span></div></div>';

  const fOut = flights().find(f => f.date === t.start), fBack = flights().find(f => f.date === t.end);
  const connector = l => '<div class="connector">' + icon('route') + '<span><b>' + Math.round(l.km) + ' km</b> · ' + dur(l.min) + ' rijden · ' + fmtShort(l.date) + '</span></div>';
  if (fOut) h += '<div class="waypoint"><span class="dot">' + icon('plane') + '</span><div>' + esc(fOut.from || '') + ' → ' + esc(fOut.to || '') + '<small>' + fmtShort(fOut.date) + ' · ' + esc(fOut.dep || '') + ' – ' + esc(fOut.arr || '') + (fOut.nr ? ' · ' + esc(fOut.nr) : '') + '</small></div></div>';
  t.stays.forEach((s0, i) => {
    const s = stayOf(s0), st = sceneStyle(s, i), arrive = t.legs.find(l => l.date === s.from);
    if (arrive) h += connector(arrive);
    const now = td >= s.from && td < s.to, until = diffDays(td, s.from);
    const badge = now ? '<span class="badge now">Nu hier</span>' : td < s.from ? '<span class="badge">Over ' + until + (until === 1 ? ' dag' : ' dagen') + '</span>' : '<span class="badge">Geweest</span>';
    const open = now ? ds.findIndex(d => d.date === td) : ds.findIndex(d => d.date === s.from);
    h += '<button class="location-tile" data-open-day="' + open + '" style="--scene-sky:' + st.sky + '" aria-label="Open ' + esc(s.name) + '"><div class="teaser-art">' + illustration(st.type, 'tile-' + i) + '</div><div class="teaser-shade"></div><span class="num">' + pad(i + 1) + '</span>' + badge + '<div class="tile-copy"><div><strong>' + esc(s.name) + '</strong><small>' + compactDate(s.from, s.to) + ' · ' + diffDays(s.from, s.to) + (diffDays(s.from, s.to) === 1 ? ' nacht' : ' nachten') + '</small></div>' + icon('arrow') + '</div></button>';
  });
  const lastLeg = t.legs.find(l => l.date === t.end);
  if (lastLeg) h += connector(lastLeg);
  if (fBack) h += '<div class="waypoint"><span class="dot">' + icon('home') + '</span><div>' + esc(fBack.from || '') + ' → ' + esc(fBack.to || '') + '<small>' + fmtShort(fBack.date) + ' · ' + esc(fBack.dep || '') + ' – ' + esc(fBack.arr || '') + (fBack.nr ? ' · ' + esc(fBack.nr) : '') + '</small></div></div>';

  h += '<div class="agenda"><div class="eyebrow">Dag voor dag</div>';
  ds.forEach((d, i) => {
    const c = dayContext(i);
    const what = d.legs.length ? d.legs.map(l => Math.round(l.km) + ' km').join(' + ') + ' · ' + dur(c.min) : 'vrije dag';
    h += '<button class="day-row' + (c.isToday ? ' today' : c.past ? ' past' : '') + '" data-open-day="' + i + '"><span class="agenda-number">' + pad(i + 1) + '</span><span class="agenda-copy"><strong>' + fmt(d.date) + (c.isToday ? ' · vandaag' : '') + '</strong><small>' + esc(c.name) + ' · ' + what + '</small></span>' + icon('chevron') + '</button>';
  });
  h += '</div></div>';
  const el = $('#v-reis');
  el.innerHTML = h;
  reveal(el, '.page-heading, .trip-progress, .stats, .waypoint, .connector, .location-tile, .day-row');
  countUps(el);
}

/* ---------- Ontdek: het land ---------- */
function renderOntdek() {
  const a = S.trip.country, el = $('#v-ontdek');
  let h = '<div class="page"><div class="banner"><div class="teaser-art">' + illustration('bay', 'land') + '</div><div class="teaser-shade"></div><div><div class="eyebrow">Het land</div><h1>' + esc(a && a.name ? a.name : 'Ontdek') + '</h1></div></div>';
  h += a ? aboutHtml(a, true) : '<p class="muted">De achtergrondverhalen zijn nog niet toegevoegd aan de reisgegevens.</p>';
  h += '</div>';
  el.innerHTML = h;
  reveal(el, '.block, .moment, .number, .phrase');
  bindCards(el);
}

/* ---------- Info ---------- */
const foldOpen = (summary, body) => '<details class="edit"><summary>' + icon('edit') + summary + '<span class="plus"></span></summary><div class="fold"><div class="fold-inner">' + body + '</div></div></details>';
function renderInfo() {
  let h = '<div class="page"><header class="app-header"><span class="wordmark">montenegro<span>.</span></span><span class="header-caption">Goed voorbereid</span></header><div class="page-heading"><div class="eyebrow">Praktisch</div><h1>Handig voor onderweg</h1></div>';

  h += '<div class="card"><h3>Onze vluchten</h3>';
  flights().forEach((f, i) => {
    const fields = [['nr', 'Vluchtnummer', 'text'], ['date', 'Datum', 'date'], ['from', 'Van', 'text'], ['to', 'Naar', 'text'], ['dep', 'Vertrek', 'time'], ['arr', 'Aankomst', 'time']];
    h += flightHtml(f) + foldOpen('Vlucht aanpassen', '<div class="grid2">' + fields.map(([k, label, type]) => '<div><label class="f" for="fl-' + i + k + '">' + label + '</label><input class="i" id="fl-' + i + k + '" type="' + type + '" data-fl="' + i + '" data-f="' + k + '" value="' + esc(f[k] || '') + '"></div>').join('') + '</div><div class="pillrow"><button class="btn warn" data-delfl="' + i + '">Verwijder vlucht</button></div>');
  });
  h += '<div class="pillrow"><button class="btn ghost" id="addfl">Vlucht toevoegen</button></div><p class="muted" style="margin-top:12px">Wijzigingen blijven op dit toestel staan.</p></div>';

  h += '<div class="card"><h3>Verblijven</h3>';
  S.trip.stays.forEach(s0 => {
    const s = stayOf(s0);
    h += '<div class="practical-line">' + icon('bed') + '<span><strong style="font-weight:600">' + esc(s.name) + '</strong>' + (s.kind ? ' · ' + esc(s.kind.toLowerCase()) : '') + '<br><span class="muted" style="font-size:11px">' + compactDate(s.from, s.to) + '</span></span><strong>' + esc(s.checkin || '—') + ' / ' + esc(s.checkout || '—') + '</strong></div>'
      + foldOpen('Tijden aanpassen', '<div class="grid2"><div><label class="f" for="in-' + s.id + '">Inchecken vanaf</label><input class="i" id="in-' + s.id + '" type="time" data-stay="' + s.id + '" data-f="checkin" value="' + esc(s.checkin || '') + '"></div><div><label class="f" for="out-' + s.id + '">Uitchecken vóór</label><input class="i" id="out-' + s.id + '" type="time" data-stay="' + s.id + '" data-f="checkout" value="' + esc(s.checkout || '') + '"></div></div><label class="f" for="kind-' + s.id + '">Soort verblijf</label><input class="i" id="kind-' + s.id + '" data-stay="' + s.id + '" data-f="kind" value="' + esc(s.kind || '') + '">');
  });
  h += '</div>';

  /* verkeersregels, tol en noodnummers noemen plaatsen en komen daarom uit de versleutelde gegevens */
  const info = S.trip.info || {};
  if (info.driving && info.driving.length) h += '<div class="card">' + info.driving.map(b => '<h3>' + esc(b.title) + '</h3><ul class="plain">' + (b.items || []).map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>').join('') + (info.note ? '<p class="muted" style="margin-top:12px">' + esc(info.note) + '</p>' : '') + '</div>';
  if (info.emergency && info.emergency.length) h += '<div class="card"><h3>Noodnummers</h3><ul class="plain">' + info.emergency.map(x => '<li><a href="tel:' + esc(String(x.nr).replace(/[^\d+]/g, '')) + '">' + esc(x.nr) + '</a> – ' + esc(x.label) + '</li>').join('') + '</ul></div>';
  h += '<div class="card"><h3>Beheer</h3><p class="muted">De app werkt ook zonder internet zodra je hem één keer hebt geopend. Notities verlaten dit toestel nooit.</p><div class="pillrow"><button class="btn ghost" id="expbtn">Versleuteld bestand downloaden</button>' + (S.edits.flights || S.edits.stays ? '<button class="btn ghost" id="resetedits">Herstel oorspronkelijke vluchten en tijden</button>' : '') + (S.dev ? '' : '<button class="btn warn" id="lockbtn">Vergrendel dit toestel</button>') + '</div>'
    + (S.dev && !S.key ? '<label class="f" for="newpw">Nieuw wachtwoord voor de groep (minimaal 10 tekens)</label><input class="i" id="newpw" type="password" autocomplete="new-password">' : '') + '<div class="err" id="experr"></div></div></div>';
  const el = $('#v-info');
  el.innerHTML = h;
  reveal(el, '.page-heading, .card');
}
async function exportEnc() {
  const err = $('#experr');
  err.textContent = '';
  let key = S.key, salt = S.enc && S.enc.salt;
  if (!key) {
    const pw = ($('#newpw') || {}).value || '';
    if (pw.length < 10) { err.textContent = 'Kies een wachtwoord van minimaal 10 tekens.'; return; }
    const sb = crypto.getRandomValues(new Uint8Array(16));
    salt = b64e(sb); key = await deriveKey(pw, sb);
  }
  const t = JSON.parse(JSON.stringify(S.trip));
  t.stays = t.stays.map(stayOf); t.flights = flights();
  const blob = new Blob([JSON.stringify(await encryptTrip(t, key, salt))], { type: 'application/json' }), a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'trip.enc'; a.click();
  err.style.color = 'var(--olive)';
  err.textContent = 'trip.enc gedownload. Geef dit bestand aan de beheerder van de app.';
}

/* ---------- navigatie en gebeurtenissen ---------- */
const TABS = ['vandaag', 'reis', 'ontdek', 'info'];
const RENDER = { vandaag: renderVandaag, reis: renderReis, ontdek: renderOntdek, info: renderInfo };
function show(tab) {
  const go = () => {
    if (D.cleanup) { D.cleanup(); D.cleanup = null; }
    S.tab = tab; S.renderedOn = todayStr();
    $$('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + tab));
    $$('nav button').forEach(b => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    $('nav').style.setProperty('--n', TABS.indexOf(tab));
    RENDER[tab]();
    scrollJob++;
    window.scrollTo(0, 0);
    syncChrome();
  };
  if (document.startViewTransition && S.tab && S.tab !== tab) document.startViewTransition(go); else go();
}
async function openDay(i) {
  if (S.tab !== 'vandaag') { S.dayRequest = i; show('vandaag'); return; }
  if (window.scrollY > 4) await scrollToY(0, 750);
  goDay(i);
}
document.addEventListener('click', e => {
  const sum = e.target.closest('summary');
  if (sum && sum.parentElement.tagName === 'DETAILS') { e.preventDefault(); toggleDetails(sum.parentElement); return; }
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.tab) return show(b.dataset.tab);
  if (b.dataset.step) return goDay(S.dayIndex + Number(b.dataset.step));
  if (b.dataset.jump != null) return goDay(Number(b.dataset.jump));
  if (b.dataset.story) { const st = $('#story'); scrollToY(st.offsetTop, 950).then(() => st.focus({ preventScroll: true })); return; }
  if (b.dataset.openDay != null) return openDay(Number(b.dataset.openDay));
  if (b.id === 'locbtn') return startLocation();
  if (b.id === 'expbtn') return exportEnc();
  if (b.id === 'lockbtn') { ls.del('k'); location.reload(); return; }
  if (b.id === 'addfl') { S.edits.flights = flights().concat([{ nr: '', date: '', from: '', to: '', dep: '', arr: '' }]); saveEdits(); return renderInfo(); }
  if (b.id === 'resetedits') { delete S.edits.flights; delete S.edits.stays; saveEdits(); return renderInfo(); }
  if (b.dataset.delfl != null) { if (!confirm('Deze vlucht verwijderen?')) return; const f = flights().slice(); f.splice(+b.dataset.delfl, 1); S.edits.flights = f; saveEdits(); return renderInfo(); }
});
let savedTimer = 0;
document.addEventListener('input', e => {
  const x = e.target.dataset;
  if (!x) return;
  if (x.note) {
    (S.edits.notes = S.edits.notes || {})[x.note] = e.target.value; saveEdits(); autoGrow(e.target);
    const tag = $('.notes-saved', e.target.closest('.notes'));
    if (tag) { tag.classList.add('on'); clearTimeout(savedTimer); savedTimer = setTimeout(() => tag.classList.remove('on'), 1600); }
  } else if (x.stay) { const st = S.edits.stays = S.edits.stays || {}; (st[x.stay] = st[x.stay] || {})[x.f] = e.target.value; saveEdits(); }
  else if (x.fl != null) { const f = flights().map(o => Object.assign({}, o)); f[+x.fl][x.f] = e.target.value; S.edits.flights = f; saveEdits(); }
});
/* Blijft de app open staan tot de volgende dag, dan springt hij bij terugkomst naar de nieuwe dag. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !S.trip || !S.tab) return;
  if (S.renderedOn !== todayStr()) show(S.tab);
  else if (S.tab === 'vandaag') { const c = dayContext(S.dayIndex); loadWeather(c.place).then(w => paintWeather(c, w)); }
});

setInterval(() => {
  if (!S.trip || !S.tab || document.visibilityState !== 'visible' || S.renderedOn === todayStr()) return;
  if (window.scrollY < 4 && !(document.activeElement && document.activeElement.matches('input,textarea'))) show(S.tab);
}, 60000);

/* ---------- start ---------- */
function run(trip) {
  S.trip = trip;
  /* Een nieuw gepubliceerde planning gaat voor op wat iemand eerder op dit toestel aanpaste (notities blijven). */
  if (S.enc && S.enc.iv && ls.get('rev', '') !== S.enc.iv) { delete S.edits.flights; delete S.edits.stays; saveEdits(); ls.set('rev', S.enc.iv); }
  document.title = trip.title || 'Montenegro';
  $('#splash').hidden = true;
  $('#lock').hidden = true; $('#app').hidden = false;
  show('vandaag');
  if (ls.get('loc', false)) startLocation();
}
function showLock() {
  const a = $('.lock-art');
  if (a && !a.innerHTML) a.innerHTML = illustration('coast', 'lock');
  $('#splash').hidden = true;
  $('#lock').hidden = false;
}
async function unlock() {
  const pw = $('#pw').value, err = $('#pwerr'), card = $('.lock-card');
  if (!pw || !S.enc) return;
  err.textContent = 'Bezig…';
  let trip = null;
  try {
    const key = await deriveKey(pw, b64d(S.enc.salt));
    trip = await decryptTrip(S.enc, key);
    S.key = key; await storeKey(key);
  } catch (e) {
    err.textContent = 'Onjuist wachtwoord.';
    card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
    return;
  }
  /* pas na geslaagd ontsleutelen starten: een renderfout is geen fout wachtwoord */
  $('#pw').value = ''; err.textContent = ''; $('#pw').blur();
  $('#lock').classList.add('opening');
  await new Promise(r => setTimeout(r, 900));
  run(trip);
}
$('#pwgo').addEventListener('click', unlock);
$('#pw').addEventListener('keydown', e => { if (e.key === 'Enter') unlock(); });
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  let enc = null;
  try { const r = await fetch('data/trip.enc', { cache: 'no-cache' }); if (r.ok) enc = await r.json(); } catch (e) {}
  /* Lokaal (bij het bouwen) gaat de onversleutelde planning voor; met ?slot=1 test je het slot. */
  const local = ['localhost', '127.0.0.1'].includes(location.hostname) && !Q.has('slot');
  if (local) { try { const r = await fetch('data/trip.json', { cache: 'no-cache' }); if (r.ok) { S.dev = true; S.enc = enc; return run(await r.json()); } } catch (e) {} }
  if (enc) {
    S.enc = enc;
    const key = await loadKey().catch(() => null);
    let trip = null;
    if (key) { try { trip = await decryptTrip(enc, key); } catch (e) { ls.del('k'); } }
    if (trip) { S.key = key; return run(trip); }
    return showLock();
  }
  showLock();
  $('#pwerr').textContent = 'Geen reisgegevens gevonden. Open de app één keer met internet.';
  $('#pwgo').disabled = true;
}
boot();
