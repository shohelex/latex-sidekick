const test = require('node:test');
const assert = require('node:assert');
const p = require('../src/parse');

test('parseSections finds nested headings and skips comments', () => {
  const s = p.parseSections('\\section{Intro}\n% \\section{Hidden}\n\\subsection*{Detail}\n');
  assert.deepStrictEqual(s.map((x) => [x.kind, x.title, x.line]), [['section', 'Intro', 0], ['subsection', 'Detail', 2]]);
});

test('countWords ignores markup, math and comments', () => {
  const t = '\\documentclass{article}\n\\begin{document}\nHello \\textbf{big} world $x+y$ % hidden words\n\\cite{a}\n\\end{document}';
  assert.strictEqual(p.countWords(t), 3);
});

test('parseBib handles braces, quotes, bare numbers and nested braces', () => {
  const b = p.parseBib('@article{smith2020,\n author = {Smith, J. and {Big Corp}},\n title = "A {Nice} Title",\n year = 2020\n}\n@comment{x}\n@book{b1, title={T}, year={1999}}');
  assert.strictEqual(b.length, 2);
  assert.strictEqual(b[0].key, 'smith2020');
  assert.strictEqual(b[0].fields.author, 'Smith, J. and {Big Corp}');
  assert.strictEqual(b[0].fields.title, 'A {Nice} Title');
  assert.strictEqual(b[0].fields.year, '2020');
  assert.strictEqual(b[1].fields.year, '1999');
});

test('parseLabels', () => {
  assert.deepStrictEqual(p.parseLabels('\\label{a} % \\label{b}\n\\label{c}'), ['a', 'c']);
});

test('parseSynctex view and edit output', () => {
  const v = p.parseSynctex('SyncTeX result begin\nOutput:x.pdf\nPage:2\nx:10.5\ny:20\nh:1\nv:30\nW:100\nH:9\nSyncTeX result end');
  assert.deepStrictEqual(v[0], { page: 2, x: 10.5, y: 20, h: 1, v: 30, W: 100, H: 9 });
  const e = p.parseSynctex('Output:x.pdf\nInput:/mnt/g/a/main.tex\nLine:7\nColumn:-1');
  assert.deepStrictEqual(e[0], { input: '/mnt/g/a/main.tex', line: 7, column: -1 });
});

test('wslToWin and stripFences', () => {
  assert.strictEqual(p.wslToWin('/mnt/g/a/b.tex'), 'G:\\a\\b.tex');
  assert.strictEqual(p.wslToWin('rel/b.tex'), 'rel/b.tex');
  assert.strictEqual(p.stripFences('```latex\nfoo\n```'), 'foo');
  assert.strictEqual(p.stripFences('foo'), 'foo');
});

test('parseLog: errors, warnings, typesetting notes and hints', () => {
  const log = [
    './main.tex:12: Undefined control sequence.',
    'l.12 \\foo',
    '',
    "LaTeX Warning: Citation `smith' on page 1 undefined on input line 20.",
    '',
    "LaTeX Warning: Reference `fig:a' on page 2 undefined on input line 31.",
    '',
    'LaTeX Warning: There were undefined references.',
    'Overfull \\hbox (12.5pt too wide) in paragraph at lines 40--41',
    'Package hyperref Warning: Token not allowed in a PDF string (Unicode):',
    '(hyperref)                removing `math shift\' on input line 9.',
    "./main.tex:5: LaTeX Error: File `foo.sty' not found.",
  ].join('\n');
  const r = p.parseLog(log);
  const by = (sev) => r.filter((x) => x.severity === sev);
  assert.strictEqual(by('error').length, 2);
  assert.deepStrictEqual([by('error')[0].file, by('error')[0].line], ['main.tex', 12]);
  assert.match(by('error')[0].hint, /misspelled/);
  assert.match(by('error')[1].message, /foo\.sty/);
  assert.match(by('error')[1].hint, /missing/i);
  assert.strictEqual(by('warning').length, 3);
  assert.strictEqual(by('warning')[0].line, 20);
  assert.ok(!by('warning').some((w) => /There were undefined/.test(w.message)));
  assert.match(by('warning')[2].message, /hyperref/);
  assert.strictEqual(by('info')[0].line, 40);
});

test('parseLog: classic "!" errors without file-line-error', () => {
  const r = p.parseLog('! Missing $ inserted.\n<inserted text> \n                $\nl.7 a_b\n');
  assert.strictEqual(r[0].line, 7);
  assert.match(r[0].hint, /math mode/);
});

test('diagnoseSetup', () => {
  assert.match(p.diagnoseSetup('Failed to start wsl.exe: spawn'), /WSL/);
  assert.match(p.diagnoseSetup('sh: 1: latexmk: not found'), /latexmk was not found/);
  assert.match(p.diagnoseSetup('[build timed out]'), /timed out/);
  assert.strictEqual(p.diagnoseSetup('all fine'), undefined);
});
