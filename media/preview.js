(function () {
  const vscode = acquireVsCodeApi();
  const pagesEl = document.getElementById('pages');
  const zoomEl = document.getElementById('zoom');
  const infoEl = document.getElementById('info');

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

  let doc = null;
  let scale = (vscode.getState() || {}).scale || 1.2;
  let fitWidth = false;
  let renderId = 0;
  let pending = null;   // highlight to apply once pages exist

  async function render() {
    if (!doc) return;
    const id = ++renderId;
    const keep = window.scrollY / Math.max(1, document.body.scrollHeight);
    const dpr = window.devicePixelRatio || 1;
    const frag = document.createDocumentFragment();
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      if (id !== renderId) return;
      const s = fitWidth ? (window.innerWidth - 32) / page.getViewport({ scale: 1 }).width : scale;
      const vp = page.getViewport({ scale: s * dpr });
      const wrap = document.createElement('div');
      wrap.className = 'page';
      wrap.dataset.page = n;
      wrap.dataset.scale = s;
      const c = document.createElement('canvas');
      c.width = vp.width; c.height = vp.height;
      c.style.width = vp.width / dpr + 'px'; c.style.height = vp.height / dpr + 'px';
      wrap.appendChild(c);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      if (id !== renderId) return;
      frag.appendChild(wrap);
      if (n === 1) zoomEl.textContent = Math.round(s * 100) + '%';
    }
    pagesEl.replaceChildren(frag);
    infoEl.textContent = doc.numPages + ' page' + (doc.numPages === 1 ? '' : 's');
    if (pending) { highlight(pending); pending = null; } else window.scrollTo(0, keep * document.body.scrollHeight);
  }

  function highlight(r) {
    const wrap = pagesEl.querySelector('.page[data-page="' + r.page + '"]');
    if (!wrap) { pending = r; return; }
    const s = parseFloat(wrap.dataset.scale);
    const box = document.createElement('div');
    box.className = 'hl';
    box.style.left = r.h * s + 'px';
    box.style.top = (r.v - r.H) * s + 'px';
    box.style.width = Math.max(r.W, 6) * s + 'px';
    box.style.height = Math.max(r.H, 6) * s + 'px';
    wrap.appendChild(box);
    const top = wrap.getBoundingClientRect().top + window.scrollY + (r.v - r.H) * s;
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
    vscode.setState({ scale });
    render();
  }
  document.getElementById('in').onclick = () => setScale(scale * 1.15);
  document.getElementById('out').onclick = () => setScale(scale / 1.15);
  document.getElementById('fit').onclick = () => { fitWidth = true; render(); };
  window.addEventListener('resize', () => { if (fitWidth) render(); });

  // ---- Issues list (errors / warnings / typesetting notes) ----
  const issuesEl = document.getElementById('issues');
  const bannerEl = document.getElementById('banner');
  const issuesBtn = document.getElementById('issuesBtn');
  let issuesOpen = null;   // null = automatic: open when there are errors

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;   // textContent only: log text is untrusted
    return n;
  };

  function showIssues(m) {
    const list = m.issues || [];
    const n = (s) => list.filter((i) => i.severity === s).length;
    const errors = n('error'), warnings = n('warning'), notes = n('info');
    issuesBtn.textContent = 'Issues: ' + errors + ' ✗  ' + warnings + ' ⚠' + (notes ? '  ' + notes + ' ℹ' : '');
    issuesBtn.className = errors ? 'bad' : warnings ? 'warn' : '';
    bannerEl.style.display = m.stale ? 'block' : 'none';
    bannerEl.textContent = m.stale ? 'Build failed — showing the last successful PDF. Fix the errors below and save again.' : '';
    issuesEl.replaceChildren();
    if (!list.length) issuesEl.appendChild(el('div', null, 'No errors or warnings.')).id = 'none';
    const order = { error: 0, warning: 1, info: 2 };
    [...list].sort((a, b) => order[a.severity] - order[b.severity]).forEach((it) => {
      const row = el('div', 'issue ' + it.severity);
      const head = el('div');
      head.appendChild(el('span', 'msg', it.message));
      const where = (it.file || '') + (it.line ? ':' + it.line : '');
      if (where) head.appendChild(el('span', 'loc', where));
      row.appendChild(head);
      if (it.hint) row.appendChild(el('div', 'hint', it.hint));
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
    if (m.type !== 'pdf') return;
    try {
      const bin = atob(m.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      await workerReady;
      doc = await pdfjsLib.getDocument({ data: bytes }).promise;
      await render();
    } catch (err) { show('Could not render PDF: ' + (err && err.message || err)); }
  });

  vscode.postMessage({ type: 'ready' });
})();
