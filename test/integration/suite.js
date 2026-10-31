// Runs inside the VS Code extension host. Exports run() as @vscode/test-electron expects.
const vscode = require('vscode');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Windows may still hold a handle on a build folder for a moment; cleanup must never fail a test.
const rm = (d) => { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp folder, harmless */ } };
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
// Build, after any build already in flight (e.g. one queued by a save) has finished, and wait for it to end.
async function build() {
  await until(async () => !(await state()).busy, 120000, 'earlier build to finish');
  await vscode.commands.executeCommand('latexEditor.compile');
  await until(async () => !(await state()).busy, 120000, 'build to finish');
}

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
  await build();
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
  await build();
  const s = await state();
  const errs = s.lastIssues.issues.filter((i) => i.severity === 'error');
  assert.ok(errs.length >= 1, 'no error reported');
  assert.strictEqual(errs[0].line, 3);
  assert.ok(errs[0].hint, 'no hint attached');
  assert.strictEqual(s.lastIssues.stale, true);
  const diags = vscode.languages.getDiagnostics(vscode.Uri.file(file));
  assert.ok(diags.some((d) => d.severity === vscode.DiagnosticSeverity.Error && d.range.start.line === 2), 'no squiggle on line 3');
  assert.ok(diags.some((d) => d.severity === vscode.DiagnosticSeverity.Warning), 'undefined reference not reported as a warning');
  rm(dir);
});

test('outline lists sections', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidekick-outline-'));
  const file = path.join(dir, 'a.tex');
  fs.writeFileSync(file, '\\section{One}\ntext\n\\subsection{Two}\n\\section{Three}\n');
  const doc = await vscode.workspace.openTextDocument(file);
  const syms = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', doc.uri);
  assert.deepStrictEqual(syms.map((x) => x.name), ['One', 'Three']);
  assert.deepStrictEqual(syms[0].children.map((x) => x.name), ['Two']);
  rm(dir);
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
  await build();
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
  rm(dir);
});

function tempDoc(body, extra = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidekick-fix-'));
  const file = path.join(dir, 'main.tex');
  fs.writeFileSync(file, '\\documentclass{article}\n' + extra + '\\begin{document}\n' + body + '\n\\end{document}\n');
  return { dir, file };
}

test('lightbulb offers "Add \\usepackage" for a command whose package is missing, and the fix builds', async () => {
  const { dir, file } = tempDoc('Some \\textcolor{red}{red} text.');
  const doc = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(doc);
  await build();
  const diags = vscode.languages.getDiagnostics(doc.uri).filter((d) => d.severity === vscode.DiagnosticSeverity.Error);
  assert.ok(diags.length, 'no error for the missing package');
  assert.strictEqual(doc.getText(diags[0].range), '\\textcolor', 'squiggle should cover just the command');
  const actions = await vscode.commands.executeCommand('vscode.executeCodeActionProvider', doc.uri, diags[0].range);
  const titles = actions.map((a) => a.title);
  assert.ok(titles.includes('Add \\usepackage{xcolor}'), 'no package fix in: ' + titles.join(' | '));
  assert.ok(titles.some((t) => t.startsWith('Fix with Claude')), 'no AI fix in: ' + titles.join(' | '));
  await vscode.workspace.applyEdit(actions.find((a) => a.title === 'Add \\usepackage{xcolor}').edit);
  await doc.save();
  await build();
  const s = await state();
  assert.strictEqual(s.lastIssues.issues.filter((i) => i.severity === 'error').length, 0, JSON.stringify(s.lastIssues.issues));
  rm(dir);
});

test('lightbulb suggests the nearest label for a misspelled \\ref', async () => {
  const { dir, file } = tempDoc('\\section{A}\\label{sec:results}\nSee Section~\\ref{sec:resutls}.');
  const doc = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(doc);
  await build();
  const diags = vscode.languages.getDiagnostics(doc.uri).filter((d) => d.code === 'undefined-ref');
  assert.ok(diags.length, 'undefined reference not reported');
  const actions = await vscode.commands.executeCommand('vscode.executeCodeActionProvider', doc.uri, diags[0].range);
  assert.ok(actions.some((a) => a.title === 'Change "sec:resutls" to "sec:results"'), actions.map((a) => a.title).join(' | '));
  rm(dir);
});

test('Fix with AI sends the message and nearby source, and applies the fix (mock API)', async () => {
  const http = require('http');
  let received;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      received = JSON.parse(body);
      const frag = /<fragment>\n([\s\S]*?)\n<\/fragment>/.exec(received.messages[0].content)[1];
      const reply = `<explanation>Removed the unknown command.</explanation>\n<fix>\n${frag.replace('\\foo ', '')}\n</fix>`;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ content: [{ type: 'text', text: reply }] }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.LATEX_SIDEKICK_API_URL = `http://127.0.0.1:${server.address().port}/v1/messages`;
  process.env.LATEX_SIDEKICK_API_KEY = 'test-key';
  try {
    const { dir, file } = tempDoc('Hello \\foo world.');
    const doc = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(doc);
    await build();
    const err = (await state()).lastIssues.issues.find((i) => i.severity === 'error');
    assert.ok(err, 'expected a build error');
    const out = await vscode.commands.executeCommand('latexEditor.ai.fixIssue', err, { apply: true });
    assert.ok(out && out.applied, 'fix not applied: ' + JSON.stringify(out));
    assert.ok(received.messages[0].content.includes('Undefined control sequence'), 'error message not sent');
    assert.ok(received.messages[0].content.includes('Hello \\foo world.'), 'source line not sent');
    assert.ok(!doc.getText().includes('\\foo'), 'text not fixed: ' + doc.getText());
    await doc.save();
    await build();
    assert.strictEqual((await state()).lastIssues.issues.filter((i) => i.severity === 'error').length, 0);
    rm(dir);
  } finally {
    delete process.env.LATEX_SIDEKICK_API_URL;
    delete process.env.LATEX_SIDEKICK_API_KEY;
    server.close();
  }
});

test('Fix with a free Claude.ai account: prompt is copied, the pasted answer is reviewed and applied (no API key)', async () => {
  delete process.env.LATEX_SIDEKICK_API_KEY;
  const { dir, file } = tempDoc('Hello \\foo world.');
  const doc = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(doc);
  await build();
  const err = (await state()).lastIssues.issues.find((i) => i.severity === 'error');
  const out = await vscode.commands.executeCommand('latexEditor.ai.fixInChat', err, { noOpen: true, watch: false });
  assert.ok(out && out.pending, 'chat flow did not start');
  const clip = await vscode.env.clipboard.readText();
  assert.ok(clip.includes('Undefined control sequence') && clip.includes('Hello \\foo world.') && clip.includes('<fragment>'), 'prompt not on the clipboard');
  assert.ok(clip.includes('ONE fenced code block'), 'chat format instruction missing');
  // The user pastes the prompt into claude.ai and copies the answer's code block back:
  await vscode.env.clipboard.writeText('```\n<explanation>Removed the unknown command.</explanation>\n<fix>\n\\documentclass{article}\n\\begin{document}\nHello world.\n\\end{document}\n</fix>\n```');
  const done = await vscode.commands.executeCommand('latexEditor.ai.applyClipboardFix', { apply: true });
  assert.ok(done && done.applied, 'answer not applied: ' + JSON.stringify(done));
  assert.ok(!doc.getText().includes('\\foo'), 'text not fixed: ' + doc.getText());
  rm(dir);
});
test('free-account flow: the answer is noticed on the clipboard without any extra click', async () => {
  delete process.env.LATEX_SIDEKICK_API_KEY;
  const { dir, file } = tempDoc('Hello \\foo world.');
  const doc = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(doc);
  await build();
  const err = (await state()).lastIssues.issues.find((i) => i.severity === 'error');
  const out = await vscode.commands.executeCommand('latexEditor.ai.fixInChat', err, { noOpen: true, apply: true });
  assert.ok(out && out.pending);
  // the user copies something unrelated first, then the answer
  await vscode.env.clipboard.writeText('unrelated text');
  await sleep(2000);
  assert.ok(doc.getText().includes('\\foo'), 'must not change anything for unrelated clipboard text');
  await vscode.env.clipboard.writeText('```\n<explanation>Removed it.</explanation>\n<fix>\n\\documentclass{article}\n\\begin{document}\nHello world.\n\\end{document}\n</fix>\n```');
  await until(() => !doc.getText().includes('\\foo'), 15000, 'the answer on the clipboard to be applied automatically');
  rm(dir);
});

test('the PDF preview follows the width of its pane when the window layout changes', async () => {
  const doc = await vscode.workspace.openTextDocument(path.join(sampleDir, 'main.tex'));
  await vscode.window.showTextDocument(doc);
  await vscode.commands.executeCommand('latexEditor.openPreview');
  const first = await until(async () => (await state()).previewState.layout, 45000, 'preview layout');
  assert.strictEqual(first.fit, true, 'fit-to-width should be the default');
  await vscode.commands.executeCommand('workbench.action.toggleSidebarVisibility');   // changes the width of the editor area
  const changed = await until(async () => { const l = (await state()).previewState.layout; return l && Math.abs(l.width - first.width) > 20 ? l : null; }, 15000, 'pane width to change');
  assert.ok(Math.abs(changed.scale / first.scale - changed.width / first.width) < 0.15 || changed.scale !== first.scale, `zoom did not follow: ${JSON.stringify(first)} -> ${JSON.stringify(changed)}`);
  assert.notStrictEqual(changed.scale, first.scale, 'zoom stayed the same after the pane changed width');
  await vscode.commands.executeCommand('workbench.action.toggleSidebarVisibility');
});
test('free-account flow: a plain code block (no tags) copied by hand is still offered as the fix', async () => {
  delete process.env.LATEX_SIDEKICK_API_KEY;
  const { dir, file } = tempDoc('Hello \\foo world.');
  const doc = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(doc);
  await build();
  const err = (await state()).lastIssues.issues.find((i) => i.severity === 'error');
  await vscode.commands.executeCommand('latexEditor.ai.fixInChat', err, { noOpen: true, watch: false });
  await vscode.env.clipboard.writeText('```latex\n\\documentclass{article}\n\\begin{document}\nHello world.\n\\end{document}\n```');
  const done = await vscode.commands.executeCommand('latexEditor.ai.applyClipboardFix', { apply: true });
  assert.ok(done && done.applied, JSON.stringify(done));
  assert.strictEqual(doc.getText().trim(), '\\documentclass{article}\n\\begin{document}\nHello world.\n\\end{document}');
  rm(dir);
});
test('free-account flow: text that is not a fix (a piece of the prompt, or plain prose) never changes the file', async () => {
  delete process.env.LATEX_SIDEKICK_API_KEY;
  const { dir, file } = tempDoc('Hello \\foo world.');
  const doc = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(doc);
  await build();
  const before = doc.getText();
  const err = (await state()).lastIssues.issues.find((i) => i.severity === 'error');
  const out = await vscode.commands.executeCommand('latexEditor.ai.fixInChat', err, { noOpen: true, watch: false });
  const piece = out.prompt.slice(out.prompt.indexOf('empty and explain'), out.prompt.indexOf('<fix>') + 5 + 60);   // what selecting the question in the chat gives
  for (const junk of [piece, 'Sure, I removed the unknown command for you.', out.prompt]) {
    await vscode.env.clipboard.writeText(junk);
    const r = await vscode.commands.executeCommand('latexEditor.ai.applyClipboardFix', { apply: true });
    assert.ok(!r || !r.applied, 'junk was applied: ' + junk.slice(0, 40));
    assert.strictEqual(doc.getText(), before, 'file changed by junk: ' + junk.slice(0, 40));
  }
  rm(dir);
});
async function buildsAgainOk() {
  const { dir, file } = tempDoc('All good here.');
  const doc = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(doc);
  await build();
  const s = await state();
  assert.strictEqual(s.busy, false, 'extension is stuck busy');
  assert.strictEqual(s.lastIssues.issues.filter((i) => i.severity === 'error').length, 0, 'a good document no longer builds: ' + JSON.stringify(s.lastIssues.issues));
  rm(dir);
}

test('robustness: an internal failure during a build does not leave the extension stuck', async () => {
  await vscode.commands.executeCommand('latexEditor._injectFailure');
  const { dir, file } = tempDoc('Anything.');
  const doc = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(doc);
  await build();                                    // this build throws internally
  assert.strictEqual((await state()).busy, false, 'still busy after the failure');
  rm(dir);
  await buildsAgainOk();                            // and the next one works
});

test('robustness: a runaway build is stopped, and the next build works', async () => {
  const conf = vscode.workspace.getConfiguration('latexEditor');
  await conf.update('buildTimeoutSeconds', 10, vscode.ConfigurationTarget.Global);
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidekick-loop-'));
    const file = path.join(dir, 'main.tex');
    fs.writeFileSync(file, '\\documentclass{article}\n\\begin{document}\n\\def\\x{\\message{looping looping looping looping}\\x}\\x\n\\end{document}\n');
    const doc = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(doc);
    const t0 = Date.now();
    await build();
    assert.ok(Date.now() - t0 < 60000, 'the runaway build was not stopped in time');
    assert.strictEqual((await state()).busy, false);
    rm(dir);
  } finally {
    await conf.update('buildTimeoutSeconds', undefined, vscode.ConfigurationTarget.Global);
  }
  await buildsAgainOk();
});

test('robustness: whatever the AI service does, the file is untouched and the extension keeps working', async () => {
  const http = require('http');
  let mode = '500';
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (mode === 'hang-up') { req.socket.destroy(); return; }
      const send = (code, body) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(body); };
      if (mode === '500') send(500, '{"error":{"message":"boom"}}');
      else if (mode === '401') send(401, '{"error":{"message":"invalid x-api-key"}}');
      else if (mode === '429') send(429, '{}');
      else if (mode === 'html') send(200, '<html>not json</html>');
      else if (mode === 'empty') send(200, JSON.stringify({ content: [] }));
      else if (mode === 'prose') send(200, JSON.stringify({ content: [{ type: 'text', text: 'Sorry, I cannot help with that.' }] }));
      else if (mode === 'echo') send(200, JSON.stringify({ content: [{ type: 'text', text: '<explanation>x</explanation><fix>Reply in exactly this format and nothing else:</fix>' }] }));
      else if (mode === 'wipe') send(200, JSON.stringify({ content: [{ type: 'text', text: '<explanation>cleaned up</explanation><fix>\n\\documentclass{article}\n</fix>' }] }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  process.env.LATEX_SIDEKICK_API_KEY = 'test-key';
  const { dir, file } = tempDoc('Line one.\nHello \\foo world.\nLine three.\nLine four.\nLine five.');
  try {
    const doc = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(doc);
    await build();
    const before = doc.getText();
    const err = (await state()).lastIssues.issues.find((i) => i.severity === 'error');
    for (const m of ['500', '401', '429', 'html', 'empty', 'prose', 'echo', 'wipe', 'hang-up', 'refused']) {
      mode = m;
      process.env.LATEX_SIDEKICK_API_URL = m === 'refused' ? 'http://127.0.0.1:1/v1/messages' : `http://127.0.0.1:${port}/v1/messages`;
      let r;
      await assert.doesNotReject(async () => { r = await vscode.commands.executeCommand('latexEditor.ai.fixIssue', err, { apply: true }); }, `fix threw in mode ${m}`);
      assert.ok(!r || !r.applied, `a bad answer was applied in mode ${m}: ${JSON.stringify(r)}`);
      assert.strictEqual(doc.getText(), before, `file changed in mode ${m}`);
    }
  } finally {
    delete process.env.LATEX_SIDEKICK_API_URL;
    delete process.env.LATEX_SIDEKICK_API_KEY;
    server.close();
    rm(dir);
  }
  await buildsAgainOk();
});
test('"Set Up This Project" prepares a folder when asked, and only then', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidekick-init-'));
  try {
    const r = await vscode.commands.executeCommand('latexEditor.initProject', { dir, main: 'main.tex', yes: true });
    assert.strictEqual(r.done.length >= 2, true, JSON.stringify(r));
    assert.ok(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8').includes('.latex-build/'));
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, '.vscode', 'settings.json'), 'utf8'))['latexEditor.mainFile'], 'main.tex');
  } finally { rm(dir); }
});
// Optional: point IEEE_PAPER_DIR at a folder holding an IEEE template paper (main.tex, IEEEtran.cls, .bib).
const ieee = process.env.IEEE_PAPER_DIR;
if (ieee) test('an IEEEtran journal paper with BibTeX builds without errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidekick-ieee-'));
  fs.cpSync(ieee, dir, { recursive: true, filter: (s) => !s.includes('.latex-build') });
  const doc = await vscode.workspace.openTextDocument(path.join(dir, 'main.tex'));
  await vscode.window.showTextDocument(doc);
  await build();
  const s = await state();
  const errs = s.lastIssues.issues.filter((i) => i.severity === 'error');
  console.log('         ' + s.lastIssues.issues.map((i) => i.severity + ': ' + i.message).join('\n         '));
  assert.strictEqual(errs.length, 0, JSON.stringify(errs));
  assert.ok(fs.existsSync(path.join(dir, '.latex-build', 'main.pdf')));
  rm(dir);
});

async function run() {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log('  ok   - ' + name); } catch (e) { failed++; console.log('  FAIL - ' + name + '\n         ' + (e && e.message)); }
  }
  if (failed) throw new Error(failed + ' of ' + tests.length + ' integration tests failed');
}

module.exports = { run };


