// Runs inside the VS Code extension host. Exports run() as @vscode/test-electron expects.
const vscode = require('vscode');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('Timed out waiting for: ' + what);
    await sleep(250);
  }
}
const state = () => vscode.commands.executeCommand('latexEditor._state');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const sampleDir = path.resolve(__dirname, '..', '..', 'sample');

test('extension activates and registers its commands', async () => {
  const ext = vscode.extensions.getExtension('local.latex-sidekick');
  assert.ok(ext, 'extension not found');
  await ext.activate();
  const cmds = await vscode.commands.getCommands(true);
  for (const c of ['latexEditor.compile', 'latexEditor.openPreview', 'latexEditor.syncToPdf', 'latexEditor.insertCitation', 'latexEditor.ai.edit']) {
    assert.ok(cmds.includes(c), 'missing command ' + c);
  }
});

test('main.tex opens as LaTeX with word wrap on', async () => {
  const doc = await vscode.workspace.openTextDocument(path.join(sampleDir, 'main.tex'));
  await vscode.window.showTextDocument(doc);
  assert.strictEqual(doc.languageId, 'latex');
  const wrap = vscode.workspace.getConfiguration('editor', { uri: doc.uri, languageId: 'latex' }).get('wordWrap');
  assert.strictEqual(wrap, 'on');
});

test('building a good document produces a PDF and no errors', async () => {
  const pdf = path.join(sampleDir, '.latex-build', 'main.pdf');
  fs.rmSync(path.dirname(pdf), { recursive: true, force: true });
  await vscode.commands.executeCommand('latexEditor.compile');
  assert.ok(fs.existsSync(pdf), 'PDF was not produced');
  const s = await state();
  assert.strictEqual(s.lastIssues.issues.filter((i) => i.severity === 'error').length, 0);
});

test('the preview panel renders the PDF', async () => {
  await vscode.commands.executeCommand('latexEditor.openPreview');
  const s = await until(async () => { const x = await state(); return x.previewState.rendered || x.previewState.errors.length ? x : null; }, 45000, 'preview to render');
  assert.deepStrictEqual(s.previewState.errors, [], 'preview reported errors: ' + s.previewState.errors.join(' | '));
  assert.ok(s.previewState.rendered.pages >= 1, 'no pages rendered');
  assert.ok(s.previewState.rendered.width > 100, 'canvas has no size');
});

test('a broken document reports an error on the right line, with a hint', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidekick-broken-'));
  const file = path.join(dir, 'main.tex');
  fs.writeFileSync(file, '\\documentclass{article}\n\\begin{document}\nHello \\foo world, see \\ref{nope}.\n\\end{document}\n');
  const doc = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(doc);
  await vscode.commands.executeCommand('latexEditor.compile');
  const s = await state();
  const errs = s.lastIssues.issues.filter((i) => i.severity === 'error');
  assert.ok(errs.length >= 1, 'no error reported');
  assert.strictEqual(errs[0].line, 3);
  assert.ok(errs[0].hint, 'no hint attached');
  assert.strictEqual(s.lastIssues.stale, true);
  const diags = vscode.languages.getDiagnostics(vscode.Uri.file(file));
  assert.ok(diags.some((d) => d.severity === vscode.DiagnosticSeverity.Error && d.range.start.line === 2), 'no squiggle on line 3');
  assert.ok(diags.some((d) => d.severity === vscode.DiagnosticSeverity.Warning), 'undefined reference not reported as a warning');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('outline lists sections', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidekick-outline-'));
  const file = path.join(dir, 'a.tex');
  fs.writeFileSync(file, '\\section{One}\ntext\n\\subsection{Two}\n\\section{Three}\n');
  const doc = await vscode.workspace.openTextDocument(file);
  const syms = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', doc.uri);
  assert.deepStrictEqual(syms.map((x) => x.name), ['One', 'Three']);
  assert.deepStrictEqual(syms[0].children.map((x) => x.name), ['Two']);
  fs.rmSync(dir, { recursive: true, force: true });
});

async function run() {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log('  ok   - ' + name); } catch (e) { failed++; console.log('  FAIL - ' + name + '\n         ' + (e && e.message)); }
  }
  if (failed) throw new Error(failed + ' of ' + tests.length + ' integration tests failed');
}

module.exports = { run };
