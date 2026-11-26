(() => {
  const $app = document.getElementById('app');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = async (p) => { const r = await fetch(p); if (!r.ok) throw new Error(r.status); return r.json(); };
  const fmt = (n) => (n == null ? '–' : Number(n).toLocaleString('en-US'));
  const short = (n) => {
    if (n == null) return '–';
    if (n >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  };
  const ago = (ts) => {
    if (!ts) return 'ยังไม่เคยอัปเดต';
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 30) return 'เมื่อสักครู่';
    if (s < 3600) return `${Math.floor(s / 60)} นาทีที่แล้ว`;
    if (s < 86400) return `${Math.floor(s / 3600)} ชม.ที่แล้ว`;
    return `${Math.floor(s / 86400)} วันที่แล้ว`;
  };
  const hm = (sec) => { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return h ? `${h} ชม. ${m} นาที` : `${m} นาที`; };
  const clock = (ts) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} · ${d.getDate()}/${d.getMonth() + 1}`; };
  const mmss = (sec) => (sec == null ? '' : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} นาที`);
  const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

  const RARITY = { common: '#9aa6b2', rare: '#4aa3ff', epic: '#b06bff', legendary: '#ffc23d', mythic: 'linear-gradient(90deg,#ff5f8f,#ffb547,#5cf0b0,#5cc8ff,#b06bff)', secret: 'linear-gradient(90deg,#ff4d4d,#ffd34d,#4dff88,#4dc3ff,#c44dff)' };
  const meta = (name) => (window.ITEM_META || {})[name] || {};
  const itemIcon = (name, size = 16) => {
    const m = meta(name);
    if (m.icon) return `<img class="dot-ico" src="${esc(m.icon)}" width="${size}" height="${size}" alt="">`;
    const h = hue(name);
    return `<span class="dot-ico" style="background:linear-gradient(135deg,hsl(${h} 80% 65%),hsl(${(h + 60) % 360} 70% 45%))"></span>`;
  };
  const itemArt = (name) => {
    const m = meta(name);
    if (m.icon) return `<img src="${esc(m.icon)}" alt="">`;
    const h = hue(name);
    const initials = name.split(/\s+/).filter((w) => /^[A-Za-z0-9]/.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    return `<div class="gen" style="background:linear-gradient(135deg,hsl(${h} 85% 65%),hsl(${(h + 70) % 360} 75% 42%));box-shadow:0 0 24px hsl(${h} 90% 60% / .35)">${esc(initials)}</div>`;
  };
  const rarityBg = (name) => RARITY[meta(name).rarity] || '#3a4a5a';

  const placeholder = `<svg class="ph" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#4b5d70"/><stop offset="1" stop-color="#26323e"/></linearGradient></defs>
    <rect x="36" y="10" width="28" height="24" rx="4" fill="url(#g)"/><rect x="30" y="36" width="40" height="30" rx="3" fill="url(#g)"/>
    <rect x="18" y="36" width="10" height="28" rx="3" fill="url(#g)"/><rect x="72" y="36" width="10" height="28" rx="3" fill="url(#g)"/>
    <rect x="31" y="67" width="18" height="26" rx="3" fill="url(#g)"/><rect x="51" y="67" width="18" height="26" rx="3" fill="url(#g)"/></svg>`;
  const avatar = (a) => (a.roblox_user_id
    ? `<img src="/api/avatar/${a.roblox_user_id}" alt="" loading="lazy" onerror="this.outerHTML=window.__ph">`
    : placeholder);
  window.__ph = placeholder;

  const segs = (pct, cls = '') => {
    let h = '';
    for (let i = 0; i < 10; i++) { const v = pct - i * 10; h += `<i class="${v >= 10 ? 'on' : v >= 5 ? 'half' : ''}"></i>`; }
    return `<div class="segs ${cls}">${h}</div>`;
  };
  const statusPill = (a) => {
    if (a.status === 'done') return '<span class="pill done">เสร็จแล้ว</span>';
    if (a.status === 'queued') return '<span class="pill queued">รอคิว</span>';
    if (a.status === 'cancelled') return '<span class="pill off">ยกเลิก</span>';
    return a.online ? '<span class="pill">กำลังฟาร์ม</span>' : '<span class="pill off">ออฟไลน์</span>';
  };
  const progressText = (p) => {
    if (p.type === 'hours_won') return { big: `${p.current.toFixed(1)} / ${p.target} ชม.`, label: 'นับเวลาเฉพาะแมตช์ที่ชนะ' };
    if (p.type === 'item') return { big: `${short(p.current)} / ${short(p.target)}`, label: p.unit };
    if (p.type === 'matches') return { big: `${p.current} / ${p.target}`, label: 'แมตช์ที่ชนะ' };
    return { big: `${p.pct === 100 ? 1 : 0} / 1`, label: 'ความคืบหน้า' };
  };

  // ---------------- router ----------------
  let timer = null;
  function go(path) { history.pushState({}, '', path); route(); }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-link]');
    if (a && !e.metaKey && !e.ctrlKey) { e.preventDefault(); go(a.getAttribute('href')); }
  });
  window.addEventListener('popstate', route);

  function route() {
    clearInterval(timer);
    const m = location.pathname.match(/^\/a\/([a-f0-9]{24})/);
    if (m) accountPage(m[1]); else dashboard();
  }

  // ---------------- dashboard ----------------
  const dashState = { status: 'all', page: 1 };
  async function dashboard() {
    const load = async () => {
      const [ov, list] = await Promise.all([
        api('/api/overview'),
        api(`/api/accounts?status=${dashState.status}&page=${dashState.page}&perPage=12`),
      ]);
      const featured = list.items.find((a) => a.status === 'farming') || list.items[0];
      const pages = Math.max(1, Math.ceil(list.total / list.perPage));
      const tabs = [['all', 'งานทั้งหมด', ov.total], ['farming', 'กำลังฟาร์ม', ov.farming], ['queued', 'รอคิว', ov.queued], ['done', 'เสร็จแล้ว', ov.done], ['cancelled', 'ยกเลิก', ov.cancelled]];
      $app.innerHTML = `
        <div class="dash-head">
          <h1>สถานะการฟาร์ม<span class="sub">อัปเดตอัตโนมัติทุก 30 วินาที</span></h1>
          <div class="stats">
            <div class="stat"><i>⚡</i><b class="num">${fmt(ov.farming)}</b><span>กำลังฟาร์ม</span></div>
            <div class="stat"><b class="num">${fmt(ov.online)}</b><span>ออนไลน์</span></div>
            <div class="stat"><b class="num">${fmt(ov.matches_24h)}</b><span>แมตช์ 24 ชม.</span></div>
            <div class="stat"><b class="num">${fmt(ov.total)}</b><span>งานทั้งหมด</span></div>
            <div class="stat"><b class="num">${fmt(ov.days_open)}</b><span>วันที่เปิด</span></div>
          </div>
        </div>
        ${featured ? `
        <section class="panel hero">
          <div class="avatar-stage">${avatar(featured)}</div>
          <div>
            <div class="game"><span class="game-ico"></span>${esc(featured.game)} &nbsp;${statusPill(featured)}</div>
            <h2>${esc(featured.name)}</h2>
            <div class="job">${esc(featured.job_title || '—')}</div>
            <div class="progress-label"><span>ความคืบหน้า</span><span class="pct num">${featured.progress.pct}<small>%</small></span></div>
            ${segs(featured.progress.pct)}
            <div class="progress-label"><span>อัปเดตล่าสุด ${ago(featured.last_seen)}</span></div>
            <a class="cta" href="/a/${featured.id}" data-link>ดูรายละเอียดงาน ↗</a>
          </div>
        </section>` : '<div class="panel empty">ยังไม่มีงาน — สร้างบัญชีผ่าน admin API (ดู README)</div>'}
        <section class="panel">
          <div class="tabs">${tabs.map(([k, l, c]) => `<button class="tab ${dashState.status === k ? 'active' : ''}" data-st="${k}">${l} <b class="num">${fmt(c)}</b></button>`).join('')}</div>
          <div class="grid-cards">
            ${list.items.map((a) => `
              <a class="acard" href="/a/${a.id}" data-link>
                <div class="avatar-stage">${avatar(a)}</div>
                <div class="name">${esc(a.name)}</div>
                <div class="job">${esc(a.job_title || '—')}</div>
                <div class="row">${segs(a.progress.pct, 'sm')}<span class="num">${a.progress.pct}%</span></div>
                ${statusPill(a)}
              </a>`).join('') || '<div class="empty">ไม่มีงานในหมวดนี้</div>'}
          </div>
          <div class="pager">
            <span>แสดง ${list.items.length ? (list.page - 1) * list.perPage + 1 : 0}–${(list.page - 1) * list.perPage + list.items.length} จาก ${fmt(list.total)}</span>
            <div class="btns">
              <button data-pg="${list.page - 1}" ${list.page <= 1 ? 'disabled' : ''}>‹ ก่อนหน้า</button>
              <button class="on">${list.page}</button>
              <button data-pg="${list.page + 1}" ${list.page >= pages ? 'disabled' : ''}>ถัดไป ›</button>
            </div>
          </div>
        </section>`;
      $app.querySelectorAll('[data-st]').forEach((b) => b.onclick = () => { dashState.status = b.dataset.st; dashState.page = 1; load(); });
      $app.querySelectorAll('[data-pg]').forEach((b) => b.onclick = () => { dashState.page = +b.dataset.pg; load(); });
    };
    try { await load(); } catch { $app.innerHTML = '<div class="empty">โหลดข้อมูลไม่สำเร็จ</div>'; }
    timer = setInterval(() => load().catch(() => {}), 30000);
  }

  // ---------------- account page ----------------
  async function accountPage(id) {
    const state = { tab: 'matches', q: '', shop: 'all' };
    let cache = {};

    const load = async () => {
      const [a, matches, items, inv, shop] = await Promise.all([
        api(`/api/accounts/${id}`), api(`/api/accounts/${id}/matches?limit=50`), api(`/api/accounts/${id}/items`),
        api(`/api/accounts/${id}/inventory`), api(`/api/accounts/${id}/purchases`),
      ]);
      cache = { a, matches, items, inv, shop };
      render();
    };

    const matchHeader = (a, last) => {
      const cur = a.in_match ? a.current_match : null;
      const m = cur || last;
      if (!m) return `<div class="matchhead"><div><div class="map">ยังไม่มีข้อมูลแมตช์</div></div></div>`;
      const team = (m.team || []).slice(0, 6);
      const mode = m.mode || 'Match';
      return `
        <div class="matchhead">
          <div>
            <span class="pill ${cur ? '' : 'off'}">${cur ? 'อยู่ในแมตช์' : 'แมตช์ล่าสุด'}</span>
            <div class="mode ${/portal/i.test(mode) ? 'portal' : ''}">${esc(mode)}</div>
            <div class="map">${esc(m.map || '')}${m.act ? ` <small>· ${esc(m.act)}</small>` : ''}${m.difficulty ? ` <small>· ${esc(m.difficulty)}${m.tier ? ` · Tier ${m.tier}` : ''}</small>` : ''}</div>
            ${m.modifier ? `<div class="mod"><b>${esc(m.modifier)}</b></div>` : ''}
          </div>
          <div class="team">${team.map((u) => `<div class="unit" title="${esc(u.name)}"><em>${esc(u.name)}</em>${u.level ? `Lv.${u.level}` : ''}</div>`).join('')}</div>
          ${m.wave != null ? `<div class="wave"><span>เวฟ</span><b class="num">${m.wave}</b></div>` : '<div></div>'}
        </div>`;
    };

    const thumbBg = (map) => { const h = hue(map || ''); return `background:linear-gradient(160deg,hsl(${h} 45% 38%),hsl(${(h + 40) % 360} 50% 14%))`; };

    const tabMatches = ({ matches }) => {
      if (!matches.items.length) return '<div class="empty">ยังไม่มีประวัติการเล่น — รอ macro ส่ง webhook มา</div>';
      const first = matches.items[matches.items.length - 1], last = matches.items[0];
      return `
        <div class="section-sub"><b>${matches.items.length}</b> แมตช์ล่าสุด${matches.total > matches.items.length ? ` จากทั้งหมด ${fmt(matches.total)}` : ''} · ${clock(first.ts)} – ${clock(last.ts)}</div>
        <div class="list">${matches.items.map((m) => `
          <div class="mrow">
            ${m.shots && m.shots.length
              ? `<a class="thumb shot ${/portal/i.test(m.mode || '') ? 'portal' : ''}" href="${esc(m.shots[m.shots.length - 1])}" target="_blank" rel="noopener" style="background-image:linear-gradient(180deg,transparent 55%,#000b),url('${esc(m.shots[m.shots.length - 1])}')">${esc(m.mode || '')}${m.shots.length > 1 ? ` · ${m.shots.length} รูป` : ''}</a>`
              : `<div class="thumb ${/portal/i.test(m.mode || '') ? 'portal' : ''}" style="${thumbBg(m.map)}">${esc(m.mode || '')}</div>`}
            <div>
              <div class="title">${m.result === 'win' ? '<span class="w">ชนะ</span>' : m.result === 'lose' ? '<span class="l">แพ้</span>' : ''}${esc(m.map || 'ไม่ทราบด่าน')}</div>
              <div class="meta">${[m.difficulty && esc(m.difficulty), m.tier && `<span class="tier">Tier ${m.tier}</span>`, m.wave != null && `เวฟ ${m.wave}`, m.duration_sec && mmss(m.duration_sec), m.modifier && esc(m.modifier), m.portal_owner === 'self' ? '<b>ประตูของคุณ</b>' : m.portal_owner === 'party' ? 'ประตูของเพื่อนร่วมตี้' : ''].filter(Boolean).join(' · ')}</div>
              <div class="chips">${m.rewards.map((r) => `<span class="chip">${itemIcon(r.item)}${esc(r.item)} <b class="num">×${fmt(r.qty)}</b></span>`).join('') || '<span class="meta">ไม่มีของดรอป</span>'}</div>
            </div>
            <div class="time num">${clock(m.ts)}</div>
          </div>`).join('')}
        </div>`;
    };

    const itemGrid = (rows) => {
      const q = state.q.toLowerCase();
      const list = rows.filter((r) => r.item.toLowerCase().includes(q));
      return `
        <label class="search">🔍<input id="q" placeholder="ค้นหาไอเท็ม" value="${esc(state.q)}"></label>
        <div class="items">${list.map((r) => `
          <div class="item" style="--rar:${rarityBg(r.item)}">
            <div class="art">${itemArt(r.item)}</div>
            <span class="qty num">${short(r.qty)}</span>
            <span class="nm">${esc(r.item)}</span>
          </div>`).join('') || '<div class="empty">ไม่พบไอเท็ม</div>'}</div>`;
    };

    const tabShop = ({ shop }) => {
      const shops = ['all', ...shop.byShop.map((s) => s.shop)];
      const rows = shop.items.filter((p) => state.shop === 'all' || p.shop === state.shop);
      return `
        <div class="tabs">${shops.map((s) => `<button class="tab ${state.shop === s ? 'active' : ''}" data-shop="${esc(s)}">${s === 'all' ? 'ทั้งหมด' : esc(s)} <b>${s === 'all' ? shop.items.length : shop.byShop.find((x) => x.shop === s).c}</b></button>`).join('')}</div>
        <div class="list">${rows.map((p) => `
          <div class="shoprow">
            <div class="art" style="width:40px;height:40px">${itemIcon(p.item, 40).replace('class="dot-ico"', 'class="dot-ico" data-big')}</div>
            <div><b>${esc(p.item)}</b><div class="meta">${esc(p.shop || '')} · จ่าย ${fmt(p.price)} ${esc(p.currency || '')} · ซื้อ ${fmt(p.qty)}</div></div>
            <div class="r">${clock(p.ts)}${p.balance_after != null ? `<br>เหลือ ${short(p.balance_after)}` : ''}</div>
          </div>`).join('') || '<div class="empty">ยังไม่มีการซื้อของ</div>'}</div>`;
    };

    function render() {
      const { a, matches, items, inv, shop } = cache;
      const p = a.progress, pt = progressText(p);
      const ico = { matches: '⚔', items: '◈', inv: '🎒', shop: '🏪' };
      const tabs = [['matches', matches.total, 'ประวัติการเล่น'], ['items', items.length, 'ไอเท็มที่ได้รับ'], ['inv', inv.length, 'กระเป๋า'], ['shop', shop.items.length, 'ร้านค้า']];
      let body = '';
      if (state.tab === 'matches') body = tabMatches(cache);
      else if (state.tab === 'items') body = itemGrid(items);
      else if (state.tab === 'inv') body = inv.length ? itemGrid(inv) : '<div class="empty">macro ยังไม่ได้ส่ง snapshot กระเป๋า (field <code>inventory</code>)</div>';
      else body = tabShop(cache);

      $app.innerHTML = `
        <div class="acc">
          <aside class="panel side">
            <div class="stage-wrap">
              <a class="back" href="/" data-link>←</a>
              ${statusPill(a)}
              <div class="avatar-stage" style="min-height:320px">${avatar(a)}</div>
            </div>
            <div class="who">
              <h1>${esc(a.name)}</h1>
              <div class="game"><span class="game-ico"></span><div>${esc(a.job_title || '—')}<small>${esc(a.game)}</small></div></div>
            </div>
            <div class="prog">
              <div class="progress-label"><span>${esc(pt.label)}</span></div>
              <div class="progress-label"><b class="num">${pt.big}</b><span class="pct num">${p.pct}<small>%</small></span></div>
              ${segs(p.pct)}
              ${a.summon_count ? `<div class="note">สุ่มตู้ไปแล้ว <b class="num">${fmt(a.summon_count)}</b> ครั้ง</div>` : ''}
              <div class="note">ฟาร์มไปแล้ว <b>${hm(a.farmed_sec)}</b> (นับจากเริ่มงาน)</div>
            </div>
            <div class="kpis">
              <div><span>เลเวล</span><b class="num">${fmt(a.level)}</b></div>
              <div><span>เพชร</span><b class="num">${short(a.gems)}</b></div>
              <div><span>เลเวลพาส</span><b class="num">${fmt(a.battlepass)}</b></div>
            </div>
            <div class="foot"><span>🖥 ${esc(a.machine || '—')}</span><span>อัปเดต ${ago(a.last_seen)}</span></div>
          </aside>
          <section class="panel main-col">
            ${matchHeader(a, matches.items[0])}
            <div class="tabcards">${tabs.map(([k, n, l]) => `
              <button class="tabcard ${state.tab === k ? 'active' : ''}" data-tab="${k}">
                <span class="ico">${ico[k]}</span><div><b class="num">${fmt(n)}</b><span>${l}</span></div>
              </button>`).join('')}</div>
            ${body}
          </section>
        </div>`;

      $app.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { state.tab = b.dataset.tab; state.q = ''; render(); });
      $app.querySelectorAll('[data-shop]').forEach((b) => b.onclick = () => { state.shop = b.dataset.shop; render(); });
      const q = document.getElementById('q');
      if (q) q.oninput = () => { state.q = q.value; const pos = q.selectionStart; render(); const nq = document.getElementById('q'); nq.focus(); nq.setSelectionRange(pos, pos); };
    }

    try { await load(); } catch { $app.innerHTML = '<div class="empty">ไม่พบงานนี้ <a href="/" data-link>กลับหน้าแรก</a></div>'; return; }
    timer = setInterval(() => { if (!document.getElementById('q') || document.activeElement?.id !== 'q') load().catch(() => {}); }, 30000);
  }

  route();
})();
