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


async function typeText(text) {
  for (const ch of text) await vscode.commands.executeCommand('type', { text: ch });
}

test('auto-indent: Enter after \\begin indents, and \\end moves back', async () => {
  const doc = await vscode.workspace.openTextDocument({ language: 'latex', content: '\\begin{itemize}' });
  const ed = await vscode.window.showTextDocument(doc);
  const end = doc.lineAt(0).range.end;
  ed.selection = new vscode.Selection(end, end);
  await typeText('\n');
  await typeText('\\item one\n');
  assert.ok(/^ {2}\\item one$/.test(doc.lineAt(1).text), 'item not indented: ' + JSON.stringify(doc.lineAt(1).text));
  await typeText('\\end{itemize}');
  // (typing "{" auto-closes it, so a stray "}" after the command is expected in this synthetic test)
  assert.ok(doc.lineAt(2).text.startsWith('\\end{itemize}'), '\\end not outdented: ' + JSON.stringify(doc.lineAt(2).text));
});

test('auto-indent: Enter between \\begin and \\end puts the cursor on an indented line', async () => {
  const doc = await vscode.workspace.openTextDocument({ language: 'latex', content: '\\begin{equation}\\end{equation}' });
  const ed = await vscode.window.showTextDocument(doc);
  const pos = new vscode.Position(0, '\\begin{equation}'.length);
  ed.selection = new vscode.Selection(pos, pos);
  await typeText('\n');
  const got = JSON.stringify(doc.getText());
  assert.strictEqual(doc.lineCount, 3, 'expected 3 lines, got ' + got);
  assert.strictEqual(doc.lineAt(1).text, '  ', 'middle line wrong: ' + got);
  assert.strictEqual(doc.lineAt(2).text, '\\end{equation}', 'end line wrong: ' + got);
});

test('a 60-page paper renders without freezing the viewer', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidekick-big-'));
  const file = path.join(dir, 'main.tex');
  const para = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. '.repeat(40);
  let body = '';
  for (let i = 1; i <= 60; i++) body += '\\section{Part ' + i + '}\n' + para + '\n\\newpage\n';
  fs.writeFileSync(file, '\\documentclass{article}\n\\begin{document}\n' + body + '\\end{document}\n');
  const doc = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(doc);
  await vscode.commands.executeCommand('latexEditor.openPreview');
  await vscode.commands.executeCommand('latexEditor.compile');
  const tBuilt = Date.now();
  const s = await until(async () => { const x = await state(); return x.previewState.rendered && x.previewState.rendered.pages >= 60 ? x : null; }, 120000, 'all 60 pages to render');
  console.log('         build done -> all pages shown after ' + (Date.now() - tBuilt) + ' ms');
  console.log('         first render of 60 pages took ' + s.previewState.rendered.ms + ' ms');
  // Is the viewer still responsive right after rendering?
  await vscode.commands.executeCommand('latexEditor._ping');
  const t0 = Date.now();
  const p = await until(async () => (await state()).previewState.pong, 5000, 'preview to answer a ping');
  console.log('         ping answered in ' + (Date.now() - t0) + ' ms');
  assert.ok(s.previewState.rendered.pages >= 60);
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
