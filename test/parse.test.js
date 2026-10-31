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
  assert.match(by('error')[1].hint, /not installed/i);
  assert.strictEqual(by('error')[1].code, 'missing-file');
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


test('parseLog: context, offending command, and the key of an undefined reference', () => {
  const r = p.parseLog([
    './main.tex:3: Undefined control sequence.',
    'l.3 Hello \\includegraphics',
    '                            {a.png}',
    '',
    "LaTeX Warning: Reference `fig:x' on page 1 undefined on input line 9.",
  ].join('\n'));
  assert.strictEqual(r[0].code, 'undefined-command');
  assert.strictEqual(r[0].cmd, '\\includegraphics');
  assert.match(r[0].context, /includegraphics \{a\.png\}/);
  assert.match(r[0].hint, /usepackage\{graphicx\}/);
  assert.strictEqual(r[1].code, 'undefined-ref');
  assert.strictEqual(r[1].key, 'fig:x');
});

test('parseLog: an error inside a package is attributed to the user line that triggered it', () => {
  const r = p.parseLog([
    '/usr/share/texlive/foo.sty:120: Package foo Error: Something broke.',
    'See the foo package documentation for explanation.',
    'l.14 \\usefoo',
    '',
  ].join('\n'));
  assert.strictEqual(r[0].file, undefined);
  assert.strictEqual(r[0].line, 14);
  assert.strictEqual(r[0].via, 'foo.sty');
});

test('parseLog: other warnings (pdfTeX, missing character, missing auxiliary file)', () => {
  const r = p.parseLog('pdfTeX warning (ext4): destination with the same identifier\nMissing character: There is no ^^A in font cmr10!\nNo file main.bbl.\n');
  assert.deepStrictEqual(r.map((x) => x.severity), ['warning', 'warning', 'warning']);
});

test('parseBlg: BibTeX and Biber problems land on the .bib file', () => {
  const r = p.parseBlg([
    'Warning--I didn\'t find a database entry for "nokey"',
    'I was expecting a `,\' or `}\'---line 12 of file refs.bib',
    'ERROR - BibTeX subsystem: /tmp/x/refs.bib_abc.utf8, line 9, syntax error: bad',
  ].join('\n'));
  assert.strictEqual(r[0].key, 'nokey');
  assert.deepStrictEqual([r[1].file, r[1].line], ['refs.bib', 12]);
  assert.deepStrictEqual([r[2].file, r[2].line], ['refs.bib', 9]);
});

test('diagnoseSetup: more setup problems', () => {
  assert.match(p.diagnoseSetup('Latexmk: Missing input file: x.tex'), /main \.tex/);
  assert.match(p.diagnoseSetup('biber: command not found'), /bibtex\/biber/);
});

test('packageFor / planPackage: add a missing \\usepackage once', () => {
  assert.strictEqual(p.packageFor({ code: 'undefined-command', cmd: '\\toprule' }), 'booktabs');
  assert.strictEqual(p.packageFor({ code: 'undefined-env', env: 'align' }), 'amsmath');
  const text = '\\documentclass{article}\n\\usepackage{a}\n\\usepackage[x]{b, graphicx}\n\\begin{document}\n\\end{document}';
  assert.strictEqual(p.planPackage(text, 'graphicx'), null);
  assert.deepStrictEqual(p.planPackage(text, 'booktabs'), { line: 3, text: '\\usepackage{booktabs}' });
  assert.deepStrictEqual(p.planPackage('\\documentclass{article}\n\\begin{document}', 'xcolor'), { line: 1, text: '\\usepackage{xcolor}' });
});

test('closest finds a likely typo and nothing for unrelated names', () => {
  assert.strictEqual(p.closest('fig:resutls', ['fig:results', 'tab:a']), 'fig:results');
  assert.strictEqual(p.closest('zzzzzz', ['fig:results', 'tab:a']), undefined);
});

const fix = require('../src/fix');

test('fix: prompt window, reply parsing and edit planning', () => {
  const lines = ['\\documentclass{article}', '\\usepackage{a}', '\\begin{document}', 'one', 'two \\toprule', 'three', '\\end{document}'];
  const issue = { severity: 'error', message: 'Undefined control sequence.', line: 5, cmd: '\\toprule' };
  const pr = fix.buildFixPrompt(issue, lines, 1);
  assert.deepStrictEqual(pr.window, { start: 3, end: 6 });
  assert.match(pr.user, /reported at line 2 of the fragment/);
  assert.match(pr.user, /\\usepackage\{a\}/);
  const parsed = fix.parseFixReply('<explanation>Removed it.</explanation>\n<fix>\none\ntwo\nthree\n</fix>\n<preamble>\\usepackage{booktabs}</preamble>');
  assert.strictEqual(parsed.fix, 'one\ntwo\nthree');
  const plan = fix.planEdits(lines, pr.window, parsed, pr.fragment);
  assert.deepStrictEqual(fix.applyEdits(lines, plan.edits), ['\\documentclass{article}', '\\usepackage{a}', '\\usepackage{booktabs}', '\\begin{document}', 'one', 'two', 'three', '\\end{document}']);
  // no tags: explanation only, nothing applied
  const none = fix.parseFixReply('You need to install foo.sty.');
  assert.strictEqual(none.fix, undefined);
  assert.strictEqual(fix.planEdits(lines, pr.window, none, pr.fragment).edits.length, 0);
  // a package that is already loaded is not added twice
  const dup = fix.parseFixReply('<explanation>x</explanation><fix></fix><preamble>\\usepackage{a}</preamble>');
  assert.strictEqual(fix.planEdits(lines, pr.window, dup, pr.fragment).edits.length, 0);
});

test('extractReply: takes the answer out of a copied code block, or plain text', () => {
  const inner = '<explanation>ok</explanation>\n<fix>\na\n</fix>';
  assert.strictEqual(fix.extractReply('```\n' + inner + '\n```'), inner);
  assert.strictEqual(fix.extractReply('Here you go:\n```xml\n' + inner + '\n```\nHope it helps'), inner);
  assert.strictEqual(fix.extractReply(inner), inner);
  assert.strictEqual(fix.extractReply('just some text'), undefined);
});

test('chatUrl: the whole prompt survives in the ?q= parameter; huge prompts fall back to an empty chat', () => {
  const prompt = 'Undefined control sequence.\nHello \\foo {world} & 50% <fragment>\nx\n</fragment> ünï';
  assert.strictEqual(new URL(fix.chatUrl(prompt)).searchParams.get('q'), prompt);
  assert.strictEqual(fix.chatUrl('x'.repeat(7000)), 'https://claude.ai/new');
});

test('checkFix: refuses the prompt echoed back or prose without LaTeX, warns on big size changes', () => {
  const frag = '\\documentclass{article}\n\\begin{document}\nHello \\foo world.\n\\end{document}';
  const garbage = ' empty and explain what to do.\nReply in exactly this format and nothing else:\n<explanation>x</explanation>\n<fix>the complete corrected fragment';
  assert.ok(fix.checkFix(garbage, frag).reject);
  assert.ok(fix.checkFix('Sure! I removed the unknown command for you.', frag).reject);
  assert.ok(fix.checkFix('\\foo\n' + 'x\n'.repeat(30), frag).warn);
  assert.ok(fix.checkFix('\\documentclass{article}\n\\begin{document}', 'a \\b\nc\nd\ne\nf\ng').warn);
  assert.deepStrictEqual(fix.checkFix('\\documentclass{article}\n\\begin{document}\nHello world.\n\\end{document}', frag), {});
});

test('parsers survive garbage and huge input quickly (no throw, no catastrophic backtracking)', () => {
  const rnd = (n) => Array.from({ length: n }, () => String.fromCharCode(Math.floor(Math.random() * 120) + 1)).join('');
  const inputs = [
    '', '\0\0\0', rnd(5000), '!'.repeat(10000), 'l.'.repeat(5000), 'LaTeX Warning: ' + 'x'.repeat(300000),
    './main.tex:' + '1'.repeat(100000), '! ' + ' '.repeat(200000), 'Reference `' + 'a'.repeat(200000) + "' on page 1 undefined",
    ('Overfull \\hbox (1pt too wide) in paragraph at lines 1--2\n').repeat(50000),
    "LaTeX Warning: Citation `k' on page 1 undefined on input line 3.\n".repeat(50000),
    ('x'.repeat(79) + '\n').repeat(20000) + '! Undefined control sequence.\nl.5 \\foo',
    'Warning--I didn\'t find a database entry for "' + 'k'.repeat(200000) + '"', '---line 1 of file ' + 'x'.repeat(200000),
  ];
  for (const input of inputs) {
    const t0 = Date.now();
    assert.doesNotThrow(() => { p.parseLog(input); p.parseBlg(input); p.diagnoseSetup(input); p.hintFor(input); });
    assert.ok(Date.now() - t0 < 3000, `too slow (${Date.now() - t0} ms) on input starting ${JSON.stringify(input.slice(0, 30))}`);
  }
  assert.doesNotThrow(() => { fix.parseFixReply(rnd(5000)); fix.extractReply(rnd(5000)); fix.checkFix(rnd(2000), rnd(2000)); fix.chatUrl(rnd(9000)); });
});
