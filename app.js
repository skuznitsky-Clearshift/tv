/* מצב התור באונבורדינג — תצוגה חיה (index.html) וניהול (admin.html).
   נתונים: s.json = {rows, stat} מוצפן בקוד הצפייה (הסקיל כותב) · o.json = {ov:{id:{col,key}}} מוצפן באותו קוד (המנהל כותב)
   a.json = {view:<קוד צפייה>} מוצפן בקוד המנהל. הצפנה: AES-GCM, מפתח PBKDF2-SHA256(קוד, SALT, 600k). */
const SALT = 'd65bd9e778a8bb45', IT = 600000, REPO = 'skuznitsky-Clearshift/tv';
const ADMIN = document.body.dataset.mode === 'admin';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const b64d = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const b64e = u => btoa(String.fromCharCode(...new Uint8Array(u))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const ls = { get: k => { try { return localStorage.getItem(k) } catch (e) { return null } }, set: (k, v) => { try { localStorage.setItem(k, v) } catch (e) {} } };

async function derive(code) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: new TextEncoder().encode(SALT), iterations: IT, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const dec = async (key, j) => JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(j.iv) }, key, b64d(j.ct))));
async function enc(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { iv: b64e(iv), ct: b64e(ct), updated_at: new Date().toISOString() };
}

/* ---------- טעינה ---------- */
// צפייה: מ-GitHub Pages (מתעדכן תוך ~1 דק'). מנהל: ישר מה-API (מיידי) עם הטוקן.
async function fetchFile(name) {
  if (ADMIN && ls.get('oq_tok')) {
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${name}?t=${Date.now()}`, { headers: { Authorization: 'Bearer ' + ls.get('oq_tok'), Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (r.status === 404) return { json: null, sha: null };
    if (!r.ok) throw new Error('github ' + r.status);
    const j = await r.json();
    return { json: JSON.parse(new TextDecoder().decode(b64d(j.content.replace(/\n/g, '')))), sha: j.sha };
  }
  const r = await fetch(name + '?t=' + Date.now(), { cache: 'no-store' });
  return { json: r.ok ? await r.json() : null, sha: null };
}

/* ---------- סדר התור ---------- */
const IL = ts => new Date(ts && ts.length === 10 ? ts + 'T12:00:00+02:00' : ts);
const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const tz = { timeZone: 'Asia/Jerusalem' };
const dm = d => d.toLocaleDateString('he-IL', { ...tz, day: '2-digit', month: '2-digit' }).replace('/', '.');
const hm = d => d.toLocaleTimeString('he-IL', { ...tz, hour: '2-digit', minute: '2-digit' });
const heday = d => 'יום ' + DAYS[new Date(d.toLocaleString('en-US', tz)).getDay()] + ' ' + dm(d);
const REP = { 'Gidon Gross': 'גדעון', 'Yitzy Roseman': 'איצי', 'Yuval Taglicht': 'יובל', 'Yosef Chaim Cohen': 'יוסי', 'Yosi Chaim Cohen': 'יוסי', 'Sapir Kuznitsky': 'ספיר', 'Daniel Persky': 'דניאל' };
const rep = r => REP[r.salesperson] || r.salesperson || '';
const rid = r => r.dynamics_onboarding_id || r.id || r.company_name;
const norm = s => String(s || '').replace(/[\s."'״׳,\-]|\(.*?\)/g, '').replace(/בעמ|ער|ltd|llc|inc/gi, '').toLowerCase();

let S = { rows: [], stat: {} }, OV = {}, OVsha = null;

// כללי התצוגה (22.11): יוצא רק מי שב-Power BI · פעולה/שובר = תג ירוק · "לא נספר" 24 שעות · AGORA חלון שחור ונעלם אחרי שנפתח
function visible() {
  const pbi = new Set((S.stat.powerbi_clients || []).map(c => norm(c.name)));
  return S.rows.filter(r => !pbi.has(norm(r.company_name))).map(r => r.status === 'transacted' ? { ...r, status: 'opened', action: r.action || 'out' } : r)
    .filter(r => !(r.agora && r.status === 'opened'))
    .filter(r => !(r.no_count && r.status === 'opened' && r.deposit_sent_at && Date.now() - IL(r.deposit_sent_at) > 864e5));
}
function columns() {
  const done = r => r.deposit_sent_at, R = visible();
  const opened = R.filter(r => r.status === 'opened' && done(r)).sort((a, b) => done(b) > done(a) ? 1 : -1);
  const work = R.filter(r => r.status === 'in_progress' || (r.status === 'opened' && !done(r)));
  const queueNat = R.filter(r => r.status === 'queue').sort((a, b) => (!!b.pinned - !!a.pinned) || String(a.submitted_date || '9').localeCompare(String(b.submitted_date || '9')));
  const notqNat = R.filter(r => !['opened', 'in_progress', 'transacted', 'queue'].includes(r.status));
  // מפתח טבעי: מקום בתור; מי שלא בתור — אחרי כולם
  const nat = new Map(); queueNat.forEach((r, i) => nat.set(rid(r), i)); notqNat.forEach((r, i) => nat.set(rid(r), 1000 + i));
  const key = r => OV[rid(r)] && OV[rid(r)].key != null ? OV[rid(r)].key : nat.get(rid(r));
  const inQ = r => (OV[rid(r)] && OV[rid(r)].col) ? OV[rid(r)].col === 'queue' : r.status === 'queue';
  const pool = [...queueNat, ...notqNat];
  const queue = pool.filter(inQ).sort((a, b) => key(a) - key(b));
  const notq = pool.filter(r => !inQ(r)).sort((a, b) => key(a) - key(b));
  return { opened, work, queue, notq, key };
}

/* ---------- ציור ---------- */
const chip = (t, k) => `<span class="chip ${k}">${{ ok: '✓', bad: '✗', warn: '!' }[k]} ${esc(t)}</span>`;
function sup(r) {
  if (r.suppliers == null) return '';
  const src = r.suppliers.some(s => s.kind === 'source') || /ע"ר|עמותה/.test(r.company_name);
  const lab = src ? 'מקורות כספים' : 'ספקים';
  const c = r.suppliers.map(s => chip(s.name, s.opened ? 'ok' : 'bad')).join('') || chip('לא הוקמו ' + lab, 'bad');
  return `<div class="chips"><span class="lbl">${lab}:</span>${c}</div>`;
}
function vch(r) {
  if (r.voucher_usd == null) return '';
  if (!r.voucher_usd) return `<div class="chips">${chip('אין שובר', 'bad')}</div>`;
  return `<div class="chips"><span class="lbl">שובר:</span>${chip('$' + Number(r.voucher_usd).toLocaleString('en-US'), 'ok')}${r.voucher_note ? `<span class="lbl">${esc(r.voucher_note)}</span>` : ''}</div>`;
}
const ctl = (r, col) => !ADMIN || !col ? '' : `<div class="ctl">${col === 'queue' ? '<button data-a="up" title="קדם">▲</button><button data-a="down" title="הורד">▼</button><button data-a="out" title="הוצא מהתור">⤓</button>' : '<button data-a="in" title="הכנס לתור">⤒ לתור</button>'}</div>`;
const moved = r => { const o = OV[rid(r)]; return !!(o && (o.col || o.key != null)) };
// תיוג חודש ע"י מנהל (22.11): לאיזה חודש החשבון נספר בסגירות — החודש / החודש הבא
const ym = (d, add = 0) => { const x = new Date(d.toLocaleString('en-US', tz)); x.setDate(1); x.setMonth(x.getMonth() + add); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') };
const mtag = r => { const m = OV[rid(r)] && OV[rid(r)].m; if (!m) return ''; return m === ym(new Date()) ? `<div class="mtag cur">📅 החודש</div>` : m === ym(new Date(), 1) ? `<div class="mtag nxt">📅 לחודש הבא</div>` : `<div class="mtag">📅 נספר ל${MONTHS[Number(m.split('-')[1]) - 1]}</div>` };
const mctl = r => { if (!ADMIN) return ''; const m = OV[rid(r)] && OV[rid(r)].m, a = ym(new Date()), b = ym(new Date(), 1); const btn = (v, t) => `<button data-m="${v}" class="${m === v ? 'on' : ''}">${t}</button>`; return `<div class="ctl mctl">${btn(a, 'החודש')}${btn(b, 'חודש הבא')}${m ? '<button data-m="">✕</button>' : ''}</div>` };
const mgr = r => moved(r) ? `<div class="mgr">התערבות מנהל${ADMIN ? ' <button data-a="reset" title="החזר למקום הטבעי">✕</button>' : ''}</div>` : '';

function card(cls, r, inner, col) {
  return `<div class="card ${cls}${moved(r) ? ' glow' : ''}" data-id="${esc(rid(r))}" data-col="${col || ''}">${mgr(r)}${mtag(r)}${inner}${ctl(r, col)}${mctl(r)}</div>`;
}
function render() {
  const { opened, work, queue, notq } = columns();
  const now = new Date();
  const keys = new Set((S.stat.powerbi_clients || []).map(c => norm(c.name)));
  // פס יעד (22.11): פעולות החודש מ-Power BI מול יעד 45 ויעד מתיחה 60, ופילוח לפי איש מכירות
  let n = keys.size; const T1 = S.stat.target || 45, T2 = S.stat.stretch || 60, pct = x => Math.min(x / T2, 1) * 100;
  const by = {}; (S.stat.powerbi_clients || []).forEach(c => { const k = REP[c.salesperson] || c.salesperson || 'אחר'; by[k] = (by[k] || 0) + 1 });
  const reps = Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, c]) => `<span>${esc(k)} <b>${c}</b></span>`).join('');
  // תוספות לפס (22.11): מתויגים להחודש שעוד לא ב-Power BI — ירוק=נפתח, צהוב=בתור/בעבודה, אדום=לא בתור. לא כולל "לא נספר"
  const cm = ym(now), tg = r => !r.no_count && OV[rid(r)] && OV[rid(r)].m === cm;
  const eo = opened.filter(tg).length, ey = work.filter(tg).length + queue.filter(tg).length, er = notq.filter(tg).length;
  let at = pct(n); const seg = (c, k) => { if (!c) return ''; const w = pct(n + c) - pct(n); const h = `<div class="gx ${k}" style="right:${at}%;width:${Math.max(0, Math.min(w, 100 - at))}%">${c}</div>`; at = Math.min(100, at + w); n += c; return h };
  const n0 = n; const rem = T2 - n0 - eo - ey - er; const sx = seg(eo, 'xo') + seg(ey, 'xy') + seg(er, 'xr') + (rem > 0 && at < 100 ? `<div class="gx xg" style="right:${at}%;width:${100 - at}%">${rem}</div>` : ''); n = n0;
  const ext = (eo || ey || er) ? ` <span class="gleg">${eo ? `<em class="xo">+${eo} נפתחו</em>` : ''}${ey ? `<em class="xy">+${ey} בתור/בעבודה</em>` : ''}${er ? `<em class="xr">+${er} לא בתור</em>` : ''} <small>(מתויגים להחודש)</small></span>` : '';
  $('goal').innerHTML = S.stat.month ? `<div class="gtxt"><b>${n}</b> פעולות ב${MONTHS[now.getMonth()]} · ${n >= T2 ? 'עברנו את יעד המתיחה! 🎉' : n >= T1 ? `היעד הושג! עוד ${T2 - n} ליעד ${T2}` : `עוד ${T1 - n} ליעד ${T1}`}${ext}</div><div class="gtrack"><div class="gfill${n >= T1 ? ' done' : ''}" style="width:${pct(n)}%"></div>${sx}<span class="gmk" style="right:${pct(T1)}%"><i>${T1}</i></span><span class="gmk g2" style="right:calc(100% - 2px)"><i>${T2}</i></span></div><div class="greps">${reps}</div>` : '';
  $('date').textContent = heday(now) + ' · ' + hm(now);
  const nc = r => r.no_count ? '<div class="nc">-לא נספר בסגירות-</div>' : '';
  const badge = r => r.action === 'out' ? (r.voucher_funded ? 'יש פעולה ושובר, כסף יצא' : 'יש פעולה, כסף יצא') : r.action === 'funded' && r.voucher_funded ? 'יש פעולה ושובר עם מימון' : r.voucher_funded ? 'יש שובר עם מימון' : '';
  const det = r => { const d = `<div class="meta">${rep(r)} · נפתח ${heday(IL(r.deposit_sent_at))} · ${hm(IL(r.deposit_sent_at))} · ${esc(r.opening_rep || '')} · חשבון ${esc(r.account_number || '')}</div>${sup(r)}${vch(r)}`, b = badge(r); return b ? `<div class="det"><div class="fade">${d}</div><span class="bd">${esc(b)}</span></div>` : d };
  const op = opened.map(r => card('g' + (badge(r) ? ' act' : ''), r, `${nc(r)}<div class="nm">✓ ${esc(r.company_name)}</div>${det(r)}`));
  const agc = (r, extra, col) => card('ag', r, `<div class="agt">💀 AGORA</div><div class="agn">${esc(r.company_name)}</div>${extra}`, col);
  const wk = work.map(r => r.agora ? agc(r, `<div class="agm">בפתיחה אצל ${esc(r.opening_rep || '—')}</div>`) : card('b', r, `<div class="nm">${esc(r.company_name)}</div><div class="meta">${rep(r)} · בפתיחה אצל ${esc(r.opening_rep || '—')}</div>`));
  const qu = queue.map((r, i) => r.agora ? agc(r, `<span class="num agnum">${i + 1}</span>`, 'queue') : card('q', r, `<div class="row"><span class="num">${i + 1}</span><div><div class="nm">${esc(r.company_name)}${r.pinned ? ' 📌' : ''}</div><div class="meta">${rep(r)}${r.submitted_date ? ' · הוגש ' + dm(IL(r.submitted_date)) : ''}${r.compliance_date ? ' · אושר בציות ' + dm(IL(r.compliance_date)) : ''}</div>${r.status !== 'queue' ? `<div class="chips">${(r.missing || []).map(x => chip(x, x.includes(':') ? 'warn' : 'bad')).join('')}</div>` : ''}</div></div>`, 'queue'));
  const mis = r => (r.missing && r.missing.length ? r.missing : [{ waiting_sumsub: 'SUMSUB', waiting_docs: 'זוהוסיין' }[r.status] || 'ציות']).map(x => chip(x, x.includes(':') ? 'warn' : 'bad')).join('');
  const nq = notq.map(r => card('m', r, `<div class="nm">${esc(r.company_name)}</div><div class="meta">${rep(r)}</div><div class="chips">${mis(r)}</div><div class="why">${esc(r.wait_reason || '')}</div>`, 'notq'));
  const L = [op, wk, qu, nq], sub = L.map(x => Math.max(1, Math.ceil(x.length / 4)));   // עד 4 בתת-עמודה (19.11)
  $('grid').style.gridTemplateColumns = L.map((x, i) => x.length ? sub[i] + 'fr' : '.6fr').join(' ');
  const col = (t, s, c, cards, n) => `<section><div class="head" style="--c:${c}"><h2>${t}</h2><span class="cnt">${cards.length}</span></div><p class="sub">${s}</p><div class="cards" style="grid-template-columns:repeat(${n},minmax(0,1fr));grid-template-rows:repeat(${Math.min(Math.max(cards.length, 1), 4)},auto)">${cards.join('') || '<div class="empty">אין כרגע</div>'}</div></section>`;
  $('grid').innerHTML = col('נפתחו', 'נשלחו הוראות הפקדה — עד שמופיעים ב-Power BI', '#1f9d55', op, sub[0]) + col('בעבודה', 'בפתיחה אצל צוות האונבורדינג', '#0284c7', wk, sub[1]) + col('בתור', 'Data Received + אושר בציות + חתומים, לפי סדר', '#167398', qu, sub[2]) + col('עוד לא בתור', 'מה חסר כדי להיכנס לתור · צהוב = כמעט', '#d70015', nq, sub[3]);
  if (false) {
    const rows = notq.map(r => `<div class="arow" data-id="${esc(rid(r))}"><div><b>${esc(r.company_name)}</b> · ${rep(r)}<div class="chips">${mis(r)}</div></div><button class="go sm" data-ins="1">⤒ הכנס לתור</button></div>`).join('');
    $('admin').innerHTML = `<h3>לא בתור — להכניס לתור (${notq.length})</h3><p class="sub">נכנס לסוף התור, ואז אפשר להזיז אותו עם ▲▼. מסומן "התערבות מנהל".</p>${rows || '<div class="empty">כל החשבונות כבר בתור</div>'}`;
  }
  fit();
}
// התאמה למסך: מגדיל/מקטין את כל הגדלים עד שהכל נכנס בגובה החלון (טלוויזיה)
function fit() {
  if (ADMIN) { document.documentElement.style.setProperty('--k', 1.35); return; }
  let lo = .35, hi = 2.2; const p = document.querySelector('.page');
  for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; document.documentElement.style.setProperty('--k', m); (p.scrollHeight <= innerHeight + 1) ? lo = m : hi = m; }
  document.documentElement.style.setProperty('--k', lo);
}
addEventListener('resize', () => S.rows.length && fit());

/* ---------- ניהול: הזזה ושמירה ---------- */
let saveT = null;
function move(id, a) {
  const { queue, notq, key } = columns();
  const all = [...queue, ...notq], r = all.find(x => rid(x) === id); if (!r) return;
  if (a === 'reset') { const m = OV[id] && OV[id].m; if (m) OV[id] = { m }; else delete OV[id]; return after(); }
  let list = queue.some(x => rid(x) === id) ? queue : notq, col = list === queue ? 'queue' : 'notq';
  const keepM = o => Object.assign(o, OV[id] && OV[id].m ? { m: OV[id].m } : {});
  if (a === 'in') { list = queue; col = 'queue'; const last = queue[queue.length - 1]; OV[id] = keepM({ col, key: last ? key(last) + 1 : 0 }); return after(); }
  if (a === 'out') { const first = notq[0]; OV[id] = keepM({ col: 'notq', key: first ? key(first) - 1 : 1000 }); return after(); }
  const i = list.findIndex(x => rid(x) === id), j = a === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= list.length) return;
  const nb = list[j], nb2 = list[a === 'up' ? j - 1 : j + 1];
  const k1 = key(nb), k2 = nb2 ? key(nb2) : (a === 'up' ? k1 - 2 : k1 + 2);
  OV[id] = keepM({ col, key: (k1 + k2) / 2 });
  after();
}
function setMonth(id, m) { const o = Object.assign({}, OV[id]); if (m) o.m = m; else delete o.m; if (Object.keys(o).length) OV[id] = o; else delete OV[id]; after(); }
function after() { render(); status('שומר…'); clearTimeout(saveT); saveT = setTimeout(save, 1200); }
async function save() {
  try {
    const cur = await fetchFile('o.json'); OVsha = cur.sha;
    const body = await enc(VKEY, { ov: OV, by: 'admin' });
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/o.json`, { method: 'PUT', headers: { Authorization: 'Bearer ' + ls.get('oq_tok'), Accept: 'application/vnd.github+json' },
      body: JSON.stringify({ message: 'התערבות מנהל בתור ' + hm(new Date()), content: btoa(JSON.stringify(body)), ...(OVsha ? { sha: OVsha } : {}) }) });
    if (!r.ok) throw new Error((await r.json()).message || r.status);
    status('נשמר ✓ — המסך יתעדכן תוך כדקה');
  } catch (e) { status('שמירה נכשלה: ' + e.message, true) }
}
const status = (t, bad) => { const s = $('save'); if (s) { s.textContent = t; s.className = bad ? 'bad' : '' } };

/* ---------- כניסה ---------- */
let VKEY = null;
function pad(title, hint, onCode, extra = '') {
  const k = [1, 2, 3, 4, 5, 6, 7, 8, 9, '⌫', 0, '✓'].map(x => `<button class="k" data-k="${x}">${x}</button>`).join('');
  $('msg').innerHTML = `<div><div class="t">${title}</div><div class="h">${hint}</div><input id="c" inputmode="numeric" autocomplete="off"><div id="pad">${k}</div>${extra}</div>`;
  $('msg').style.display = 'flex';
  const c = $('c'), go = () => onCode(c.value.trim());
  document.querySelectorAll('#pad .k').forEach(b => b.onclick = () => { const v = b.dataset.k; v === '⌫' ? c.value = c.value.slice(0, -1) : v === '✓' ? go() : c.value += v });
  c.onkeydown = e => e.key === 'Enter' && go(); setTimeout(() => c.focus(), 50);
}
async function enter() {
  const h = location.hash.match(/^#(\d{3,})$/); if (h) { ls.set(ADMIN ? 'oq_admin' : 'oq_code', h[1]); history.replaceState(null, '', location.pathname) }
  if (ADMIN) {
    const a = ls.get('oq_admin');
    if (!a) return pad('ניהול התור', 'קוד מנהל', v => { ls.set('oq_admin', v); enter() });
    try { const j = (await fetchFile('a.json')).json; if (!j) throw new Error('github 404'); ls.set('oq_code', (await dec(await derive(a), j)).view) }
    catch (e) { ls.set('oq_admin', ''); if (/github 40[13]/.test(e.message)) ls.set('oq_tok', ''); return pad('ניהול התור', /github 40[13]/.test(e.message) ? 'מפתח הגישה של גיטהאב לא תקף — הזן קוד ואז מפתח חדש' : /github 404/.test(e.message) ? 'קובץ ההגדרות (a.json) עוד לא הועלה לריפו' : 'קוד מנהל שגוי — נסה שוב', v => { ls.set('oq_admin', v); enter() }) }
    if (!ls.get('oq_tok')) {
      $('msg').innerHTML = `<div><div class="t">חיבור לשמירה</div><div class="h">מפתח הגישה של גיטהאב לריפו tv (פעם אחת במכשיר הזה)</div><input id="tk" type="password" style="width:30em;font-size:16px"><br><button id="tb" class="go">שמור</button></div>`;
      $('msg').style.display = 'flex'; $('tb').onclick = () => { ls.set('oq_tok', $('tk').value.trim()); enter() }; return;
    }
  }
  const code = ls.get('oq_code');
  if (!code) return pad('מצב התור באונבורדינג', 'הזן קוד צפייה', v => { ls.set('oq_code', v); VKEY = null; enter() });
  VKEY = VKEY || await derive(code);
  try { await load(true) } catch (e) { ls.set('oq_code', ''); VKEY = null; return pad('מצב התור באונבורדינג', 'הקוד לא נכון — נסה שוב', v => { ls.set('oq_code', v); enter() }) }
  $('msg').style.display = 'none';
  setInterval(() => load(false).catch(() => {}), ADMIN ? 20000 : 30000);
}
let lastSig = '';
async function load(first) {
  const s = await fetchFile('s.json'); if (!s.json) { $('msg').innerHTML = '<div class="t">מחכה לעדכון הראשון של התור…</div>'; $('msg').style.display = 'flex'; return }
  const o = await fetchFile('o.json');
  const sig = s.json.iv + (o.json ? o.json.iv : '');
  if (sig === lastSig && !first) return tickClock();
  if (saveT && !first) return; // לא לדרוס הזזה שעוד לא נשמרה
  S = await dec(VKEY, s.json); OV = o.json ? (await dec(VKEY, o.json)).ov || {} : {}; lastSig = sig;
  S.updated = s.json.updated_at; render(); tickClock();
}
function tickClock() {
  $('date').textContent = heday(new Date()) + ' · ' + hm(new Date());   // שעון חי למעלה; למטה = מתי הנתונים עודכנו
  if (!S.updated) return; const u = new Date(S.updated), m = (Date.now() - u) / 60000;
  $('st').textContent = 'נתונים עודכנו ' + hm(u) + ' · ' + heday(u); $('st').className = m > 180 ? 'old' : '';
}
enter();
setTimeout(() => location.reload(), 6 * 3600 * 1000);
if ('wakeLock' in navigator && !ADMIN) { const w = () => navigator.wakeLock.request('screen').catch(() => {}); w(); document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && w()) }
document.addEventListener('click', e => { if (!ADMIN) return; const mb = e.target.closest('button[data-m]'); if (mb) return setMonth(mb.closest('.card').dataset.id, mb.dataset.m); const i = e.target.closest('button[data-ins]'); if (i) return move(i.closest('.arow').dataset.id, 'in'); const b = e.target.closest('button[data-a]'); if (b) move(b.closest('.card').dataset.id, b.dataset.a) });
