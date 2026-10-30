const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

let panel;
let output;
let diagnostics;
let running = false;
let queued = false;
let lastPdf;
let lastMain;

const { runTool, cfg } = require('./exec');
const { parseLog, diagnoseSetup } = require('./parse');
let lastIssues;
const previewState = { rendered: null, errors: [], renders: 0, pong: null };   // what the preview panel reported back (used by the integration test)
const synctex = require('./synctex');

function resolveMain(doc) {
  const conf = cfg().get('mainFile');
  const ws = vscode.workspace.getWorkspaceFolder(doc.uri);
  if (conf && ws) return path.join(ws.uri.fsPath, conf);
  const magic = /^\s*%\s*!TEX\s+root\s*=\s*(.+?)\s*$/im.exec(doc.getText());
  if (magic) return path.resolve(path.dirname(doc.uri.fsPath), magic[1]);
  return doc.uri.fsPath;
}

function runLatexmk(main) {
  const engine = { pdflatex: '-pdf', xelatex: '-xelatex', lualatex: '-lualatex' }[cfg().get('engine')];
  const args = [engine, '-interaction=nonstopmode', '-file-line-error', '-synctex=1', `-output-directory=${cfg().get('outDir')}`, path.basename(main)];
  return runTool('latexmk', args, path.dirname(main), (s) => output.append(s), cfg().get('buildTimeoutSeconds') * 1000);
}

const SEVERITY = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

/** Read the .log latexmk wrote (more complete than its console output); fall back to the console text. */
function readIssues(main, consoleLog) {
  const logFile = path.join(path.dirname(main), cfg().get('outDir'), path.basename(main).replace(/\.tex$/i, '.log'));
  let text = consoleLog;
  try { text = fs.readFileSync(logFile, 'utf8'); } catch { /* use console output */ }
  const showTypesetting = cfg().get('showTypesettingNotes');
  return parseLog(text)
    .filter((it) => showTypesetting || it.kind !== 'typesetting')
    .map((it) => ({ ...it, path: path.resolve(path.dirname(main), it.file || path.basename(main)) }));
}

function publishIssues(issues) {
  diagnostics.clear();
  const byFile = new Map();
  for (const it of issues) {
    const line = Math.max(0, (it.line || 1) - 1);
    const d = new vscode.Diagnostic(new vscode.Range(line, 0, line, 1000), it.hint ? `${it.message}\n→ ${it.hint}` : it.message, SEVERITY[it.severity]);
    d.source = 'latex';
    if (!byFile.has(it.path)) byFile.set(it.path, []);
    byFile.get(it.path).push(d);
  }
  for (const [f, ds] of byFile) diagnostics.set(vscode.Uri.file(f), ds);
}

const countOf = (issues, sev) => issues.filter((i) => i.severity === sev).length;

async function compile(doc) {
  doc = doc || (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document);
  if (!doc || !/^(latex|tex)$/.test(doc.languageId) && !doc.fileName.endsWith('.tex')) {
    vscode.window.showWarningMessage('Open a .tex file to compile.');
    return;
  }
  if (running) { queued = doc; return; }
  running = true;
  await vscode.workspace.saveAll(false);
  const main = resolveMain(doc);
  output.clear();
  output.appendLine(`> compiling ${main}`);
  setStatus('$(sync~spin) LaTeX', 'Compiling…');
  sendBusy('Building ' + path.basename(main) + '… (the first build can take a few seconds while WSL starts)');
  const t0 = Date.now();
  const { ok, log } = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'LaTeX: building ' + path.basename(main) + '…' },
    () => runLatexmk(main));
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const issues = readIssues(main, log);
  publishIssues(issues);
  const errors = countOf(issues, 'error');
  const warnings = countOf(issues, 'warning');
  const setupProblem = !errors && !ok ? diagnoseSetup(log) : undefined;
  const pdf = path.join(path.dirname(main), cfg().get('outDir'), path.basename(main).replace(/\.tex$/i, '.pdf'));
  const havePdf = fs.existsSync(pdf);
  if (havePdf && !setupProblem) { lastPdf = pdf; lastMain = main; }
  lastIssues = { issues, ok: ok && !errors, secs, stale: !ok || errors > 0 };
  sendIssues();
  if (lastPdf) sendPdf();
  const stamp = new Date().toLocaleTimeString();
  const counts = `${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`;
  if (ok && !errors) {
    setStatus((warnings ? '$(warning) ' : '$(check) ') + counts, `Built in ${secs}s at ${stamp}. Click to build again.`);
    vscode.window.setStatusBarMessage('$(check) Build complete (' + secs + 's)', 5000);
  } else {
    setStatus('$(error) ' + counts, `Build failed at ${stamp}. Click to build again.`);
    const text = setupProblem || (errors ? `LaTeX build failed: ${counts}.` : 'LaTeX build failed without a recognisable error. See the log.');
    // Not awaited: a toast left open must not block the next build.
    vscode.window.showErrorMessage(text, 'Show log', ...(setupProblem ? ['Open settings'] : ['Show problems'])).then((choice) => {
      if (choice === 'Show log') output.show(true);
      else if (choice === 'Open settings') vscode.commands.executeCommand('workbench.action.openSettings', 'latexEditor');
      else if (choice === 'Show problems') vscode.commands.executeCommand('workbench.actions.view.problems');
    });
  }
  running = false;
  if (queued) { const q = queued; queued = false; compile(q); }
}

let status;
function setStatus(text, tip) {
  status.text = text; status.tooltip = tip; status.show();
}

let lastSent = '';
/** Send the PDF to the preview; skipped when it has not changed since the last send (unless forced). */
function sendPdf(force) {
  if (!panel || !lastPdf || !fs.existsSync(lastPdf)) return;
  const st = fs.statSync(lastPdf);
  const stamp = `${lastPdf}|${st.mtimeMs}|${st.size}`;
  if (!force && stamp === lastSent) return;
  lastSent = stamp;
  panel.webview.postMessage({ type: 'pdf', data: fs.readFileSync(lastPdf).toString('base64') });
}

let busyText = '';
function sendBusy(text) {
  busyText = text;
  if (panel) panel.webview.postMessage({ type: 'status', text });
}

const outputPdf = (main) => path.join(path.dirname(main), cfg().get('outDir'), path.basename(main).replace(/\.tex$/i, '.pdf'));

function sendIssues() {
  busyText = '';
  if (panel && lastIssues) panel.webview.postMessage({ type: 'issues', ...lastIssues });
}

function openPreview(context) {
  if (panel) { panel.reveal(vscode.ViewColumn.Beside, true); return; }
  const media = vscode.Uri.joinPath(context.extensionUri, 'media');
  panel = vscode.window.createWebviewPanel('latexPreview', 'PDF Preview', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [media],
  });
  const w = panel.webview;
  const u = (f) => w.asWebviewUri(vscode.Uri.joinPath(media, f));
  const html = fs.readFileSync(path.join(context.extensionPath, 'media', 'preview.html'), 'utf8')
    .replace(/{{csp}}/g, w.cspSource)
    .replace('{{pdfjs}}', u('pdf.min.js').toString())
    .replace('{{worker}}', u('pdf.worker.min.js').toString())
    .replace('{{script}}', u('preview.js').toString());
  w.html = html;
  w.onDidReceiveMessage((msg) => {
    if (msg.type === 'ready') { sendPdf(true); if (busyText) sendBusy(busyText); else sendIssues(); }
    if (msg.type === 'error') { previewState.errors.push(msg.message); output.appendLine('[preview] ' + msg.message); }
    if (msg.type === 'rendered') { previewState.rendered = { pages: msg.pages, width: msg.width, height: msg.height, ms: msg.ms }; previewState.renders++; }
    if (msg.type === 'pong') previewState.pong = msg;
    if (msg.type === 'goto') {
      vscode.workspace.openTextDocument(msg.path).then((d) => {
        const pos = new vscode.Position(Math.max(0, (msg.line || 1) - 1), 0);
        return vscode.window.showTextDocument(d, { viewColumn: vscode.ViewColumn.One, selection: new vscode.Range(pos, pos) });
      }, () => vscode.window.showWarningMessage('Could not open ' + msg.path));
    }
    if (msg.type === 'showLog') output.show(true);
    if (msg.type === 'reverse' && lastMain) {
      synctex.reverse(msg.page, msg.x, msg.y, path.dirname(lastMain), lastPdf).then((ok) => { if (!ok) vscode.window.setStatusBarMessage('No source location for that spot', 3000); });
    }
  });
  panel.onDidDispose(() => { panel = undefined; lastSent = ''; });
}

function activate(context) {
  output = vscode.window.createOutputChannel('LaTeX Editor');
  diagnostics = vscode.languages.createDiagnosticCollection('latex-editor');
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  status.command = 'latexEditor.compile';
  require('./editing').register(context);
  require('./citations').register(context);
  require('./ai').register(context);
  context.subscriptions.push(output, diagnostics, status,
    vscode.commands.registerCommand('latexEditor.compile', () => compile()),
    vscode.commands.registerCommand('latexEditor.showLog', () => output.show(true)),
    vscode.commands.registerCommand('latexEditor._state', () => ({ previewState, lastIssues, lastPdf, lastMain, panelOpen: !!panel })),
    // Test hooks (not listed in package.json): ping the preview to measure responsiveness.
    vscode.commands.registerCommand('latexEditor._ping', () => { previewState.pong = null; if (panel) panel.webview.postMessage({ type: 'ping', t: Date.now() }); }),
    vscode.commands.registerCommand('latexEditor.openPreview', () => {
      openPreview(context);
      const ed = vscode.window.activeTextEditor;
      if (!ed) return;
      // Show the PDF from the last build straight away; a rebuild (slow while WSL starts) then refreshes it.
      const existing = outputPdf(resolveMain(ed.document));
      if (fs.existsSync(existing)) { lastPdf = existing; lastMain = resolveMain(ed.document); sendPdf(true); }
      else sendBusy('Building ' + path.basename(ed.document.fileName) + '… (the first build can take a few seconds while WSL starts)');
      compile(ed.document);
    }),
    vscode.commands.registerCommand('latexEditor.syncToPdf', async () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed || !lastPdf || !lastMain) { vscode.window.showInformationMessage('Build the document first (Ctrl+S).'); return; }
      openPreview(context);
      const p = ed.selection.active;
      const recs = await synctex.forward(ed.document.uri.fsPath, p.line + 1, p.character + 1, path.dirname(lastMain), lastPdf);
      if (!recs.length) { vscode.window.setStatusBarMessage('No PDF location for this line', 3000); return; }
      panel.webview.postMessage({ type: 'highlight', rect: recs[0] });
    }),
    vscode.commands.registerCommand('latexEditor.clean', () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed) return;
      const dir = path.join(path.dirname(resolveMain(ed.document)), cfg().get('outDir'));
      fs.rmSync(dir, { recursive: true, force: true });
      vscode.window.showInformationMessage('Build files removed.');
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (!cfg().get('compileOnSave') || !doc.fileName.endsWith('.tex')) return;
      if (!panel && cfg().get('autoOpenPreview')) openPreview(context);
      compile(doc);
    }));
}

function deactivate() {}

module.exports = { activate, deactivate };
