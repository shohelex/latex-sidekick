(function () {
  const vscode = acquireVsCodeApi();
  const pagesEl = document.getElementById('pages');
  const zoomEl = document.getElementById('zoom');
  const infoEl = document.getElementById('info');
  const bannerEl = document.getElementById('banner');

  const show = (m) => {
    pagesEl.replaceChildren(Object.assign(document.createElement('pre'), { textContent: m, style: 'color:#f88;padding:12px;white-space:pre-wrap' }));
    vscode.postMessage({ type: 'error', message: m });
  };
  window.addEventListener('error', (e) => show('Preview error: ' + e.message));
  window.addEventListener('unhandledrejection', (e) => show('Preview error: ' + (e.reason && e.reason.message || e.reason)));

  // Workers must be same-origin, so load the worker source into a blob URL.
  const workerReady = fetch(document.body.dataset.worker).then((r) => r.text()).then((t) => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([t], { type: 'text/javascript' }));
  });

  const dpr = window.devicePixelRatio || 1;
  let doc = null;
  let sizes = [];            // page sizes at scale 1 (PDF points)
  let pages = [];            // { n, el, scale, w, h, canvas, state, stale, near, task, gen }
  let docGen = 0;            // bumps whenever the document or layout changes
  let scale = (vscode.getState() || {}).scale || 1.2;
  // Fit the pane's width by default, so the PDF follows the window when it is split or resized; zooming by hand turns that off.
  let fitWidth = (vscode.getState() || {}).fit !== false;
  let pending = null;        // highlight to apply once pages exist
  let reported = false;
  let t0 = 0;

  // Pages are laid out as empty, correctly sized boxes straight away; only pages near the viewport are drawn.
  // This keeps long papers responsive: the first page appears at once instead of after every page is drawn.
  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const pg = e.target._pg;
      if (!pg) continue;
      pg.near = e.isIntersecting;
      if (pg.near) paint(pg); else release(pg);
    }
  }, { rootMargin: '1200px 0px' });

  const paneWidth = () => document.documentElement.clientWidth;   // excludes the scrollbar
  const scaleFor = (n) => (fitWidth ? Math.max(0.2, (paneWidth() - 32) / sizes[n - 1].w) : scale);

  async function paint(pg) {
    if (!doc) return;
    if (pg.state === 'painting') { pg.again = true; return; }
    if (pg.state === 'done' && !pg.stale) return;
    const gen = pg.gen = docGen;
    pg.state = 'painting';
    pg.stale = false;
    try {
      const page = await doc.getPage(pg.n);
      const vp = page.getViewport({ scale: pg.scale * dpr });
      const c = document.createElement('canvas');
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      c.style.width = pg.w + 'px'; c.style.height = pg.h + 'px';
      pg.task = page.render({ canvasContext: c.getContext('2d'), viewport: vp });
      await pg.task.promise;
      pg.task = null;
      if (gen !== docGen || !pg.near) { pg.state = 'empty'; }
      else {
        if (pg.canvas) pg.canvas.replaceWith(c); else pg.el.insertBefore(c, pg.el.firstChild);
        pg.canvas = c;
        pg.state = 'done';
        if (!reported) {
          reported = true;
          vscode.postMessage({ type: 'rendered', pages: doc.numPages, width: c.width, height: c.height, ms: Math.round(performance.now() - t0) });
        }
      }
    } catch (err) {
      pg.state = 'empty';
      pg.task = null;
      if (!err || err.name !== 'RenderingCancelledException') show('Could not draw page ' + pg.n + ': ' + (err && err.message || err));
    }
    if ((pg.again || pg.state === 'empty' || pg.stale) && pg.near && doc) { pg.again = false; paint(pg); }
  }

  function release(pg) {
    if (pg.task) { try { pg.task.cancel(); } catch { /* already finished */ } }
    if (pg.canvas && pg.state === 'done') { pg.canvas.remove(); pg.canvas = null; pg.state = 'empty'; }
  }

  async function layout() {
    if (!doc) return;
    const gen = ++docGen;
    const keep = window.scrollY / Math.max(1, document.body.scrollHeight);
    pages.forEach((p) => p.task && p.task.cancel());
    // Read page sizes (cheap: no drawing).
    if (sizes.length !== doc.numPages) {
      sizes = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const vp = (await doc.getPage(n)).getViewport({ scale: 1 });
        sizes.push({ w: vp.width, h: vp.height });
        if (gen !== docGen) return;
      }
    }
    const same = pages.length === doc.numPages && pages.every((p) => Math.abs(p.scale - scaleFor(p.n)) < 1e-6);
    if (same) {
      pages.forEach((p) => { p.stale = true; if (p.near) paint(p); });     // redraw in place: no flash, no scroll jump
    } else {
      observer.disconnect();
      pages = sizes.map((s, i) => {
        const n = i + 1, sc = scaleFor(n);
        const el = document.createElement('div');
        el.className = 'page';
        el.dataset.page = n; el.dataset.scale = sc;
        const w = Math.round(s.w * sc), h = Math.round(s.h * sc);
        el.style.width = w + 'px'; el.style.height = h + 'px';
        const pg = { n, el, scale: sc, w, h, canvas: null, state: 'empty', stale: false, near: false, task: null };
        el._pg = pg;
        return pg;
      });
      pagesEl.replaceChildren(...pages.map((p) => p.el));
      window.scrollTo(0, keep * document.body.scrollHeight);
      pages.forEach((p) => observer.observe(p.el));
    }
    zoomEl.textContent = Math.round(pages[0].scale * 100) + '%';
    vscode.postMessage({ type: 'layout', scale: pages[0].scale, width: paneWidth(), fit: fitWidth });
    infoEl.textContent = doc.numPages + ' page' + (doc.numPages === 1 ? '' : 's');
    if (pending) { const r = pending; pending = null; highlight(r); }
  }

  function highlight(r) {
    const pg = pages[r.page - 1];
    if (!pg) { pending = r; return; }
    const s = pg.scale;
    const box = document.createElement('div');
    box.className = 'hl';
    box.style.left = r.h * s + 'px';
    box.style.top = (r.v - r.H) * s + 'px';
    box.style.width = Math.max(r.W, 6) * s + 'px';
    box.style.height = Math.max(r.H, 6) * s + 'px';
    pg.el.appendChild(box);
    const top = pg.el.getBoundingClientRect().top + window.scrollY + (r.v - r.H) * s;
    window.scrollTo({ top: Math.max(0, top - window.innerHeight / 3), behavior: 'smooth' });
    setTimeout(() => box.remove(), 2500);
  }

  // Double-click a page to jump to the matching source line.
  pagesEl.addEventListener('dblclick', (e) => {
    const wrap = e.target.closest && e.target.closest('.page');
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const s = parseFloat(wrap.dataset.scale);
    vscode.postMessage({ type: 'reverse', page: parseInt(wrap.dataset.page, 10), x: (e.clientX - rect.left) / s, y: (e.clientY - rect.top) / s });
  });

  function setScale(s) {
    fitWidth = false;
    scale = Math.min(4, Math.max(0.4, s));
    vscode.setState({ scale, fit: false });
    layout();
  }
  document.getElementById('in').onclick = () => setScale((fitWidth && pages[0] ? pages[0].scale : scale) * 1.15);
  document.getElementById('out').onclick = () => setScale((fitWidth && pages[0] ? pages[0].scale : scale) / 1.15);
  document.getElementById('fit').onclick = () => { fitWidth = true; vscode.setState({ scale, fit: true }); layout(); };
  let resizeTimer;
  let lastWidth = paneWidth();
  new ResizeObserver(() => {
    const w = paneWidth();
    if (!fitWidth || w < 120 || Math.abs(w - lastWidth) < 4) return;   // hidden panel (width 0) or no real change
    lastWidth = w;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layout, 120);
  }).observe(document.body);

  // ---- Issues list (errors / warnings / typesetting notes) ----
  const issuesEl = document.getElementById('issues');
  const issuesBtn = document.getElementById('issuesBtn');
  let issuesOpen = null;   // null = automatic: open when there are errors

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;   // textContent only: log text is untrusted
    return n;
  };

  function showBanner(text, kind) {
    bannerEl.style.display = text ? 'block' : 'none';
    bannerEl.textContent = text || '';
    bannerEl.dataset.kind = kind || '';
  }

  function showIssues(m) {
    const list = m.issues || [];
    const n = (s) => list.filter((i) => i.severity === s).length;
    const errors = n('error'), warnings = n('warning'), notes = n('info');
    issuesBtn.textContent = 'Issues: ' + errors + ' ✗  ' + warnings + ' ⚠' + (notes ? '  ' + notes + ' ℹ' : '');
    issuesBtn.className = errors ? 'bad' : warnings ? 'warn' : '';
    showBanner(m.stale ? 'Build failed — showing the last successful PDF. Fix the errors below and save again.' : '', 'failed');
    issuesEl.replaceChildren();
    if (!list.length) issuesEl.appendChild(el('div', null, 'No errors or warnings.')).id = 'none';
    const order = { error: 0, warning: 1, info: 2 };
    list.map((it, index) => ({ it, index })).sort((a, b) => order[a.it.severity] - order[b.it.severity]).forEach(({ it, index }) => {
      const row = el('div', 'issue ' + it.severity);
      const head = el('div');
      head.appendChild(el('span', 'msg', it.message));
      const where = (it.file || '') + (it.line ? ':' + it.line : '');
      if (where) head.appendChild(el('span', 'loc', where));
      row.appendChild(head);
      if (it.context) row.appendChild(el('div', 'ctx', it.context));
      if (it.hint) row.appendChild(el('div', 'hint', it.hint));
      const fixBtn = el('button', 'fix', 'Fix with AI');
      fixBtn.title = 'Send this message and the lines around it to Claude, then review the proposed change before it is applied';
      fixBtn.onclick = (ev) => { ev.stopPropagation(); vscode.postMessage({ type: 'fix', index }); };
      row.appendChild(fixBtn);
      row.onclick = () => vscode.postMessage({ type: 'goto', path: it.path, line: it.line });
      issuesEl.appendChild(row);
    });
    const open = issuesOpen === null ? errors > 0 : issuesOpen;
    issuesEl.style.display = open ? 'block' : 'none';
  }
  issuesBtn.onclick = () => {
    issuesOpen = issuesEl.style.display === 'none';
    issuesEl.style.display = issuesOpen ? 'block' : 'none';
  };
  document.getElementById('logBtn').onclick = () => vscode.postMessage({ type: 'showLog' });

  window.addEventListener('message', async (e) => {
    const m = e.data;
    if (m.type === 'highlight') { highlight(m.rect); return; }
    if (m.type === 'issues') { showIssues(m); return; }
    if (m.type === 'status') { showBanner(m.text, 'busy'); return; }
    if (m.type === 'ping') { vscode.postMessage({ type: 'pong', t: m.t, back: Date.now() }); return; }
    if (m.type !== 'pdf') return;
    t0 = performance.now();
    try {
      const bin = atob(m.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      await workerReady;
      const next = await pdfjsLib.getDocument({ data: bytes }).promise;
      const old = doc;
      doc = next;
      reported = false;
      sizes = [];
      await layout();
      if (old) old.destroy();
    } catch (err) { show('Could not render PDF: ' + (err && err.message || err)); }
  });

  vscode.postMessage({ type: 'ready' });
})();
