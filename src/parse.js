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
  const words = t.match(/[\p{L}\p{N}][\p{L}\p{N}'â€™-]*/gu);
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

const issues = require('./issues');

module.exports = { parseSections, countWords, parseBib, parseLabels, parseSynctex, wslToWin, stripFences, stripComments, ...issues };
