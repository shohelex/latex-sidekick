// Pure helpers (no VS Code API) for build problems: parse the TeX/BibTeX logs, explain each problem,
// and suggest fixes that need no AI.

const USER_FILE = /\.(tex|bib)$/i;
const FILE_LINE = /^(.+?\.(?:tex|sty|cls|bib|bbx|cbx|def|cfg|clo|ltx|fd|dtx|tikz|pgf|code\.tex)):(\d+): (.*)$/;

// Commands that need a package, for "Add \usepackage{...}" fixes.
const COMMAND_PACKAGES = {
  includegraphics: 'graphicx', graphicspath: 'graphicx', rotatebox: 'graphicx', scalebox: 'graphicx', resizebox: 'graphicx',
  textcolor: 'xcolor', color: 'xcolor', colorbox: 'xcolor', definecolor: 'xcolor', pagecolor: 'xcolor',
  url: 'url', href: 'hyperref', hyperref: 'hyperref', autoref: 'hyperref',
  mathbb: 'amssymb', mathfrak: 'amssymb', checkmark: 'amssymb', square: 'amssymb', leqslant: 'amssymb', geqslant: 'amssymb',
  mathscr: 'mathrsfs', text: 'amsmath', eqref: 'amsmath', dfrac: 'amsmath', tfrac: 'amsmath', boldsymbol: 'amsmath',
  operatorname: 'amsmath', DeclareMathOperator: 'amsmath', substack: 'amsmath', intertext: 'amsmath', xrightarrow: 'amsmath',
  toprule: 'booktabs', midrule: 'booktabs', bottomrule: 'booktabs', cmidrule: 'booktabs',
  SI: 'siunitx', si: 'siunitx', num: 'siunitx', SIrange: 'siunitx', qty: 'siunitx',
  cref: 'cleveref', Cref: 'cleveref', subfigure: 'subfig', subcaption: 'subcaption', captionof: 'caption',
  bm: 'bm', tikz: 'tikz', draw: 'tikz', node: 'tikz', citep: 'natbib', citet: 'natbib', citeauthor: 'natbib',
  multirow: 'multirow', cellcolor: 'colortbl', rowcolor: 'colortbl', hl: 'soul', sout: 'ulem', lipsum: 'lipsum',
  FloatBarrier: 'placeins', todo: 'todonotes', xspace: 'xspace', ding: 'pifont', cmark: 'pifont', textsubscript: 'fixltx2e',
  algorithmicx: 'algorithmicx', State: 'algpseudocode', If: 'algpseudocode', ForAll: 'algpseudocode', Require: 'algpseudocode',
  ceil: 'mathtools', floor: 'mathtools', coloneqq: 'mathtools', mintinline: 'minted', lstinline: 'listings',
};
const ENV_PACKAGES = {
  align: 'amsmath', 'align*': 'amsmath', gather: 'amsmath', 'gather*': 'amsmath', multline: 'amsmath', split: 'amsmath',
  cases: 'amsmath', pmatrix: 'amsmath', bmatrix: 'amsmath', vmatrix: 'amsmath', Bmatrix: 'amsmath', matrix: 'amsmath', aligned: 'amsmath',
  proof: 'amsthm', tabularx: 'tabularx', longtable: 'longtable', subfigure: 'subfig', algorithm: 'algorithm',
  algorithmic: 'algorithmic', lstlisting: 'listings', minted: 'minted', tikzpicture: 'tikz', multicols: 'multicol',
  wrapfigure: 'wrapfig', sidewaystable: 'rotating', sidewaysfigure: 'rotating', tcolorbox: 'tcolorbox',
};

const imageFile = (f) => /\.(png|jpe?g|pdf|eps|svg|gif)$/i.test(f);

const RULES = [
  { re: /Undefined control sequence/i, code: 'undefined-command',
    hint: (m, it) => it.cmd && COMMAND_PACKAGES[it.cmd.slice(1).replace(/\*$/, '')]
      ? `${it.cmd} comes from the package "${COMMAND_PACKAGES[it.cmd.slice(1).replace(/\*$/, '')]}". Add \\usepackage{${COMMAND_PACKAGES[it.cmd.slice(1).replace(/\*$/, '')]}} to the preamble.`
      : `${it.cmd || 'A command'} is misspelled, or its package is not loaded. Check the spelling, or add the right \\usepackage.` },
  { re: /File [`'‘]?([^'’`]+?)['’]? not found|I can't find file [`'‘]?([^'’`]+?)['’]?\b/i, code: 'missing-file',
    pick: (m) => ({ file: (m[1] || m[2] || '').trim() }),
    hint: (m, it) => /\.(sty|cls|bst|def|cfg)$/i.test(it.file || '')
      ? `The TeX package/class ${it.file} is not installed. In WSL/Linux: \`sudo apt install texlive-latex-extra\` (or \`tlmgr install <package>\`); on Windows use the MiKTeX console.`
      : imageFile(it.file || '') ? `The image ${it.file} was not found. Paths are relative to the main .tex file; check the folder and the spelling (and the extension).`
        : `The file ${it.file || ''} was not found. Check its name and that it is next to the main .tex file (or give a relative path).` },
  { re: /Missing \$ inserted/i, code: 'math-mode', hint: 'A math symbol (_, ^, \\alpha …) was used outside math mode, or a $ is unbalanced. Wrap the formula in $ … $.' },
  { re: /Runaway argument|File ended while scanning|Paragraph ended before|Missing \} inserted|Missing \{ inserted/i, code: 'unbalanced-braces',
    hint: 'A { is not closed, or a command argument runs on too long. Check that every { has a matching }.' },
  { re: /Extra \}|Too many \}'s|Extra \\right|Extra \\left|Missing \\right inserted/i, code: 'extra-brace', hint: 'A } (or \\right / \\left) has no partner. Check that brackets match.' },
  { re: /Missing \\begin\{document\}/i, code: 'preamble', hint: 'Text or a bad command appears before \\begin{document}. Check the preamble.' },
  { re: /Environment (\S+) undefined/i, code: 'undefined-env', pick: (m) => ({ env: m[1].replace(/\.$/, '') }),
    hint: (m, it) => ENV_PACKAGES[it.env] ? `The "${it.env}" environment comes from the package "${ENV_PACKAGES[it.env]}". Add \\usepackage{${ENV_PACKAGES[it.env]}}.` : 'That environment is not defined. Load the package that provides it, or fix the name.' },
  { re: /\\begin\{(\S+?)\} on input line (\d+) ended by \\end\{(\S+?)\}/i, code: 'env-mismatch', hint: 'A \\begin is closed by the wrong \\end. Check the environment names and the order they are nested.' },
  { re: /Reference [`'‘]?(.+?)['’]? on page \d+ undefined|Reference [`'‘]?(.+?)['’]? undefined/i, code: 'undefined-ref', pick: (m) => ({ key: m[1] || m[2] }),
    hint: 'The \\label does not exist or is misspelled. If you just added it, build twice.' },
  { re: /Citation [`'‘]?(.+?)['’]? on page \d+ undefined|Citation [`'‘]?(.+?)['’]? undefined/i, code: 'undefined-cite', pick: (m) => ({ key: m[1] || m[2] }),
    hint: 'The key is not in your .bib file, or the bibliography has not been built yet.' },
  { re: /Label [`'‘]?(.+?)['’]? multiply defined/i, code: 'multiple-label', pick: (m) => ({ key: m[1] }), hint: 'Two \\label commands use the same name. Rename one.' },
  { re: /Too many unprocessed floats/i, code: 'floats', hint: 'Too many figures/tables are waiting. Add \\clearpage or relax the placement options.' },
  { re: /Float(s)? lost|Float too large/i, code: 'floats', hint: 'A figure/table does not fit or is stuck. Shrink it, or use [t] / [!htbp] placement.' },
  { re: /Emergency stop|Fatal error occurred/i, code: 'fatal', hint: 'LaTeX stopped. Fix the first error above; later ones are often side effects.' },
  { re: /Unicode (character|char) .* (not set up|not supported)|Invalid UTF-8 byte|Unicode character/i, code: 'unicode',
    hint: 'A character is not available in this font setup. Replace it with a LaTeX command, add \\usepackage[utf8]{inputenc}, or switch the engine to xelatex/lualatex.' },
  { re: /Misplaced alignment tab character &/i, code: 'alignment-tab', hint: 'A literal & outside a table. Write \\& for an ampersand.' },
  { re: /Extra alignment tab/i, code: 'extra-tab', hint: 'A table row has more & than columns. Add a column to the tabular, or remove an &.' },
  { re: /Double (superscript|subscript)/i, code: 'double-script', hint: 'Two ^ (or two _) on the same item. Group them: x^{a^b} or {x^a}^b.' },
  { re: /Missing number, treated as zero|Illegal unit of measure/i, code: 'bad-length', hint: 'A length or number is missing, e.g. width=0.5 instead of 0.5\\linewidth.' },
  { re: /Display math should end with \$\$/i, code: 'math-mode', hint: 'Display math ended with a stray $. Use \\[ … \\] or an equation environment.' },
  { re: /Illegal parameter number|Parameter character/i, code: 'bad-parameter', hint: 'A # appears where it is not allowed. Write \\# for a literal hash.' },
  { re: /Something's wrong--perhaps a missing \\item|Lonely \\item/i, code: 'missing-item', hint: 'A list is empty or an \\item is outside a list. Check the itemize/enumerate.' },
  { re: /Command (\\\S+) already defined|Command (\\\S+) already defined/i, code: 'already-defined', hint: 'That command already exists. Use \\renewcommand, or pick another name.' },
  { re: /Option clash for package (\S+)/i, code: 'option-clash', hint: 'The package is loaded twice with different options. Load it once, with all options.' },
  { re: /Unknown option [`'‘]?(\S+?)['’]? for/i, code: 'unknown-option', hint: 'This package/class does not know that option. Check the spelling.' },
  { re: /Missing character: There is no/i, code: 'missing-char', hint: 'The font has no glyph for this character; it will not appear in the PDF. Use another character or font.' },
  { re: /Font shape .* undefined|Font .* not found|Some font shapes were not available/i, code: 'font', hint: 'The requested font style does not exist; LaTeX substituted another. Usually harmless.' },
  { re: /There's no line here to end/i, code: 'no-line', hint: 'A \\\\ line break where there is nothing to break. Remove it or use \\par.' },
  { re: /Not in outer par mode/i, code: 'float-in-box', hint: 'A figure/table was placed inside a box or minipage. Use [H] or move it outside.' },
  { re: /TeX capacity exceeded/i, code: 'capacity', hint: 'Usually an endless loop or a recursive definition. Look for a command that calls itself.' },
  { re: /Undefined color/i, code: 'undefined-color', hint: 'The color name is unknown. Use \\definecolor, or one of the xcolor names (load xcolor).' },
  { re: /-shell-escape/i, code: 'shell-escape', hint: 'This package needs shell-escape (e.g. minted). That is a build option not enabled here; use a non-shell alternative or build by hand with -shell-escape.' },
  { re: /Token not allowed in a PDF string/i, code: 'pdf-string', hint: 'Math or a command in a section title. Use \\texorpdfstring{math}{plain text}.' },
  { re: /Argument of .* has an extra \}|Use of .* doesn't match its definition/i, code: 'bad-argument', hint: 'A command got arguments in a form it did not expect. Check braces around its arguments.' },
  { re: /Command .* invalid in math mode|Bad math environment delimiter/i, code: 'math-mode', hint: 'A text-only command inside math. Wrap the text in \\text{…} (amsmath) or \\mbox{…}.' },
  { re: /Text line contains an invalid character/i, code: 'unicode', hint: 'An invisible or control character is in the text. Retype the line.' },
  { re: /^No file .+\.(bbl|aux|toc|lof|lot|ind)\.?$/i, code: 'no-aux', hint: 'An auxiliary file was not produced yet. Build again; if it stays, the bibliography/index step failed.' },
  { re: /database entry|I couldn't open database file|no \\bibdata|no \\citation|no \\bibstyle/i, code: 'bibtex', hint: 'BibTeX could not read your bibliography. Check the \\bibliography{…} name and that the .bib file exists.' },
];

function hintAndCode(it) {
  for (const r of RULES) {
    const m = r.re.exec(it.message);
    if (!m) continue;
    if (r.pick) Object.assign(it, r.pick(m));
    it.code = r.code;
    if (!it.hint) it.hint = typeof r.hint === 'function' ? r.hint(m, it) : r.hint;
    return;
  }
}

function hintFor(message) {
  const it = { message };
  hintAndCode(it);
  return it.hint;
}

/** Find the "l.12 text" context line after index i; returns { line, context, cmd }. */
function lookAhead(lines, i) {
  for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
    const n = /^l\.(\d+) ?(.*)$/.exec(lines[j]);
    if (!n) continue;
    const before = n[2];
    const next = lines[j + 1] || '';
    const after = /^\s+\S/.test(next) ? next.trim() : '';
    const cm = /(\\[A-Za-z@]+\*?)\s*$/.exec(before);
    return { line: parseInt(n[1], 10), context: (before + ' ' + after).replace(/\s+/g, ' ').trim(), cmd: cm ? cm[1] : undefined };
  }
  return {};
}

/**
 * Parse a LaTeX .log (or latexmk output) into issues:
 * [{ severity: 'error'|'warning'|'info', kind, code?, file?, line?, message, hint?, context?, cmd?, key?, env? }]
 */
function parseLog(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  const seen = new Set();
  const add = (it) => {
    const k = [it.severity, it.file, it.line, it.message].join('|');
    if (seen.has(k)) return;
    seen.add(k);
    hintAndCode(it);
    for (const f of Object.keys(it)) if (it[f] === undefined) delete it[f];
    out.push(it);
  };
  const SKIP = /^(There were undefined (references|citations)|Label\(s\) may have changed|Rerun to get|There were multiply-defined labels)/i;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m;
    if ((m = FILE_LINE.exec(l))) {
      const message = m[3].replace(/^LaTeX Error: /, '').trim();
      const la = lookAhead(lines, i);
      let file = m[1].replace(/^\.\//, ''), line = parseInt(m[2], 10), via;
      if (!USER_FILE.test(file)) {
        // The error is inside a package/class: point at the line of the user's document that triggered it.
        via = file.split('/').pop();
        file = undefined;
        line = la.line;
      }
      add({ severity: 'error', kind: 'error', file, line, via, message, context: la.context, cmd: la.cmd });
    } else if ((m = /^! (.*)$/.exec(l))) {
      const la = lookAhead(lines, i);
      add({ severity: 'error', kind: 'error', line: la.line, message: m[1].replace(/^LaTeX Error: /, '').trim(), context: la.context, cmd: la.cmd });
    } else if ((m = /^(LaTeX|Package (\S+)|Class (\S+)) (Font )?Warning: (.*)$/.exec(l))) {
      let msg = m[5];
      for (let j = i + 1; j < lines.length && lines[j].trim() !== '' && /^(\(\S+\)|\s)/.test(lines[j]); j++) {
        msg += ' ' + lines[j].replace(/^\(\S+\)\s*/, '').trim();
      }
      msg = msg.replace(/\s+/g, ' ').trim();
      if (SKIP.test(msg)) continue;
      const ln = /on input line (\d+)/.exec(msg);
      const who = m[2] || m[3];
      add({ severity: 'warning', kind: 'warning', line: ln ? parseInt(ln[1], 10) : undefined, message: (who ? `[${who}] ` : '') + msg.replace(/\s*on input line \d+\.?$/, '') });
    } else if ((m = /^pdfTeX warning(?: \(([^)]*)\))?: (.*)$/.exec(l))) {
      add({ severity: 'warning', kind: 'warning', message: `[pdfTeX] ${m[2]}`.replace(/\s+/g, ' ') });
    } else if ((m = /^(Missing character: .*)$/.exec(l))) {
      add({ severity: 'warning', kind: 'warning', message: m[1] });
    } else if ((m = /^(No file .+\.(?:bbl|aux|toc|lof|lot|ind)\.)$/.exec(l))) {
      add({ severity: 'warning', kind: 'warning', message: m[1] });
    } else if ((m = /^(Overfull|Underfull) \\([hv])box \(([^)]*)\)(.*)$/.exec(l))) {
      const r = /lines (\d+)--(\d+)|line (\d+)/.exec(m[4]);
      const line = r ? parseInt(r[1] || r[3], 10) : undefined;
      add({ severity: 'info', kind: 'typesetting', line, message: `${m[1]} ${m[2] === 'h' ? 'horizontal' : 'vertical'} box (${m[3]})`,
        hint: m[1] === 'Overfull' ? 'Text sticks out into the margin. Rephrase, allow hyphenation, or use \\sloppy / a manual break.' : 'Spacing is stretched loosely here; usually cosmetic.' });
    }
  }
  return out;
}

/** Parse a BibTeX (.blg) or Biber log into issues on the .bib file. */
function parseBlg(text) {
  const out = [];
  const seen = new Set();
  const add = (it) => {
    const k = [it.severity, it.file, it.line, it.message].join('|');
    if (seen.has(k)) return;
    seen.add(k);
    hintAndCode(it);
    for (const f of Object.keys(it)) if (it[f] === undefined) delete it[f];
    out.push(it);
  };
  for (const l of text.split(/\r?\n/)) {
    let m;
    if ((m = /^Warning--I didn't find a database entry for "(.+)"/.exec(l)) || (m = /WARN - I didn't find a database entry for '(.+?)'/.exec(l))) {
      add({ severity: 'warning', kind: 'warning', message: `Citation '${m[1]}' is not in the .bib file`, key: m[1], code: 'undefined-cite',
        hint: 'The key is not in your .bib file. Add the entry, or fix the key in \\cite{…}.' });
    } else if ((m = /^(.*?)---line (\d+) of file (.+\.bib)\s*$/.exec(l))) {
      add({ severity: 'error', kind: 'error', file: m[3], line: parseInt(m[2], 10), message: `BibTeX: ${m[1].trim() || 'syntax error'}`,
        hint: 'A syntax error in the .bib file: check commas between fields, matching braces, and that the entry key has no spaces.' });
    } else if ((m = /^I couldn't open (?:database|style) file (.+)$/.exec(l))) {
      add({ severity: 'error', kind: 'error', message: `BibTeX could not open ${m[1].trim()}` });
    } else if ((m = /BibTeX subsystem: (\S+?\.bib)(?:_\w+\.utf8)?, line (\d+), (.*)$/.exec(l))) {
      add({ severity: 'error', kind: 'error', file: m[1].split(/[\\/]/).pop(), line: parseInt(m[2], 10), message: `Biber: ${m[3]}`,
        hint: 'A syntax error in the .bib file near this line.' });
    } else if ((m = /ERROR - Cannot find '(.+?)'/.exec(l))) {
      add({ severity: 'error', kind: 'error', message: `Biber cannot find ${m[1]}`, code: 'bibtex' });
    } else if ((m = /^I found no \\(citation|bibdata|bibstyle) command/.exec(l))) {
      if (m[1] !== 'citation') add({ severity: 'warning', kind: 'warning', message: `BibTeX: no \\${m[1]} command found`, code: 'bibtex' });
    }
  }
  return out;
}

/** Recognise build failures that are about the setup, not the document. */
function diagnoseSetup(log) {
  if (/Failed to start wsl\.exe|Wsl\/|ERROR_PATH_NOT_FOUND|no installed distributions|WSL.*not (installed|enabled)/i.test(log)) {
    return 'WSL is not available. Install it with `wsl --install`, or set latexEditor.useWSL to false to use a TeX install on Windows.';
  }
  if (/Failed to start (latexmk|synctex)|latexmk: (command )?not found|is not recognized as an internal|ENOENT|latexmk: .*not found/i.test(log)) {
    return 'latexmk was not found. Install it (in WSL: `sudo apt install latexmk texlive-latex-extra`; on Windows/macOS: MiKTeX or TeX Live), then build again.';
  }
  if (/\[build timed out\]/.test(log)) {
    return 'The build timed out. An infinite loop in the document is the usual cause; fix the first error, or raise latexEditor.buildTimeoutSeconds.';
  }
  if (/Latexmk: (Missing input file|Could not find file)|Missing input file/i.test(log)) {
    return 'latexmk could not find the main .tex file. Check latexEditor.mainFile or the %!TEX root comment.';
  }
  if (/biber: (command )?not found|bibtex: (command )?not found|Can't locate .*Biber/i.test(log)) {
    return 'The bibliography tool (bibtex/biber) is not installed. In WSL: `sudo apt install texlive-bibtex-extra biber`.';
  }
  if (/Permission denied|Read-only file system|No space left/i.test(log)) {
    return 'LaTeX could not write its output files (permission or disk space). Check latexEditor.outDir and the folder permissions.';
  }
  return undefined;
}

// ---- Fixes that need no AI --------------------------------------------------------------

/** Package that provides the failing command/environment, if known. */
function packageFor(issue) {
  if (issue.code === 'undefined-command' && issue.cmd) return COMMAND_PACKAGES[issue.cmd.slice(1).replace(/\*$/, '')];
  if (issue.code === 'undefined-env' && issue.env) return ENV_PACKAGES[issue.env];
  return undefined;
}

const PKG_RE = /\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;

function isPackageLoaded(text, pkg) {
  PKG_RE.lastIndex = 0;
  let m;
  while ((m = PKG_RE.exec(text))) if (m[1].split(',').map((s) => s.trim()).includes(pkg)) return true;
  return false;
}

/** 0-based line before which preamble lines should be inserted (after the last \usepackage). */
function preambleInsertLine(lines) {
  let end = lines.findIndex((l) => /^\s*\\begin\{document\}/.test(l));
  if (end < 0) end = lines.length;
  let at = -1;
  for (let i = 0; i < end; i++) if (/^\s*\\(usepackage|RequirePackage)\b/.test(lines[i])) at = i;
  if (at < 0) for (let i = 0; i < end; i++) if (/^\s*\\documentclass\b/.test(lines[i])) at = i;
  return at + 1;
}

/** Plan a \usepackage insertion: { line, text } or null when already loaded. */
function planPackage(text, pkg) {
  if (isPackageLoaded(text, pkg)) return null;
  return { line: preambleInsertLine(text.split(/\r?\n/)), text: `\\usepackage{${pkg}}` };
}

function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

/** The candidate closest to key (a likely typo), or undefined. */
function closest(key, candidates) {
  let best, bd = Infinity;
  for (const c of candidates) {
    if (c === key) continue;
    const d = distance(key.toLowerCase(), c.toLowerCase());
    if (d < bd) { bd = d; best = c; }
  }
  return best !== undefined && bd <= Math.max(2, Math.floor(key.length * 0.3)) ? best : undefined;
}

module.exports = { parseLog, parseBlg, hintFor, diagnoseSetup, packageFor, planPackage, isPackageLoaded, preambleInsertLine, closest, COMMAND_PACKAGES, ENV_PACKAGES };
