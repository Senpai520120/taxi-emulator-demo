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

/* ---------------- карта ---------------- */
const map = L.map('map', { zoomControl: false, attributionControl: false, zoomSnap: 0.25 }).setView(KH, 15);
const hasWebGL = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (_) { return false; } })();
function rasterBase() {
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap', className: 'base-tiles raster' }).addTo(map);
}
if (C.vectorStyle && window.L.maplibreGL && hasWebGL) {
  // векторная карта (OpenFreeMap, без ключа): чистая, как в приложениях такси
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
  me: L.layerGroup().addTo(map), route: L.layerGroup().addTo(map),
  car: L.layerGroup().addTo(map), mk: L.layerGroup().addTo(map)
};
const icon = (html, size, anchor) => L.divIcon({ html, className: '', iconSize: size, iconAnchor: anchor });

function carSvg(color, w = 24) {
  const h = Math.round(w * 44 / 24);
  return `<svg viewBox="0 0 24 44" width="${w}" height="${h}" aria-hidden="true">
<rect x="1.5" y="1.5" width="21" height="41" rx="7" fill="${color}" stroke="rgba(0,0,0,.45)" stroke-width="1"/>
<path d="M4.3 13.6Q12 9.6 19.7 13.6L18.6 18.4H5.4Z" fill="#26313d"/>
<path d="M5.4 33H18.6L19.2 37.3Q12 39.8 4.8 37.3Z" fill="#26313d"/>
<rect x="5.6" y="19.2" width="12.8" height="12.8" rx="2.5" fill="${color}" stroke="rgba(0,0,0,.18)"/>
<rect x="3.2" y="3.4" width="4" height="2" rx="1" fill="#fff6bf"/><rect x="16.8" y="3.4" width="4" height="2" rx="1" fill="#fff6bf"/>
</svg>`;
}
window.carSvg = carSvg;

/* ---------------- состояние ---------------- */
const CLS = { economy: 'Эконом', standard: 'Стандарт', comfort: 'Комфорт' };
const MODELS = {
  economy: ['Skoda Fabia', 'Hyundai Accent', 'Kia Rio', 'Renault Logan', 'Chevrolet Aveo'],
  standard: ['Skoda Octavia', 'Toyota Corolla', 'Hyundai Elantra', 'Kia Ceed', 'Volkswagen Jetta', 'Mitsubishi Lancer', 'Nissan Leaf'],
  comfort: ['Toyota Camry', 'Volkswagen Passat']
};
const COLORS = [
  { n: 'белый', hex: '#f4f4f4' }, { n: 'серый', hex: '#7d838b' }, { n: 'чёрный', hex: '#26272b' },
  { n: 'серебристый', hex: '#c4c8ce' }, { n: 'синий', hex: '#2d5aa8' }
];
const NAMES = ['Александр', 'Сергей', 'Дмитрий', 'Андрей', 'Виталий', 'Игорь', 'Максим', 'Руслан', 'Евгений', 'Владимир', 'Олег', 'Николай', 'Артём', 'Денис', 'Роман'];
const PLATE_L = 'ABCEHIKMOPTX'.split('');

const S = {
  pts: [{ k: 'from', text: '', city: '', ll: null }, { k: 'to', text: '', city: '', ll: null }],
  sug: [], sugI: -1, trip: null, car: null, me: null, busy: false,
  cls: localStorage.getItem('taxi.cls') || 'standard',
  price: localStorage.getItem('taxi.price') || ''
};
if (!CLS[S.cls]) S.cls = 'standard';

/* ---------------- адреса (Nominatim) ---------------- */
function fmtAddr(r) {
  const a = r.address || {};
  const road = a.road || a.pedestrian || a.footway || a.square || a.neighbourhood || a.quarter || a.suburb || '';
  const house = a.house_number || '';
  const city = a.city || a.town || a.village || a.municipality || a.state || '';
  const street = [road, house].filter(Boolean).join(', ');
  const poi = r.name && r.name !== road && r.name !== city ? r.name : '';
  const first = (r.display_name || '').split(',').slice(0, 2).join(',').trim();
  if (house) return { main: street, sub: [poi, city].filter(Boolean).join(', '), city };   // есть номер дома — показываем адрес
  return { main: poi || street || first, sub: [poi ? street : '', city].filter(Boolean).join(', '), city };
}
let typeT, typeCtl;
async function geocode(q) {
  typeCtl?.abort();
  typeCtl = new AbortController();
  const sig = typeCtl.signal;
  const base = `${NOM}/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=ua&accept-language=uk,ru&viewbox=${VB}&q=${encodeURIComponent(q)}`;
  let r = await getJSON(base + '&bounded=1', 10000, sig);       // сначала только Харьков
  if (!r.length) r = await getJSON(base, 10000, sig);           // потом вся Украина, Харьков в приоритете
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
  return `<div class="frow ${p.k}" data-i="${i}"><span class="fdot">${dot}</span><div class="fbox"><input class="finput" data-i="${i}" type="text" placeholder="${esc(ph)}" value="${esc(p.text)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="done">${sub}</div>${ctl}${extra}<div class="sugg" data-i="${i}"></div></div>`;
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
  typeT = setTimeout(async () => {                                // debounce 400 мс
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
  updateRoute(true);
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
fieldsBox.addEventListener('focusin', e => { if (e.target.closest('.finput')) formSheet.snap(2); });
fieldsBox.addEventListener('focusout', e => {
  const inp = e.target.closest('.finput'); if (!inp) return;
  const i = +inp.dataset.i, p = S.pts[i];
  setTimeout(() => {                         // даём сработать клику по подсказке
    if (S.pts[i] !== p || document.activeElement === inp) return;
    $(`#fields .sugg[data-i="${i}"]`)?.replaceChildren();
    if (p.text.trim() && !p.ll) resolveField(i);
  }, 300);
});
fieldsBox.addEventListener('click', e => {
  const it = e.target.closest('.sitem');
  if (it) { const i = +it.parentElement.dataset.i; const item = S.sug[+it.dataset.k]; if (item && S.sugI === i) applyPick(i, item); return; }
  const b = e.target.closest('.sb'); if (!b) return;
  const i = +b.closest('.frow').dataset.i, a = b.dataset.a;
  if (a === 'del') S.pts.splice(i, 1);
  else { const j = a === 'up' ? i - 1 : i + 1; if (j < 1 || j > S.pts.length - 2) return; [S.pts[i], S.pts[j]] = [S.pts[j], S.pts[i]]; }
  renderFields(); updateRoute(true);
  S.pts.forEach((_, k) => syncField(k));
});
function addStop() {
  const n = S.pts.length; if (n - 2 >= MAX_STOPS) return;
  S.pts.splice(n - 1, 0, { k: 'stop', text: '', city: '', ll: null });
  renderFields();
  $(`#fields .finput[data-i="${n - 1}"]`)?.focus();
}

/* ---------------- маршрут (OSRM) ---------------- */
async function osrmRoute(lls) {
  try {
    const coords = lls.map(p => p[1].toFixed(6) + ',' + p[0].toFixed(6)).join(';');
    const j = await getJSON(`${OSRM}/route/v1/driving/${coords}?overview=full&geometries=geojson`, 12000);
    if (j.code !== 'Ok' || !j.routes?.length) throw new Error(j.code);
    const rt = j.routes[0];
    return { coords: rt.geometry.coordinates.map(c => [c[1], c[0]]), dist: rt.distance, dur: rt.duration, ok: true };
  } catch (e) {                              // заглушка: прямая линия, ~30 км/ч
    let d = 0; for (let k = 1; k < lls.length; k++) d += dist(lls[k - 1], lls[k]);
    d *= 1.3;
    return { coords: lls, dist: d, dur: d / (30 / 3.6), ok: false };
  }
}
function drawMarkers() {
  layers.mk.clearLayers();
  const n = S.pts.length;
  S.pts.forEach((p, i) => {
    if (!p.ll) return;
    let ic;
    if (p.k === 'from') ic = icon(C.pin.html, C.pin.size, C.pin.anchor);
    else if (C.pointPin) ic = icon(C.pointPin(p.k === 'to' ? '' : i), [30, 40], [15, 40]);
    else if (p.k === 'to') ic = icon('<div class="mk-num to">B</div>', [28, 28], [14, 14]);
    else ic = icon(`<div class="mk-num">${i}</div>`, [28, 28], [14, 14]);
    L.marker(p.ll, { icon: ic, interactive: false, zIndexOffset: p.k === 'from' ? 400 : 300 }).addTo(layers.mk);
  });
}
function drawLine(layer, coords, color, ok, casing) {
  if (casing) L.polyline(coords, { color: casing, weight: 10, opacity: 1, lineJoin: 'round', interactive: false }).addTo(layer);
  L.polyline(coords, { color, weight: 6, opacity: .95, lineJoin: 'round', lineCap: 'round', dashArray: ok ? null : '10 10', interactive: false }).addTo(layer);
}
function showTripInfo(state) {
  let txt = '';
  if (state === 'loading') txt = 'Строим маршрут…';
  else if (S.trip) txt = `${fmtKm(S.trip.dist)} · ${fmtDur(S.trip.dur)} в пути${S.trip.ok ? '' : ' (примерно, по прямой)'}`;
  $$('.js-trip').forEach(el => { el.textContent = txt; el.classList.toggle('hidden', !txt); });
}
let rseq = 0;
async function updateRoute(fit) {
  drawMarkers();
  const ps = S.pts.filter(p => p.ll);
  const from = S.pts[0], to = S.pts[S.pts.length - 1];
  layers.route.clearLayers(); S.trip = null; showTripInfo();
  const seq = ++rseq;
  if (!from.ll || !to.ll) { if (fit && ps.length) fitTo(ps.map(p => p.ll)); return; }
  showTripInfo('loading');
  const r = await osrmRoute(ps.map(p => p.ll));
  if (seq !== rseq) return;
  S.trip = r;
  drawLine(layers.route, r.coords, C.route.color, r.ok, C.route.casing);
  if (C.destBubble) L.marker(to.ll, { icon: icon(C.destBubble(fmtKm(r.dist), Math.max(1, Math.round(r.dur / 60))), [0, 0], [0, 0]), interactive: false, zIndexOffset: 350 }).addTo(layers.route);
  showTripInfo();
  if (!r.ok) toast('Сервис маршрутов не ответил — показана прямая линия');
  if (fit) fitTo(r.coords);
}

/* ---------------- подгонка карты ---------------- */
const safeTop = (() => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;top:0;height:env(safe-area-inset-top);visibility:hidden';
  document.body.appendChild(d); const h = d.offsetHeight; d.remove(); return h;
})();
function fitTo(lls) {
  if (!lls.length) return;
  const sh = rideSheet.on ? rideSheet : formSheet;
  const bottom = Math.min(sh.snaps[1], sh.vis || 0, innerHeight * 0.62) + 24;
  map.fitBounds(L.latLngBounds(lls), { paddingTopLeft: [36, safeTop + 96], paddingBottomRight: [36, bottom], maxZoom: 16.5 });
}

function centerOn(ll, z) {                   // точка видна над панелью, а не под ней
  const sh = rideSheet.on ? rideSheet : formSheet;
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
      document.body.classList.toggle('sheet-full', v > innerHeight * 0.75);
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
    if (!moved) { sh.snap(sh.i < 2 ? sh.i + 1 : 1); return; }            // тап по ручке
    let i;
    if (dt < 280 && Math.abs(dy) > 25) {                                  // быстрый взмах
      if (dy < 0) { i = sh.snaps.findIndex(s => s > v + 5); if (i < 0) i = 2; }
      else { i = 0; sh.snaps.forEach((s, k) => { if (s < v - 5) i = k; }); }
    } else {                                                              // к ближайшему положению
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
const rideSheet = makeSheet($('#rideSheet'), C.rideSnaps);
addEventListener('resize', () => {
  [formSheet, rideSheet].forEach(sh => { sh.calc(); sh.set(sh.snaps[sh.i], false); });
});

/* ---------------- класс и цена ---------------- */
function setCls(c) {
  if (!CLS[c]) return;
  S.cls = c; localStorage.setItem('taxi.cls', c);
  $$('.js-cls').forEach(b => b.classList.toggle('on', b.dataset.c === c));
  $$('.js-cls-name').forEach(el => { el.textContent = CLS[c]; });
}
function syncPrice(src) {
  const shown = S.price ? S.price.replace('.', ',') : '';
  $$('.js-price').forEach(x => { if (x !== src) x.value = shown; });
  $$('.js-price-show').forEach(x => { x.textContent = shown ? shown + ' ₴' : ''; x.classList.toggle('hidden', !shown); });
}
document.addEventListener('input', e => {
  const t = e.target.closest('.js-price'); if (!t) return;
  let v = t.value.replace(/,/g, '.').replace(/[^\d.]/g, '');
  const k = v.indexOf('.');
  if (k >= 0) v = v.slice(0, k + 1) + v.slice(k + 1).replace(/\./g, '').slice(0, 2);
  v = v.slice(0, 9);
  const shown = v.replace('.', ',');
  if (t.value !== shown) t.value = shown;
  S.price = v; localStorage.setItem('taxi.price', v);
  syncPrice(t);
});

/* ---------------- поиск машины ---------------- */
async function makeCar(p) {
  let start = destPoint(p, rnd(500, 2500), rnd(0, 360));          // случайная точка в 0.5–2.5 км
  try {                                                             // прилипание к дороге
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
    model: pick(MODELS[S.cls]), color: pick(COLORS),
    plate: `${pick(['AX', 'KX'])} ${d()}${d()}${d()}${d()} ${pick(PLATE_L)}${pick(PLATE_L)}`,
    driver: pick(NAMES), rating: rnd(4.7, 5.0).toFixed(1), trips: Math.round(rnd(150, 3200))
  };
}
function fillRide(car) {
  $('#rcEta').textContent = car.eta + ' мин';
  $('#rcDist').textContent = fmtKm(car.route.dist);
  $('#rcModel').textContent = car.model;
  $('#rcColor').textContent = car.color.n[0].toUpperCase() + car.color.n.slice(1);
  $('#rcPlate').innerHTML = `<span class="ua">UA</span><span class="pn">${esc(car.plate)}</span>`;
  $('#rcDriver').textContent = car.driver;
  $('#rcRating').textContent = car.rating;
  $$('.js-trips').forEach(el => { el.textContent = car.trips + ' поездок'; });
  $('#rcAva').textContent = car.driver[0];
  $('#rcCarPic').innerHTML = `<div style="transform:rotate(90deg)">${carSvg(car.color.hex, 30)}</div>`;
  const t = new Date(Date.now() + car.eta * 60000);
  $$('.js-eta-clock').forEach(el => { el.textContent = t.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); });
  let sn = 0;
  $('#rcRoute').innerHTML = S.pts.filter(p => p.ll).map(p => {
    const lbl = p.k === 'stop' ? ++sn : '';
    return `<div class="rr ${p.k}"><span class="rdot">${lbl}</span><span class="rt">${esc(p.text)}</span></div>`;
  }).join('');
  $('#rcTrip').textContent = S.trip ? `${fmtKm(S.trip.dist)} · ${fmtDur(S.trip.dur)} в пути` : '';
  syncPrice();
}
async function findCar() {
  if (S.busy) return;
  const from = S.pts[0], to = S.pts[S.pts.length - 1];
  if (!from.ll) { toast('Укажите адрес подачи'); $('#fields .finput[data-i="0"]')?.focus(); return; }
  if (!to.ll) { toast('Укажите, куда едем'); $(`#fields .finput[data-i="${S.pts.length - 1}"]`)?.focus(); return; }
  S.busy = true;
  $$('.js-find').forEach(b => { b.disabled = true; });
  document.body.classList.add('searching');
  document.activeElement?.blur();
  formSheet.snap(0);
  layers.car.clearLayers();
  const pulse = L.marker(from.ll, { icon: icon('<div class="pulse"><i></i><i></i><i></i></div>', [24, 24], [12, 12]), interactive: false, zIndexOffset: -100 }).addTo(layers.car);
  map.flyTo(from.ll, 15, { duration: 0.6 });
  const [car] = await Promise.all([makeCar(from.ll), sleep(rnd(2000, 3000))]);
  layers.car.removeLayer(pulse);
  document.body.classList.remove('searching');
  $$('.js-find').forEach(b => { b.disabled = false; });
  S.busy = false; S.car = car;
  if (C.etaBubble) L.marker(from.ll, { icon: icon(C.etaBubble(car.eta), [0, 0], [0, 0]), interactive: false, zIndexOffset: 600 }).addTo(layers.car);
  startCountdown(car.eta * 60);

  drawLine(layers.car, car.route.coords, C.carRoute, true);
  layers.car.eachLayer(l => l.setStyle && l.setStyle({ dashArray: '1 11', weight: 6, lineCap: 'round' }));
  L.marker(car.pos, {
    icon: icon(`<div class="car-ic" style="transform:rotate(${car.head.toFixed(0)}deg)">${carSvg(C.taxiColor || '#FFC928')}</div>`, [24, 44], [12, 22]),
    interactive: false, zIndexOffset: 500
  }).addTo(layers.car);
  if (!car.route.ok) toast('Маршрут машины построен примерно — сервис маршрутов не ответил');

  fillRide(car);
  formSheet.hide(); rideSheet.show(1);
  fitTo([...car.route.coords, ...(S.trip ? S.trip.coords : S.pts.filter(p => p.ll).map(p => p.ll))]);
}
let cdT;
const mmss = s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
function timer(sec, onTick, onEnd) {
  clearInterval(cdT);
  const end = Date.now() + sec * 1000;
  const tick = () => {
    const left = Math.max(0, Math.round((end - Date.now()) / 1000));
    onTick(mmss(left));
    if (left === 0) { clearInterval(cdT); onEnd?.(); }
  };
  tick(); cdT = setInterval(tick, 1000);
}
function startCountdown(sec) {
  document.body.classList.remove('arrived');
  $$('.js-arrive-title').forEach(el => { if (el.dataset.t) el.textContent = el.dataset.t; });
  timer(sec, t => $$('.js-countdown').forEach(el => { el.textContent = t; }), () => {
    // машина подана: заголовок меняется, идёт бесплатное ожидание
    document.body.classList.add('arrived');
    $$('.js-arrive-title').forEach(el => { el.textContent = C.arrivedTitle || 'Водитель на месте'; });
    toast('Водитель ожидает вас');
    timer(180, t => $$('.js-wait').forEach(el => { el.textContent = t; }));
  });
}
function fitAll() {
  const lls = [];
  if (S.trip) lls.push(...S.trip.coords); else S.pts.forEach(p => p.ll && lls.push(p.ll));
  if (S.car) lls.push(...S.car.route.coords);
  if (lls.length) fitTo(lls); else if (S.me) centerOn(S.me, 16);
}
function cancelRide() {
  layers.car.clearLayers(); S.car = null; clearInterval(cdT); document.body.classList.remove("arrived");
  rideSheet.hide(); formSheet.show(1);
  fitTo(S.trip ? S.trip.coords : S.pts.filter(p => p.ll).map(p => p.ll));
}

/* ---------------- геолокация ---------------- */
function drawMe(ll, acc) {
  layers.me.clearLayers();
  L.circle(ll, { radius: Math.min(acc || 60, 200), color: '#3b82f6', weight: 1, opacity: .4, fillColor: '#3b82f6', fillOpacity: .12, interactive: false }).addTo(layers.me);
  L.marker(ll, { icon: icon('<div class="me-dot"></div>', [18, 18], [9, 9]), interactive: false, zIndexOffset: -50 }).addTo(layers.me);
}
async function setFrom(ll) {
  const p = S.pts[0];
  if (p.ll || p.text.trim()) return;          // пользователь уже ввёл адрес сам
  p.ll = ll; p.text = 'Определяем адрес…'; p.city = '';
  syncField(0); centerOn(ll, 16); updateRoute(false);
  let txt, city = '';
  try {
    const j = await getJSON(`${NOM}/reverse?format=jsonv2&addressdetails=1&zoom=18&accept-language=uk,ru&lat=${ll[0]}&lon=${ll[1]}`);
    const a = fmtAddr(j); txt = a.main; city = a.city;
  } catch (_) { txt = `${ll[0].toFixed(5)}, ${ll[1].toFixed(5)}`; }
  if (S.pts[0] === p && p.ll === ll) { p.text = txt || 'Моё местоположение'; p.city = city; syncField(0); }
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
  else if (t.matches('.js-add-stop')) addStop();
  else if (t.matches('.js-locate')) { if (S.me) centerOn(S.me, 16); else geolocate(false); }
  else if (t.matches('.js-call')) toast(`Звонок водителю (${S.car?.driver || ''}) — недоступен в демо`);
  else if (t.matches('.js-msg')) toast('Сообщения недоступны в демо');
  else if (t.matches('.js-fit')) fitAll();
  else if (t.matches('.js-hint-close')) { $('#installHint')?.classList.add('hidden'); localStorage.setItem('taxi.hint', '1'); }
  else if (t.matches('.js-menu')) toast(`${C.name} — демо-эмулятор заказа такси`);
  else if (t.dataset.addr) {
    const i = S.pts.length - 1, p = S.pts[i];
    p.text = t.dataset.addr; p.ll = null; p.city = ''; syncField(i); resolveField(i);
  }
  else if (t.matches('.js-deco')) toast('Раздел недоступен в демо');
});
map.on('click', () => { if (document.activeElement?.matches('input')) document.activeElement.blur(); });

/* ---------------- как приложение (PWA) ---------------- */
const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
document.documentElement.classList.toggle('standalone', standalone);
document.addEventListener('gesturestart', e => e.preventDefault());   // интерфейс не масштабируется щипком, карта — да
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
syncPrice();
geolocate(true);
})();
