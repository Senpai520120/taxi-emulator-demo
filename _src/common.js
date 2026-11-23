(() => {
'use strict';
const C = window.APP;
const KH = [49.9935, 36.2304];                    // центр Харькова
const NOM = 'https://nominatim.openstreetmap.org';
const OSRM = 'https://router.project-osrm.org';
const VB = '35.95,50.12,36.50,49.88';             // viewbox Харькова: lon1,lat1,lon2,lat2
const MAX_STOPS = 4;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const setText = (sel, v) => $$(sel).forEach(el => { el.textContent = v; });
const setHTML = (sel, v) => $$(sel).forEach(el => { el.innerHTML = v; });

/* ---------------- геометрия ---------------- */
const ER = 6371000, rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
function dist(a, b) {
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * ER * Math.asin(Math.sqrt(h));
}
function bearing(a, b) {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
function destPoint(a, d, brg) {
  const dr = d / ER, th = rad(brg), p1 = rad(a[0]), l1 = rad(a[1]);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(dr) + Math.cos(p1) * Math.sin(dr) * Math.cos(th));
  const l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(dr) * Math.cos(p1), Math.cos(dr) - Math.sin(p1) * Math.sin(p2));
  return [deg(p2), deg(l2)];
}
const fmtKm = m => (m / 1000).toFixed(m < 10000 ? 1 : 0).replace('.', ',') + ' км';
function fmtDur(s) { const m = Math.max(1, Math.round(s / 60)); return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${m % 60} мин`; }

/* ---------------- сеть ---------------- */
async function getJSON(url, ms = 10000, outer) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  if (outer) { if (outer.aborted) ctl.abort(); else outer.addEventListener('abort', () => ctl.abort()); }
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } catch (e) {
    if (outer && outer.aborted) { const a = new Error('aborted'); a.name = 'AbortError'; throw a; }
    if (e.name === 'AbortError') throw new Error('timeout');
    throw e;
  } finally { clearTimeout(t); }
}
let toastT;
function toast(msg, ms = 3400) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}

/* ---------------- рисунки машин (свои SVG) ---------------- */
// вид сверху: для карты. glass — стёкла, roof — крыша (у «Теслы» стеклянная)
function carTop(body, { glass = '#1f2429', roof = body, w = 24, shade = 'rgba(0,0,0,.35)' } = {}) {
  const h = Math.round(w * 2);
  return `<svg viewBox="0 0 24 48" width="${w}" height="${h}" aria-hidden="true">
<path d="M6 3.2Q12 .6 18 3.2L20.6 9.5Q21.3 12 21.3 15V39.5Q21.3 45.6 12 45.8Q2.7 45.6 2.7 39.5V15Q2.7 12 3.4 9.5Z" fill="${body}" stroke="${shade}" stroke-width=".8"/>
<rect x=".4" y="15.2" width="3.4" height="2.6" rx="1.2" fill="${body}" stroke="${shade}" stroke-width=".5"/>
<rect x="20.2" y="15.2" width="3.4" height="2.6" rx="1.2" fill="${body}" stroke="${shade}" stroke-width=".5"/>
<path d="M4.6 15.6Q12 11.6 19.4 15.6L18.2 21.6Q12 20 5.8 21.6Z" fill="${glass}"/>
<rect x="5.9" y="21.8" width="12.2" height="12.6" rx="2.4" fill="${roof}"/>
<path d="M5.4 21.9 4.3 34.2" stroke="${glass}" stroke-width="1.1"/><path d="M18.6 21.9 19.7 34.2" stroke="${glass}" stroke-width="1.1"/>
<path d="M5.8 35Q12 36.6 18.2 35L19.2 39.6Q12 42 4.8 39.6Z" fill="${glass}"/>
<path d="M6.2 4.2Q7.6 3.4 9 3.2L8.6 5.2Z" fill="#fffbe0"/><path d="M17.8 4.2Q16.4 3.4 15 3.2L15.4 5.2Z" fill="#fffbe0"/>
<rect x="4.2" y="43.2" width="3.2" height="1.3" rx=".6" fill="#e0453a"/><rect x="16.6" y="43.2" width="3.2" height="1.3" rx=".6" fill="#e0453a"/>
</svg>`;
}
// вид сбоку: для карточек и списка классов
function carSide(body, { w = 120, glass = '#2b3036', dark = false } = {}) {
  const h = Math.round(w * 50 / 120);
  const hl = dark ? '#d9e6ff' : '#fff8d6';
  return `<svg viewBox="0 0 120 50" width="${w}" height="${h}" aria-hidden="true">
<ellipse cx="60" cy="45.5" rx="55" ry="3" fill="rgba(0,0,0,.16)"/>
<path d="M4.5 33.5Q4 27 11 25.4L33 21.6Q43.5 11.2 57 10.2H76Q88 10.8 99 20.6L110.5 23Q116.5 24.6 116 32.5V36.5Q116 40.6 112 40.6H8.4Q4.6 40.6 4.5 37Z" fill="${body}" stroke="rgba(0,0,0,.25)" stroke-width=".7"/>
<path d="M37.5 21.4Q46.5 13 57.5 12.6H66V21.4Z" fill="${glass}"/>
<path d="M69 12.6H76Q86.5 13.2 94.5 21.4H69Z" fill="${glass}"/>
<path d="M8 30.2H113" stroke="rgba(0,0,0,.14)" stroke-width="1"/>
<path d="M67.5 12.6V39" stroke="rgba(0,0,0,.18)" stroke-width=".8"/>
<rect x="58" y="24.5" width="5.5" height="1.6" rx=".8" fill="rgba(0,0,0,.3)"/><rect x="86" y="24.5" width="5.5" height="1.6" rx=".8" fill="rgba(0,0,0,.3)"/>
<path d="M108 24.6 115 27.2 114.4 29.6 107.6 28.4Z" fill="${hl}"/>
<rect x="4.6" y="26.6" width="4.4" height="3.4" rx="1" fill="#d8392f"/>
<circle cx="30" cy="40" r="8.6" fill="#1b1d20"/><circle cx="30" cy="40" r="4.6" fill="#c9ccd1"/><circle cx="30" cy="40" r="1.6" fill="#6b7077"/>
<circle cx="92" cy="40" r="8.6" fill="#1b1d20"/><circle cx="92" cy="40" r="4.6" fill="#c9ccd1"/><circle cx="92" cy="40" r="1.6" fill="#6b7077"/>
</svg>`;
}
const avatarSvg = `<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" fill="#d9dde2"/><circle cx="32" cy="25" r="11" fill="#9aa3ad"/><path d="M11 60Q13 41 32 41Q51 41 53 60Z" fill="#9aa3ad"/></svg>`;
window.carTop = carTop; window.carSide = carSide;
$$('[data-car-side]').forEach(el => { el.innerHTML = carSide(el.dataset.carSide, { w: +el.dataset.w || 120 }); });
$$('[data-car-top]').forEach(el => { el.innerHTML = carTop(el.dataset.carTop, { w: +el.dataset.w || 24, glass: el.dataset.glass || '#1f2429' }); });

/* ---------------- карта ---------------- */
const map = L.map('map', { zoomControl: false, attributionControl: false, zoomSnap: 0.25 }).setView(KH, 15);
const hasWebGL = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (_) { return false; } })();
function rasterBase() {
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap', className: 'base-tiles raster' }).addTo(map);
}
if (C.vectorStyle && window.L.maplibreGL && hasWebGL) {
  try {
    const gl = L.maplibreGL({
      style: C.vectorStyle, className: 'base-tiles vector',
      attribution: '© <a href="https://openfreemap.org">OpenFreeMap</a> © OpenStreetMap'
    }).addTo(map);
    const glMap = gl.getMaplibreMap();
    glMap.once('load', () => {
      try {                                    // подписи только на местном языке, без латиницы
        for (const ly of glMap.getStyle().layers) {
          if (ly.type === 'symbol' && ly.layout && /name/.test(JSON.stringify(ly.layout['text-field'] || ''))) {
            glMap.setLayoutProperty(ly.id, 'text-field', ['coalesce', ['get', 'name:uk'], ['get', 'name']]);
          }
        }
        C.mapTweak?.(glMap);
      } catch (_) {}
    });
    glMap.on('error', e => console.warn('map', e?.error?.message));
  } catch (e) { console.warn(e); rasterBase(); }
} else rasterBase();
L.control.attribution({ position: 'topright', prefix: false }).addTo(map);
const layers = {
  me: L.layerGroup().addTo(map), nearby: L.layerGroup().addTo(map), route: L.layerGroup().addTo(map),
  car: L.layerGroup().addTo(map), mk: L.layerGroup().addTo(map)
};
const icon = (html, size, anchor) => L.divIcon({ html, className: '', iconSize: size, iconAnchor: anchor });

/* ---------------- классы и машины ---------------- */
const M_ECO = ['Skoda Fabia', 'Hyundai Accent', 'Kia Rio', 'Renault Logan', 'Chevrolet Aveo'];
const M_STD = ['Skoda Octavia', 'Toyota Corolla', 'Hyundai Elantra', 'Kia Ceed', 'Volkswagen Jetta', 'Mitsubishi Lancer', 'Nissan Leaf'];
const M_COMF = ['Toyota Camry', 'Volkswagen Passat'];
const CLASS_DEF = {
  economy: { n: 'Эконом', ratio: 0.86, models: M_ECO },
  fast: { n: 'Быстрый поиск', ratio: 1.38, upto: true, models: [...M_ECO, ...M_STD] },
  standard: { n: 'Стандарт', ratio: 1, models: M_STD },
  comfort: { n: 'Комфорт', ratio: 1.13, models: M_COMF },
  business: { n: 'Бизнес', ratio: 1.38, models: M_COMF }
};
const CLASS_IDS = C.classes || ['economy', 'standard', 'comfort'];
const COLORS = [
  { n: 'Белый', hex: '#f2f3f5' }, { n: 'Серый', hex: '#8b9096' }, { n: 'Темно-серый', hex: '#55595f' },
  { n: 'Чёрный', hex: '#26272b' }, { n: 'Серебристый', hex: '#c3c7cd' }, { n: 'Синий', hex: '#2d5aa8' }
];
const NAMES = ['Олександр', 'Сергій', 'Дмитро', 'Андрій', 'Віталій', 'Ігор', 'Максим', 'Руслан', 'Євген', 'Володимир', 'Олег', 'Микола', 'Артем', 'Денис', 'Роман', 'Костянтин'];
const PLATE_L = 'ABCEHIKMOPTX'.split('');

const S = {
  pts: [{ k: 'from', text: '', city: '', ll: null }, { k: 'to', text: '', city: '', ll: null }],
  sug: [], sugI: -1, trip: null, car: null, me: null, busy: false, state: 'form',
  cls: localStorage.getItem('taxi.cls') || 'standard',
  price: localStorage.getItem('taxi.price') || ''
};
if (!CLASS_IDS.includes(S.cls)) S.cls = CLASS_IDS.includes('standard') ? 'standard' : CLASS_IDS[0];

/* ---------------- адреса (Nominatim) ---------------- */
function fmtAddr(r) {
  const a = r.address || {};
  const road = a.road || a.pedestrian || a.footway || a.square || a.neighbourhood || a.quarter || a.suburb || '';
  const house = a.house_number || '';
  const city = a.city || a.town || a.village || a.municipality || a.state || '';
  const street = [road, house].filter(Boolean).join(', ');
  const poi = r.name && r.name !== road && r.name !== city ? r.name : '';
  const first = (r.display_name || '').split(',').slice(0, 2).join(',').trim();
  if (house) return { main: street, sub: [poi, city].filter(Boolean).join(', '), city };
  return { main: poi || street || first, sub: [poi ? street : '', city].filter(Boolean).join(', '), city };
}
let typeT, typeCtl;
async function geocode(q) {
  typeCtl?.abort();
  typeCtl = new AbortController();
  const sig = typeCtl.signal;
  const base = `${NOM}/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=ua&accept-language=uk,ru&viewbox=${VB}&q=${encodeURIComponent(q)}`;
  let r = await getJSON(base + '&bounded=1', 10000, sig);
  if (!r.length) r = await getJSON(base, 10000, sig);
  return r.map(x => ({ ...fmtAddr(x), ll: [+x.lat, +x.lon] }));
}

/* ---------------- поля адресов ---------------- */
const fieldsBox = $('#fields');
const SUBL = { from: 'Откуда', stop: 'Через', to: 'Куда' };
function subHTML(p) {
  if (p.k !== 'from' && !p.ll) return '';
  const n = S.pts.length - 2;
  const stops = p.k === 'to' && n > 0 ? ` • ${n} ${n === 1 ? 'остановка' : 'остановки'}` : '';
  return `<span>${SUBL[p.k]}</span>${p.city ? ' • ' + esc(p.city) : ''}${stops}`;
}
function rowHTML(p, i, n) {
  const stop = p.k === 'stop';
  const ph = stop ? `${C.ph.stop} ${i}` : C.ph[p.k];
  const dot = stop ? i : (C.dot?.[p.k] || '');
  const sub = C.showSub ? `<div class="fsub">${subHTML(p)}</div>` : '';
  const ctl = stop ? `<div class="sctl"><button class="sb" data-a="up" ${i <= 1 ? 'disabled' : ''} aria-label="Выше">↑</button><button class="sb" data-a="down" ${i >= n - 2 ? 'disabled' : ''} aria-label="Ниже">↓</button><button class="sb del" data-a="del" aria-label="Удалить остановку">×</button></div>` : '';
  const extra = p.k === 'to' && C.toExtra ? C.toExtra : '';
  const ftext = C.wrapFields ? `<div class="ftext${p.text ? '' : ' ph'}">${esc(p.text || ph)}</div>` : '';
  return `<div class="frow ${p.k}" data-i="${i}"><span class="fdot">${dot}</span><div class="fbox">${ftext}<input class="finput" data-i="${i}" type="text" placeholder="${esc(ph)}" value="${esc(p.text)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="done">${sub}</div>${ctl}${extra}<div class="sugg" data-i="${i}"></div></div>`;
}
function renderFields() {
  const n = S.pts.length;
  fieldsBox.innerHTML = S.pts.map((p, i) => rowHTML(p, i, n)).join('');
  S.sug = []; S.sugI = -1;
  $$('.js-add-stop').forEach(b => b.classList.toggle('hidden', n - 2 >= MAX_STOPS));
}
function syncField(i) {
  const row = $(`#fields .frow[data-i="${i}"]`); if (!row) return;
  const p = S.pts[i];
  $('.finput', row).value = p.text;
  const ft = $('.ftext', row);
  if (ft) { ft.textContent = p.text || $('.finput', row).placeholder; ft.classList.toggle('ph', !p.text); }
  const sub = $('.fsub', row);
  if (sub) sub.innerHTML = subHTML(p);
}
function showSugg(i, list, msg) {
  S.sug = list; S.sugI = i;
  $$('#fields .sugg').forEach(el => { el.innerHTML = ''; });
  const el = $(`#fields .sugg[data-i="${i}"]`); if (!el) return;
  if (msg) { el.innerHTML = `<div class="snote">${esc(msg)}</div>`; return; }
  el.innerHTML = list.map((s, k) => `<div class="sitem" data-k="${k}"><b>${esc(s.main)}</b><small>${esc(s.sub)}</small></div>`).join('');
}
function onType(i, v) {
  const p = S.pts[i]; p.text = v;
  if (p.ll) { p.ll = null; p.city = ''; updateRoute(false); }
  clearTimeout(typeT); typeCtl?.abort();
  if (v.trim().length < 3) { showSugg(i, []); return; }
  typeT = setTimeout(async () => {
    try {
      const r = await geocode(v);
      if (S.pts[i] !== p || p.text !== v) return;
      r.length ? showSugg(i, r) : showSugg(i, [], 'Ничего не найдено. Уточните улицу и номер дома');
    } catch (e) {
      if (e.name !== 'AbortError') showSugg(i, [], 'Поиск адресов не отвечает. Проверьте интернет');
    }
  }, 400);
}
function applyPick(i, item) {
  const p = S.pts[i]; if (!p) return;
  clearTimeout(typeT); typeCtl?.abort();
  p.text = item.main; p.city = item.city; p.ll = item.ll;
  showSugg(i, []); syncField(i);
  document.activeElement?.blur();
  formSheet.snap(1);
  if (i === 0) spawnNearby(p.ll);
  updateRoute(true, true);
}
async function resolveField(i) {
  const p = S.pts[i]; if (!p || !p.text.trim() || p.ll || p.busy) return;
  if (S.sugI === i && S.sug.length) { applyPick(i, S.sug[0]); return; }
  p.busy = true;
  try {
    const r = await geocode(p.text);
    if (S.pts[i] !== p || p.ll) return;
    if (r.length) applyPick(i, r[0]);
    else toast(`Адрес «${p.text}» не найден. Попробуйте: улица и номер дома`);
  } catch (e) {
    if (e.name !== 'AbortError') toast('Сервис поиска адресов не отвечает. Проверьте интернет');
  } finally { p.busy = false; }
}
fieldsBox.addEventListener('input', e => {
  const inp = e.target.closest('.finput'); if (inp) onType(+inp.dataset.i, inp.value);
});
fieldsBox.addEventListener('keydown', e => {
  const inp = e.target.closest('.finput');
  if (inp && e.key === 'Enter') { e.preventDefault(); resolveField(+inp.dataset.i); inp.blur(); }
});
fieldsBox.addEventListener('focusin', e => {
  const inp = e.target.closest('.finput'); if (!inp) return;
  inp.closest('.frow').classList.add('editing');
  formSheet.snap(2);
});
fieldsBox.addEventListener('focusout', e => {
  const inp = e.target.closest('.finput'); if (!inp) return;
  const i = +inp.dataset.i, p = S.pts[i];
  setTimeout(() => {
    if (S.pts[i] !== p || document.activeElement === inp) return;
    inp.closest('.frow')?.classList.remove('editing');
    $(`#fields .sugg[data-i="${i}"]`)?.replaceChildren();
    if (p.text.trim() && !p.ll) resolveField(i);
  }, 300);
});
fieldsBox.addEventListener('click', e => {
  const ft = e.target.closest('.ftext');
  if (ft) { const row = ft.closest('.frow'); row.classList.add('editing'); const inp = $('.finput', row); inp.focus(); inp.select(); return; }
  const it = e.target.closest('.sitem');
  if (it) { const i = +it.parentElement.dataset.i; const item = S.sug[+it.dataset.k]; if (item && S.sugI === i) applyPick(i, item); return; }
  const b = e.target.closest('.sb'); if (!b) return;
  const i = +b.closest('.frow').dataset.i, a = b.dataset.a;
  if (a === 'del') S.pts.splice(i, 1);
  else { const j = a === 'up' ? i - 1 : i + 1; if (j < 1 || j > S.pts.length - 2) return; [S.pts[i], S.pts[j]] = [S.pts[j], S.pts[i]]; }
  renderFields(); updateRoute(true);
});
function addStop() {
  const n = S.pts.length; if (n - 2 >= MAX_STOPS) return;
  if (S.state !== 'form') go('form', 2);
  S.pts.splice(n - 1, 0, { k: 'stop', text: '', city: '', ll: null });
  renderFields();
  const inp = $(`#fields .finput[data-i="${n - 1}"]`);
  inp?.closest('.frow').classList.add('editing'); inp?.focus();
}

/* ---------------- маршрут (OSRM) ---------------- */
async function osrmRoute(lls) {
  try {
    const coords = lls.map(p => p[1].toFixed(6) + ',' + p[0].toFixed(6)).join(';');
    const j = await getJSON(`${OSRM}/route/v1/driving/${coords}?overview=full&geometries=geojson`, 12000);
    if (j.code !== 'Ok' || !j.routes?.length) throw new Error(j.code);
    const rt = j.routes[0];
    return { coords: rt.geometry.coordinates.map(c => [c[1], c[0]]), dist: rt.distance, dur: rt.duration, ok: true };
  } catch (e) {
    let d = 0; for (let k = 1; k < lls.length; k++) d += dist(lls[k - 1], lls[k]);
    d *= 1.3;
    return { coords: lls, dist: d, dur: d / (30 / 3.6), ok: false };
  }
}
const short = s => s.length > 24 ? s.slice(0, 11) + '...' + s.slice(-10) : s;
function drawMarkers() {
  layers.mk.clearLayers();
  const last = S.pts.length - 1;
  S.pts.forEach((p, i) => {
    if (!p.ll) return;
    let ic;
    if (p.k === 'from') ic = icon(C.pin.html, C.pin.size, C.pin.anchor);
    else if (C.pointPin) ic = icon(C.pointPin(p.k === 'to' ? '' : i), [30, 40], [15, 40]);
    else if (p.k === 'to') ic = icon('<div class="mk-to"></div>', [30, 30], [15, 15]);
    else ic = icon(`<div class="mk-num">${i}</div>`, [28, 28], [14, 14]);
    L.marker(p.ll, { icon: ic, interactive: false, zIndexOffset: p.k === 'from' ? 400 : 300 }).addTo(layers.mk);
    if (C.addrPills && (p.k === 'from' || i === last)) {   // подписи адресов на карте (экран выбора класса)
      const plus = i === last ? '<button class="pill-plus js-add-stop" aria-label="Добавить остановку">+</button>' : '';
      L.marker(p.ll, { icon: icon(`<div class="bubble"><div class="apill ${p.k}"><span>${esc(short(p.text))}</span>${plus}</div></div>`, [0, 0], [0, 0]), zIndexOffset: 700 }).addTo(layers.mk);
    }
  });
}
function drawLine(layer, coords, st, ok) {
  if (st.casing) L.polyline(coords, { color: st.casing, weight: (st.weight || 6) + 4, opacity: 1, lineJoin: 'round', interactive: false }).addTo(layer);
  L.polyline(coords, { color: st.color, weight: st.weight || 6, opacity: 1, lineJoin: 'round', lineCap: 'round', dashArray: ok === false ? '10 10' : (st.dash || null), interactive: false }).addTo(layer);
}
function showTripInfo(state) {
  let txt = '';
  if (state === 'loading') txt = 'Строим маршрут…';
  else if (S.trip) txt = `${fmtKm(S.trip.dist)} · ${fmtDur(S.trip.dur)} в пути${S.trip.ok ? '' : ' (примерно, по прямой)'}`;
  $$('.js-trip').forEach(el => { el.textContent = txt; el.classList.toggle('hidden', !txt); });
}
let rseq = 0;
async function updateRoute(fit, fromPick) {
  drawMarkers();
  const ps = S.pts.filter(p => p.ll);
  const from = S.pts[0], to = S.pts[S.pts.length - 1];
  layers.route.clearLayers(); S.trip = null; showTripInfo(); renderClasses();
  document.body.classList.remove('has-route');
  const seq = ++rseq;
  if (!from.ll || !to.ll) { if (fit && ps.length) fitTo(ps.map(p => p.ll)); return; }
  showTripInfo('loading');
  const r = await osrmRoute(ps.map(p => p.ll));
  if (seq !== rseq) return;
  S.trip = r;
  document.body.classList.add('has-route');
  drawLine(layers.route, r.coords, C.route, r.ok);
  if (C.destBubble) L.marker(to.ll, { icon: icon(C.destBubble(fmtKm(r.dist), Math.max(1, Math.round(r.dur / 60))), [0, 0], [0, 0]), interactive: false, zIndexOffset: 350 }).addTo(layers.route);
  showTripInfo(); renderClasses();
  if (!r.ok) toast('Сервис маршрутов не ответил — показана прямая линия');
  // жёлтый стиль: после выбора адресов открывается экран выбора класса
  if (fromPick && sheets.order && S.state === 'form' && S.pts.every(p => p.ll)) { go('order', 1); }
  if (fit) fitTo(r.coords);
}

/* ---------------- подгонка карты ---------------- */
const safeTop = (() => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;top:0;height:env(safe-area-inset-top);visibility:hidden';
  document.body.appendChild(d); const h = d.offsetHeight; d.remove(); return h;
})();
const activeSheet = () => sheets[S.state] || formSheet;
function fitTo(lls) {
  if (!lls.length) return;
  const sh = activeSheet();
  const bottom = Math.min(sh.snaps[1], sh.vis || 0, innerHeight * 0.62) + (C.fitExtraBottom || 24);
  map.fitBounds(L.latLngBounds(lls), { paddingTopLeft: [40, safeTop + (C.fitTop || 100)], paddingBottomRight: [40, bottom], maxZoom: 16.5 });
}
function centerOn(ll, z) {
  const sh = activeSheet();
  const off = Math.min(sh.vis || 0, innerHeight * 0.62) / 2;
  map.setView(map.unproject(map.project(ll, z).add([0, off]), z), z);
}

/* ---------------- подвижные панели ---------------- */
function makeSheet(el, snapsFn) {
  const sh = { el, i: 1, vis: 0, snaps: [0, 0, 0], on: !el.classList.contains('off') };
  sh.calc = () => { sh.snaps = snapsFn(innerHeight, safeTop).map(Math.round); };
  sh.set = (v, anim = true) => {
    sh.vis = v;
    el.style.transition = anim ? '' : 'none';
    el.style.height = v + 'px';
    if (sh.on) {
      document.documentElement.style.setProperty('--sheet', v + 'px');
      document.body.classList.toggle('sheet-full', v > innerHeight * 0.72);
    }
  };
  sh.snap = (i, anim = true) => {
    sh.i = Math.max(0, Math.min(2, i)); sh.set(sh.snaps[sh.i], anim);
    if (sh.i < 2 && el.contains(document.activeElement)) document.activeElement.blur();
  };
  sh.show = i => { sh.on = true; el.classList.remove('off'); sh.snap(i ?? sh.i); };
  sh.hide = () => { sh.on = false; el.classList.add('off'); };
  let y0 = 0, v0 = 0, t0 = 0, drag = false, moved = false, pid = null;
  el.addEventListener('pointerdown', e => {
    const g = e.target.closest('.grab');
    if (!g || e.target.closest('input,button,a,.sitem')) return;
    drag = true; moved = false; y0 = e.clientY; v0 = sh.vis; t0 = performance.now(); pid = e.pointerId;
    try { g.setPointerCapture(pid); } catch (_) {}
    document.body.classList.add('dragging');
  });
  el.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== pid) return;
    const dy = e.clientY - y0;
    if (Math.abs(dy) > 5) moved = true;
    if (!moved) return;
    const [lo, , hi] = sh.snaps;
    let v = v0 - dy;
    if (v > hi) v = hi + (v - hi) * 0.2;
    if (v < lo) v = lo - (lo - v) * 0.4;
    sh.set(v, false);
  });
  const end = e => {
    if (!drag || e.pointerId !== pid) return;
    drag = false; document.body.classList.remove('dragging');
    const dy = e.clientY - y0, dt = performance.now() - t0, v = sh.vis;
    if (!moved) { sh.snap(sh.i < 2 ? sh.i + 1 : 1); return; }
    let i;
    if (dt < 280 && Math.abs(dy) > 25) {
      if (dy < 0) { i = sh.snaps.findIndex(s => s > v + 5); if (i < 0) i = 2; }
      else { i = 0; sh.snaps.forEach((s, k) => { if (s < v - 5) i = k; }); }
    } else {
      i = 0; sh.snaps.forEach((s, k) => { if (Math.abs(s - v) < Math.abs(sh.snaps[i] - v)) i = k; });
    }
    sh.snap(i);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  sh.calc(); if (sh.on) sh.snap(sh.i, false);
  return sh;
}
const formSheet = makeSheet($('#formSheet'), C.formSnaps);
const sheets = { form: formSheet, ride: makeSheet($('#rideSheet'), C.rideSnaps) };
if ($('#orderSheet')) sheets.order = makeSheet($('#orderSheet'), C.orderSnaps);
if ($('#searchSheet')) sheets.search = makeSheet($('#searchSheet'), C.searchSnaps);
const rideSheet = sheets.ride;
// экраны приложения: form → (order) → search → ride
function go(name, snapIdx) {
  Object.entries(sheets).forEach(([k, sh]) => { if (k !== name) sh.hide(); });
  S.state = name;
  ['form', 'order', 'search', 'ride'].forEach(k => document.body.classList.toggle('st-' + k, k === name));
  sheets[name].show(snapIdx);
  setTimeout(() => map.invalidateSize({ pan: false }), 360);
}
addEventListener('resize', () => {
  Object.values(sheets).forEach(sh => { sh.calc(); if (sh.on) sh.set(sh.snaps[sh.i], false); });
});

/* ---------------- класс и цена ---------------- */
function estimateStd() {                         // ориентировочная цена «Стандарта», если своя не введена
  const km = S.trip ? S.trip.dist / 1000 : 4;
  return Math.round(55 + 11 * km);
}
function priceFor(id) {
  const d = CLASS_DEF[id];
  if (S.price && id === S.cls) return +S.price;
  const std = S.price ? +S.price / CLASS_DEF[S.cls].ratio : estimateStd();
  return Math.round(std * d.ratio);
}
const fmtP = v => String(v).replace('.', ',');
function renderClasses() {
  const box = $('#clsList');
  if (box) {
    box.innerHTML = CLASS_IDS.map(id => {
      const d = CLASS_DEF[id];
      return `<button class="clsr js-cls${id === S.cls ? ' on' : ''}" data-c="${id}"><span class="cimg">${C.clsImg(id)}</span><span class="cn"><b>${d.n}</b><small>${C.seats}</small></span><span class="cp">${d.upto ? 'до ' : ''}${fmtP(priceFor(id))} ₴</span>${C.clsChevron || ''}</button>`;
    }).join('');
  }
  $$('.js-price').forEach(x => { x.placeholder = String(priceFor(S.cls)); });
  setText('.js-price-cur', fmtP(S.price || priceFor(S.cls)) + ' ₴');
}
function setCls(c) {
  if (!CLASS_DEF[c]) return;
  S.cls = c; localStorage.setItem('taxi.cls', c);
  $$('.js-cls').forEach(b => b.classList.toggle('on', b.dataset.c === c));
  setText('.js-cls-name', CLASS_DEF[c].n);
  renderClasses();
}
function setPrice(v, src) {
  S.price = v; localStorage.setItem('taxi.price', v);
  const shown = v ? fmtP(v) : '';
  $$('.js-price').forEach(x => { if (x !== src) x.value = shown; });
  $$('.js-price-show').forEach(x => { x.textContent = shown ? shown + ' ₴' : ''; x.classList.toggle('hidden', !shown); });
  renderClasses();
}
document.addEventListener('input', e => {
  const t = e.target.closest('.js-price'); if (!t) return;
  let v = t.value.replace(/,/g, '.').replace(/[^\d.]/g, '');
  const k = v.indexOf('.');
  if (k >= 0) v = v.slice(0, k + 1) + v.slice(k + 1).replace(/\./g, '').slice(0, 2);
  v = v.slice(0, 9);
  if (t.value !== fmtP(v)) t.value = fmtP(v);
  setPrice(v, t);
});

/* ---------------- такси рядом (декор на главной) ---------------- */
let nearSeq = 0;
async function spawnNearby(center) {
  if (!C.nearby) return;
  const seq = ++nearSeq;
  layers.nearby.clearLayers();
  const jobs = Array.from({ length: C.nearby }, async () => {
    const a = destPoint(center, rnd(250, 1100), rnd(0, 360));
    const b = destPoint(a, 250, rnd(0, 360));
    try {
      const j = await getJSON(`${OSRM}/route/v1/driving/${a[1].toFixed(6)},${a[0].toFixed(6)};${b[1].toFixed(6)},${b[0].toFixed(6)}?overview=full&geometries=geojson`, 8000);
      const cs = j.routes?.[0]?.geometry?.coordinates?.map(c => [c[1], c[0]]);
      if (!cs || cs.length < 2 || seq !== nearSeq) return;
      let k = 1; while (k < cs.length - 1 && dist(cs[0], cs[k]) < 8) k++;
      const h = bearing(cs[0], cs[k]);
      L.marker(cs[0], { icon: icon(`<div class="near-car" style="transform:rotate(${h.toFixed(0)}deg)">${carTop(C.taxiColor || '#FFC928', { w: 20 })}</div>`, [20, 40], [10, 20]), interactive: false }).addTo(layers.nearby);
    } catch (_) {}
  });
  await Promise.all(jobs);
}

/* ---------------- поиск машины ---------------- */
async function makeCar(p) {
  let start = destPoint(p, rnd(500, 2500), rnd(0, 360));
  try {
    const j = await getJSON(`${OSRM}/nearest/v1/driving/${start[1].toFixed(6)},${start[0].toFixed(6)}?number=1`, 8000);
    if (j.code === 'Ok' && j.waypoints?.length) start = [j.waypoints[0].location[1], j.waypoints[0].location[0]];
  } catch (_) {}
  const r = await osrmRoute([start, p]);
  let k = 1;
  while (k < r.coords.length - 1 && dist(r.coords[0], r.coords[k]) < 8) k++;
  const head = r.coords.length > 1 ? bearing(r.coords[0], r.coords[k]) : 0;
  const d = () => Math.floor(Math.random() * 10);
  return {
    pos: start, route: r, head,
    eta: Math.max(2, Math.round(r.dur / 60)),
    model: pick(CLASS_DEF[S.cls].models), color: pick(COLORS),
    plate: [pick(['AX', 'KX']), `${d()}${d()}${d()}${d()}`, pick(PLATE_L) + pick(PLATE_L)],
    driver: pick(NAMES), rating: rnd(4.85, 5.0).toFixed(2),
    trips: Math.round(rnd(1200, 12000)), years: Math.round(rnd(2, 9))
  };
}
function routeListHTML() {
  let sn = 0;
  return S.pts.filter(p => p.ll).map(p => {
    const n = p.k === 'stop' ? ++sn : '';
    return `<div class="rl ${p.k}"><i class="rd">${n}</i><div class="rx"><small>${SUBL[p.k]}</small><span>${esc(p.text)}</span>${p.k === 'to' && C.editLink ? '<button class="elink js-deco">Изменить</button>' : ''}</div></div>`;
  }).join('');
}
function fillRide(car) {
  setText('.js-eta', car.eta + ' мин');
  setText('.js-car-dist', fmtKm(car.route.dist));
  setText('.js-plate', car.plate.join(C.plateJoin ?? ' '));
  setText('.js-car-full', `${car.color.n} ${car.model}`);
  setText('.js-car-model', car.model);
  setText('.js-car-color', car.color.n);
  setHTML('.js-car-side', carSide(car.color.hex, { w: +($('.js-car-side')?.dataset.w || 120), dark: car.color.hex === '#26272b' }));
  setText('.js-driver', car.driver);
  setText('.js-rating', car.rating);
  setText('.js-trips-n', String(car.trips));
  setText('.js-trips', `${car.trips} поездок`);
  setText('.js-years', `Больше ${car.years} ${car.years < 5 ? 'лет' : 'лет'}`);
  setHTML('.js-ava', avatarSvg);
  const t = new Date(Date.now() + car.eta * 60000);
  setText('.js-eta-clock', t.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
  setHTML('.js-route-list', routeListHTML());
  setText('.js-trip2', S.trip ? `${fmtKm(S.trip.dist)} · ${fmtDur(S.trip.dur)} в пути` : '');
  setPrice(S.price);
}
let stageT = [];
function setSteps(n, title) {
  $$('.js-steps i').forEach((el, k) => { el.className = k < n ? 'done' : (k === n ? 'act' : ''); });
  $$('.js-steps b').forEach((el, k) => { el.className = k < n ? 'done' : ''; });
  if (title) setText('.js-stage', title);
}
function runStages() {
  stageT.forEach(clearTimeout); stageT = [];
  (C.stages || []).forEach(([ms, n, title]) => stageT.push(setTimeout(() => { if (S.busy) setSteps(n, title); }, ms)));
}
let searchLayers = [];
async function findCar() {
  if (S.busy) return;
  const from = S.pts[0], to = S.pts[S.pts.length - 1];
  if (!from.ll) { toast('Укажите адрес подачи'); go('form', 2); return; }
  if (!to.ll) { toast('Укажите, куда едем'); go('form', 2); return; }
  S.busy = true; S.cancelled = false;
  $$('.js-find').forEach(b => { b.disabled = true; });
  document.activeElement?.blur();
  layers.car.clearLayers(); layers.nearby.clearLayers();
  if (sheets.search) {
    $('#searchSheet').classList.remove('price-changed');
    go('search', 1); runStages();
    if (C.searchCircle) searchLayers.push(L.circle(from.ll, { radius: 330, color: '#ffffff', weight: 1, opacity: .9, fillColor: '#ffffff', fillOpacity: .5, interactive: false }).addTo(layers.car));
  } else {
    document.body.classList.add('searching');
    formSheet.snap(0);
    searchLayers.push(L.marker(from.ll, { icon: icon('<div class="pulse"><i></i><i></i><i></i></div>', [24, 24], [12, 12]), interactive: false, zIndexOffset: -100 }).addTo(layers.car));
  }
  centerOn(from.ll, 15.5);
  const [car] = await Promise.all([makeCar(from.ll), sleep(C.searchMs || rnd(2200, 3000))]);
  searchLayers.forEach(l => layers.car.removeLayer(l)); searchLayers = [];
  document.body.classList.remove('searching');
  $$('.js-find').forEach(b => { b.disabled = false; });
  S.busy = false;
  if (S.cancelled) return;
  S.car = car;

  const cs = C.carRoute;
  drawLine(layers.car, car.route.coords, cs, true);
  if (C.etaBubble) L.marker(from.ll, { icon: icon(C.etaBubble(car.eta), [0, 0], [0, 0]), interactive: false, zIndexOffset: 600 }).addTo(layers.car);
  const real = C.mapCar === 'real';
  const html = real ? carTop(car.color.hex === '#f2f3f5' ? '#e9ebee' : car.color.hex, { glass: '#15181b', roof: '#15181b' }) : carTop(C.taxiColor || '#FFC928');
  L.marker(car.pos, { icon: icon(`<div class="car-ic" style="transform:rotate(${car.head.toFixed(0)}deg)">${html}</div>`, [24, 48], [12, 24]), interactive: false, zIndexOffset: 500 }).addTo(layers.car);
  if (!car.route.ok) toast('Маршрут машины построен примерно — сервис маршрутов не ответил');
  fillRide(car);
  if (C.rideHideTrip) map.removeLayer(layers.route);
  go('ride', 1);
  startCountdown(car.eta * 60);
  setTimeout(() => fitTo([...car.route.coords, ...(C.rideFitTrip === false || C.rideHideTrip ? [] : (S.trip ? S.trip.coords : []))]), 380);
}
function cancelSearch() {
  S.cancelled = true; stageT.forEach(clearTimeout);
  searchLayers.forEach(l => layers.car.removeLayer(l)); searchLayers = [];
  layers.car.clearLayers();
  if (S.pts[0].ll) spawnNearby(S.pts[0].ll);
  go(sheets.order ? 'order' : 'form', 1);
  setTimeout(fitAll, 380);
}
let cdT;
const mmss = s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
function timer(sec, onTick, onEnd) {
  clearInterval(cdT);
  const end = Date.now() + sec * 1000;
  const tick = () => {
    const left = Math.max(0, Math.round((end - Date.now()) / 1000));
    onTick(left);
    if (left === 0) { clearInterval(cdT); onEnd?.(); }
  };
  tick(); cdT = setInterval(tick, 1000);
}
function startCountdown(sec) {
  document.body.classList.remove('arrived');
  $$('.js-arrive-title').forEach(el => { if (el.dataset.t) el.textContent = el.dataset.t; });
  timer(sec, left => {
    setText('.js-countdown', mmss(left));
    setText('.js-eta-min', Math.max(1, Math.ceil(left / 60)) + ' мин');
    document.documentElement.style.setProperty('--prog', (1 - left / sec).toFixed(3));
  }, () => {
    document.body.classList.add('arrived');
    $$('.js-arrive-title').forEach(el => { el.textContent = el.dataset.arrived || C.arrivedTitle || 'Водитель на месте'; });
    setText('.js-eta-min', 'на месте');
    toast('Водитель ожидает вас');
    timer(180, left => setText('.js-wait', mmss(left)));
  });
}
function fitAll() {
  const lls = [];
  if (S.trip) lls.push(...S.trip.coords); else S.pts.forEach(p => p.ll && lls.push(p.ll));
  if (S.car) lls.push(...S.car.route.coords);
  if (lls.length) fitTo(lls); else if (S.me) centerOn(S.me, 16);
}
function cancelRide() {
  layers.car.clearLayers(); S.car = null; clearInterval(cdT); document.body.classList.remove('arrived');
  if (!map.hasLayer(layers.route)) layers.route.addTo(map);
  if (S.pts[0].ll) spawnNearby(S.pts[0].ll);
  go(sheets.order ? 'order' : 'form', 1);
  setTimeout(fitAll, 380);
}

/* ---------------- геолокация ---------------- */
function drawMe(ll, acc) {
  layers.me.clearLayers();
  L.circle(ll, { radius: Math.min(acc || 60, 200), color: '#3b82f6', weight: 1, opacity: .4, fillColor: '#3b82f6', fillOpacity: .12, interactive: false }).addTo(layers.me);
  L.marker(ll, { icon: icon('<div class="me-dot"></div>', [18, 18], [9, 9]), interactive: false, zIndexOffset: -50 }).addTo(layers.me);
}
async function setFrom(ll) {
  const p = S.pts[0];
  if (p.ll || p.text.trim()) return;
  p.ll = ll; p.text = 'Определяем адрес…'; p.city = '';
  syncField(0); centerOn(ll, 16); updateRoute(false); spawnNearby(ll);
  let txt, city = '';
  try {
    const j = await getJSON(`${NOM}/reverse?format=jsonv2&addressdetails=1&zoom=18&accept-language=uk,ru&lat=${ll[0]}&lon=${ll[1]}`);
    const a = fmtAddr(j); txt = a.main; city = a.city;
  } catch (_) { txt = `${ll[0].toFixed(5)}, ${ll[1].toFixed(5)}`; }
  if (S.pts[0] === p && p.ll === ll) { p.text = txt || 'Моё местоположение'; p.city = city; syncField(0); drawMarkers(); }
}
function geolocate(initial) {
  let done = false;
  const fail = msg => {
    if (done) return; done = true;
    if (initial) { toast(msg + ' — показан центр Харькова'); setFrom(KH); } else toast(msg);
  };
  if (!navigator.geolocation) { fail('Геолокация не поддерживается'); return; }
  const guard = setTimeout(() => fail('Не удалось определить местоположение'), 12000);
  navigator.geolocation.getCurrentPosition(pos => {
    if (done) return; done = true; clearTimeout(guard);
    const ll = [pos.coords.latitude, pos.coords.longitude];
    S.me = ll; drawMe(ll, pos.coords.accuracy);
    if (initial) setFrom(ll); else centerOn(ll, 16);
  }, () => { clearTimeout(guard); fail('Нет доступа к геолокации'); },
  { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}

/* ---------------- кнопки ---------------- */
document.addEventListener('click', e => {
  const t = e.target.closest('button,[data-addr],.js-deco'); if (!t) return;
  if (t.matches('.js-cls')) setCls(t.dataset.c);
  else if (t.matches('.js-cls-open')) { formSheet.snap(2); setTimeout(() => $('#classes')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 320); }
  else if (t.matches('.js-find')) findCar();
  else if (t.matches('.js-cancel')) cancelRide();
  else if (t.matches('.js-cancel-search')) cancelSearch();
  else if (t.matches('.js-add-stop')) addStop();
  else if (t.matches('.js-back')) { go('form', 1); setTimeout(fitAll, 380); }
  else if (t.matches('.js-locate')) { if (S.me) centerOn(S.me, 16); else geolocate(false); }
  else if (t.matches('.js-call')) toast(`Звонок водителю (${S.car?.driver || ''}) — недоступен в демо`);
  else if (t.matches('.js-msg')) toast('Чат с водителем недоступен в демо');
  else if (t.matches('.js-fit')) fitAll();
  else if (t.matches('.js-collapse')) activeSheet().snap(1);
  else if (t.matches('.js-expand')) activeSheet().snap(1);
  else if (t.matches('.js-pedit')) { const r = $('#priceEdit'); r?.classList.toggle('hidden'); if (r && !r.classList.contains('hidden')) $('input', r)?.focus(); }
  else if (t.matches('.js-pdone')) { $('#priceEdit')?.classList.add('hidden'); document.activeElement?.blur(); }
  else if (t.matches('.js-pstep')) {
    const v = Math.max(10, Math.round((+S.price || priceFor(S.cls)) + +t.dataset.d));
    setPrice(String(v)); $('#searchSheet')?.classList.add('price-changed');
  }
  else if (t.matches('.js-search-at')) { $('#searchSheet')?.classList.remove('price-changed'); toast(`Ищем по ${fmtP(S.price)} ₴`); }
  else if (t.matches('.js-hint-close')) { $('#installHint')?.classList.add('hidden'); localStorage.setItem('taxi.hint', '1'); }
  else if (t.matches('.js-menu')) toast(`${C.name} — демо-эмулятор заказа такси`);
  else if (t.matches('.js-share')) toast('Поделиться поездкой — недоступно в демо');
  else if (t.dataset.addr) {
    const i = S.pts.length - 1, p = S.pts[i];
    p.text = t.dataset.addr; p.ll = null; p.city = ''; syncField(i); resolveField(i);
  }
  else if (t.matches('.js-deco')) toast('Недоступно в демо');
});
map.on('click', () => { if (document.activeElement?.matches('input')) document.activeElement.blur(); });

/* ---------------- как приложение (PWA) ---------------- */
const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
document.documentElement.classList.toggle('standalone', standalone);
document.addEventListener('gesturestart', e => e.preventDefault());
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (!standalone && isIOS && !localStorage.getItem('taxi.hint')) {
  setTimeout(() => {
    const d = document.createElement('div');
    d.id = 'installHint';
    d.innerHTML = location.protocol === 'file:'
      ? '<b>Откройте по ссылке в Safari</b>Из «Файлов» приложение не установить. Откройте сайт в Safari и добавьте его на экран «Домой».<button class="js-hint-close" aria-label="Закрыть">×</button>'
      : '<b>Установите как приложение</b>Нажмите <span class="shr"></span> «Поделиться» → «На экран „Домой“». Запускайте с иконки — без панелей браузера.<button class="js-hint-close" aria-label="Закрыть">×</button>';
    document.body.appendChild(d);
  }, 1200);
}

/* ---------------- старт ---------------- */
renderFields();
setCls(S.cls);
setPrice(S.price);
go('form', 1);
geolocate(true);
})();
