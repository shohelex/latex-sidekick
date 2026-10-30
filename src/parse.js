// Pure helpers (no VS Code API) so they can be unit-tested with plain node.

const LEVELS = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5 };

function stripComments(text) {
  return text.replace(/(^|[^\\])%.*$/gm, '$1');
}

/** \section{...} etc. -> [{ level, title, line }] (line is 0-based). */
function parseSections(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  const re = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\s*(?:\[[^\]]*\])?\s*\{(.*)\}/;
  lines.forEach((l, i) => {
    const m = re.exec(stripComments(l));
    if (m) out.push({ level: LEVELS[m[1]], kind: m[1], title: m[2].trim(), line: i });
  });
  return out;
}

/** Rough word count of the document body, ignoring comments and markup. */
function countWords(text) {
  let t = stripComments(text);
  const b = t.indexOf('\\begin{document}');
  if (b >= 0) t = t.slice(b + '\\begin{document}'.length);
  const e = t.indexOf('\\end{document}');
  if (e >= 0) t = t.slice(0, e);
  t = t
    .replace(/\\begin\{(equation|align|eqnarray|gather|multline|displaymath|verbatim|lstlisting)\*?\}[\s\S]*?\\end\{\1\*?\}/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g, ' ')
    .replace(/\\(cite|ref|eqref|label|autoref|cref|Cref|includegraphics|input|include|usepackage|documentclass|bibliography|bibliographystyle)[a-zA-Z]*\*?(\[[^\]]*\])*\{[^}]*\}/g, ' ')
    .replace(/\\[a-zA-Z]+\*?/g, ' ')
    .replace(/[{}\\&~^_#]/g, ' ');
  const words = t.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return words ? words.length : 0;
}

/** Read one braced or quoted value starting at text[i]; returns [value, nextIndex]. */
function readValue(text, i) {
  const c = text[i];
  if (c === '{') {
    let depth = 0;
    for (let j = i; j < text.length; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}' && --depth === 0) return [text.slice(i + 1, j), j + 1];
    }
    return [text.slice(i + 1), text.length];
  }
  if (c === '"') {
    const j = text.indexOf('"', i + 1);
    return [text.slice(i + 1, j < 0 ? text.length : j), j < 0 ? text.length : j + 1];
  }
  const m = /^[^,}\s]+/.exec(text.slice(i));
  return [m ? m[0] : '', i + (m ? m[0].length : 0)];
}

/** .bib text -> [{ key, type, fields: { author, title, year, ... } }]. */
function parseBib(text) {
  const entries = [];
  const head = /@([A-Za-z]+)\s*\{\s*([^,\s{}]+)\s*,/g;
  let m;
  while ((m = head.exec(text))) {
    const type = m[1].toLowerCase();
    if (['comment', 'string', 'preamble'].includes(type)) continue;
    const fields = {};
    let i = head.lastIndex;
    for (;;) {
      const f = /^\s*([A-Za-z][\w-]*)\s*=\s*/.exec(text.slice(i));
      if (!f) break;
      i += f[0].length;
      const [val, next] = readValue(text, i);
      fields[f[1].toLowerCase()] = val.replace(/\s+/g, ' ').trim();
      i = next;
      const sep = /^\s*,?/.exec(text.slice(i));
      i += sep[0].length;
    }
    entries.push({ key: m[2], type, fields });
    head.lastIndex = Math.max(head.lastIndex, i);
  }
  return entries;
}

/** \label{...} names in a text. */
function parseLabels(text) {
  const out = [];
  const re = /\\label\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(stripComments(text)))) out.push(m[1]);
  return out;
}

/**
 * Parse `synctex view` / `synctex edit` output into records.
 * view -> { page, x, y, h, v, W, H }; edit -> { input, line, column }.
 */
function parseSynctex(out) {
  const recs = [];
  let cur = null;
  for (const raw of out.split(/\r?\n/)) {
    const m = /^([A-Za-z]+):(.*)$/.exec(raw.trim());
    if (!m) continue;
    const [, k, v] = m;
    if (k === 'Output' || k === 'Input') { cur = {}; recs.push(cur); }
    if (!cur) continue;
    if (k === 'Input') cur.input = v;
    else if (k === 'Line') cur.line = parseInt(v, 10);
    else if (k === 'Column') cur.column = parseInt(v, 10);
    else if (['Page', 'x', 'y', 'h', 'v', 'W', 'H'].includes(k)) cur[k === 'Page' ? 'page' : k] = parseFloat(v);
  }
  return recs.filter((r) => r.page !== undefined || r.input !== undefined);
}

/** /mnt/c/foo -> C:\foo ; other paths returned unchanged. */
function wslToWin(p) {
  const m = /^\/mnt\/([a-z])\/(.*)$/.exec(p);
  return m ? `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}` : p;
}

/** Remove a ``` fence the model may wrap around its answer. */
function stripFences(s) {
  const m = /^\s*```[a-zA-Z]*\n([\s\S]*?)\n```\s*$/.exec(s);
  return m ? m[1] : s;
}

const HINTS = [
  [/Undefined control sequence/i, 'A command is misspelled or its package is not loaded. Check the spelling, or add the right \\usepackage.'],
  [/File [`'‘]?([^'’`]+)['’]? not found/i, 'A package or file is missing. Install the TeX package (e.g. `sudo apt install texlive-latex-extra`, or `tlmgr install <name>`), or fix the file name.'],
  [/Missing \$ inserted/i, 'A math symbol (_, ^, \\alpha …) was used outside math mode. Wrap it in $ … $.'],
  [/Runaway argument|File ended while scanning|Paragraph ended before/i, 'A { is not closed, or a command argument runs on too long. Check that braces match.'],
  [/Extra \}|Too many \}'s/i, 'There is a } with no matching {.'],
  [/Missing \\begin\{document\}/i, 'Text or a bad command appears before \\begin{document}. Check the preamble.'],
  [/Environment (\S+) undefined/i, 'That environment is not defined. Load the package that provides it.'],
  [/\\begin\{(\S+)\} on input line \d+ ended by \\end/i, 'A \\begin is closed by the wrong \\end. Check the environment names.'],
  [/Reference .* undefined/i, 'The \\label does not exist or is misspelled. Build twice if you just added it.'],
  [/Citation .* undefined/i, 'The key is not in your .bib file, or the bibliography has not been built yet.'],
  [/Too many unprocessed floats/i, 'Too many figures/tables are waiting. Add \\clearpage or relax the placement options.'],
  [/Emergency stop|Fatal error occurred/i, 'LaTeX stopped. Fix the first error above; later ones are often side effects.'],
];

function hintFor(message) {
  const h = HINTS.find(([re]) => re.test(message));
  return h ? h[1] : undefined;
}

/**
 * Parse a LaTeX .log (or latexmk output) into issues:
 * [{ severity: 'error'|'warning'|'info', kind, file?, line?, message, hint? }]
 */
function parseLog(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  const seen = new Set();
  const add = (it) => {
    const k = [it.severity, it.file, it.line, it.message].join('|');
    if (seen.has(k)) return;
    seen.add(k);
    it.hint = it.hint || hintFor(it.message);
    out.push(it);
  };
  const SKIP = /^(There were undefined (references|citations)|Label\(s\) may have changed|Rerun to get)/i;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m;
    if ((m = /^(.+?\.(?:tex|sty|cls|bib|bbx|cbx|def|cfg|clo|ltx)):(\d+): (.*)$/.exec(l))) {
      add({ severity: 'error', kind: 'error', file: m[1].replace(/^\.\//, ''), line: parseInt(m[2], 10), message: m[3].replace(/^LaTeX Error: /, '').trim() });
    } else if ((m = /^! (.*)$/.exec(l))) {
      let line;
      for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
        const n = /^l\.(\d+)/.exec(lines[j]);
        if (n) { line = parseInt(n[1], 10); break; }
      }
      add({ severity: 'error', kind: 'error', line, message: m[1].replace(/^LaTeX Error: /, '').trim() });
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
    } else if ((m = /^(Overfull|Underfull) \\([hv])box \(([^)]*)\)(.*)$/.exec(l))) {
      const r = /lines (\d+)--(\d+)|line (\d+)/.exec(m[4]);
      const line = r ? parseInt(r[1] || r[3], 10) : undefined;
      add({ severity: 'info', kind: 'typesetting', line, message: `${m[1]} ${m[2] === 'h' ? 'horizontal' : 'vertical'} box (${m[3]})`,
        hint: m[1] === 'Overfull' ? 'Text sticks out into the margin. Rephrase, allow hyphenation, or use \\sloppy / a manual break.' : 'Spacing is stretched loosely here; usually cosmetic.' });
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
  return undefined;
}

module.exports = { parseLog, hintFor, diagnoseSetup, parseSections, countWords, parseBib, parseLabels, parseSynctex, wslToWin, stripFences, stripComments };
