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
  return runTool('latexmk', args, path.dirname(main), (s) => output.append(s));
}

function publishDiagnostics(log, main) {
  diagnostics.clear();
  const byFile = new Map();
  const re = /^(.+?\.tex):(\d+): (.*)$/gm;
  let m;
  while ((m = re.exec(log))) {
    const file = path.resolve(path.dirname(main), m[1]);
    const line = Math.max(0, parseInt(m[2], 10) - 1);
    const d = new vscode.Diagnostic(new vscode.Range(line, 0, line, 1000), m[3], vscode.DiagnosticSeverity.Error);
    d.source = 'latex';
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(d);
  }
  for (const [f, ds] of byFile) diagnostics.set(vscode.Uri.file(f), ds);
}

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
  const t0 = Date.now();
  const { ok, log } = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'LaTeX: building ' + path.basename(main) + '…' },
    () => runLatexmk(main));
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  publishDiagnostics(log, main);
  const pdf = path.join(path.dirname(main), cfg().get('outDir'), path.basename(main).replace(/\.tex$/i, '.pdf'));
  if (fs.existsSync(pdf)) { lastPdf = pdf; lastMain = main; sendPdf(); }
  const stamp = new Date().toLocaleTimeString();
  setStatus(ok ? '$(check) LaTeX built ' + stamp : '$(error) LaTeX failed', ok ? 'Built in ' + secs + 's at ' + stamp : 'Compile errors — see Problems');
  if (ok) vscode.window.setStatusBarMessage('$(check) Build complete (' + secs + 's)', 5000);
  else vscode.window.showErrorMessage('LaTeX build failed — see Problems / Output.');
  if (!ok) output.show(true);
  running = false;
  if (queued) { const q = queued; queued = false; compile(q); }
}

let status;
function setStatus(text, tip) {
  status.text = text; status.tooltip = tip; status.show();
}

function sendPdf() {
  if (!panel || !lastPdf || !fs.existsSync(lastPdf)) return;
  panel.webview.postMessage({ type: 'pdf', data: fs.readFileSync(lastPdf).toString('base64') });
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
  w.onDidReceiveMessage((msg) => { if (msg.type === 'ready') sendPdf(); if (msg.type === 'error') output.appendLine('[preview] ' + msg.message);
    if (msg.type === 'reverse' && lastMain) {
      synctex.reverse(msg.page, msg.x, msg.y, path.dirname(lastMain), lastPdf).then((ok) => { if (!ok) vscode.window.setStatusBarMessage('No source location for that spot', 3000); });
    }
  });
  panel.onDidDispose(() => { panel = undefined; });
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
    vscode.commands.registerCommand('latexEditor.openPreview', () => {
      openPreview(context);
      const ed = vscode.window.activeTextEditor;
      if (ed) compile(ed.document);
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
