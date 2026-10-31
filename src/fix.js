// Pure helpers (no VS Code API) for "Fix with AI": build the request, read the reply, plan the edits.
const { preambleInsertLine, isPackageLoaded } = require('./issues');
const { stripFences } = require('./parse');

const FIX_SYSTEM = [
  'You fix LaTeX build problems.',
  'You get a compiler message and a fragment of the source around the place where it was reported.',
  'Make the smallest change that fixes the problem. Keep everything else byte-for-byte identical, including comments and line breaks.',
  'Never invent facts, citations, labels or file names. If the fix needs something only the author knows (a missing file, a bibliography entry), do not guess: leave <fix> empty and explain what to do.',
  'Reply in exactly this format and nothing else:',
  '<explanation>one or two plain sentences: what was wrong and what you changed</explanation>',
  '<fix>the complete corrected fragment, with no line numbers and no code fences (empty if it cannot be fixed here)</fix>',
  '<preamble>optional: extra preamble lines such as \\usepackage{...}, one per line</preamble>',
].join('\n');

/** 0-based window [start, end) of lines to send around the 1-based line. */
function windowFor(lineCount, line, radius) {
  const l = Math.min(Math.max(line || 1, 1), Math.max(lineCount, 1)) - 1;
  return { start: Math.max(0, l - radius), end: Math.min(lineCount, l + radius + 1) };
}

/** Best guess for the line of an issue that has none (undefined citation, etc.). */
function anchorLine(issue, lines) {
  if (issue.line) return issue.line;
  const needle = issue.key || issue.cmd;
  if (needle) { const i = lines.findIndex((l) => l.includes(needle)); if (i >= 0) return i + 1; }
  return 1;
}

/** Preamble lines that tell the model what is already loaded. */
function preambleContext(lines) {
  let end = lines.findIndex((l) => /^\s*\\begin\{document\}/.test(l));
  if (end < 0) end = Math.min(lines.length, 80);
  return lines.slice(0, end).filter((l) => /^\s*\\(documentclass|usepackage|RequirePackage|usetikzlibrary|newcommand|renewcommand|DeclareMathOperator|newtheorem|def)\b/.test(l)).slice(0, 80).join('\n');
}

function buildFixPrompt(issue, lines, radius) {
  const line = anchorLine(issue, lines);
  const win = windowFor(lines.length, line, radius);
  const fragment = lines.slice(win.start, win.end).join('\n');
  const user = [
    `LaTeX ${issue.severity}: ${issue.message}`,
    issue.cmd ? `Offending command: ${issue.cmd}` : '',
    issue.context ? `LaTeX showed this context: ${issue.context}` : '',
    `It was reported at line ${line - win.start} of the fragment below.`,
    '',
    'Preamble (read-only, for context):',
    preambleContext(lines) || '(none)',
    '',
    'Fragment:',
    '<fragment>',
    fragment,
    '</fragment>',
  ].filter((x, i) => x !== '' || i > 0).join('\n');
  return { system: FIX_SYSTEM, user, window: win, fragment };
}

const tag = (s, name) => { const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(s); return m ? m[1] : undefined; };

/** Read the model's reply. { explanation, fix?, preamble: [] } ; no tags at all means "explanation only". */
function parseFixReply(reply) {
  const explanation = tag(reply, 'explanation');
  let fix = tag(reply, 'fix');
  const pre = tag(reply, 'preamble');
  if (explanation === undefined && fix === undefined) return { explanation: reply.trim(), fix: undefined, preamble: [] };
  if (fix !== undefined) {
    fix = stripFences(fix.replace(/^\r?\n/, '').replace(/\r?\n$/, ''));
    if (!fix.trim()) fix = undefined;
  }
  return {
    explanation: (explanation || '').trim(),
    fix,
    preamble: (pre || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
  };
}

/**
 * Pull the reply out of text copied from a chat window: the chat is asked to answer inside one code block,
 * so use that block's contents when the tags are inside it. Returns undefined if no tags are found.
 */
function extractReply(text) {
  const isReply = (s) => /<fix>|<explanation>/.test(s);
  const whole = /^\s*```[^\n]*\n([\s\S]*)\n```\s*$/.exec(text);
  if (whole && isReply(whole[1])) return whole[1];
  const any = /```[^\n]*\n([\s\S]*?)\n```/.exec(text);
  if (any && isReply(any[1])) return any[1];
  return isReply(text) ? text : undefined;
}

/**
 * Turn a parsed reply into edits on the original lines: [{ start, end, lines }] (end exclusive).
 * Returns { edits, skippedPreamble }.
 */
function planEdits(lines, win, parsed, fragment) {
  const edits = [];
  let skippedPreamble = [];
  if (parsed.fix !== undefined && parsed.fix !== fragment) edits.push({ start: win.start, end: win.end, lines: parsed.fix.split(/\r?\n/) });
  const text = lines.join('\n');
  const wanted = parsed.preamble.filter((p) => {
    const pk = /\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/.exec(p);
    return pk ? !pk[1].split(',').every((x) => isPackageLoaded(text, x.trim())) : !lines.some((l) => l.trim() === p);
  });
  if (wanted.length) {
    const at = preambleInsertLine(lines);
    if (at > win.start && at < win.end) skippedPreamble = wanted;   // overlaps the model's rewrite; ask the user to add by hand
    else edits.push({ start: at, end: at, lines: wanted });
  }
  return { edits, skippedPreamble };
}

function applyEdits(lines, edits) {
  const out = lines.slice();
  [...edits].sort((a, b) => b.start - a.start || b.end - a.end).forEach((e) => out.splice(e.start, e.end - e.start, ...e.lines));
  return out;
}

/** claude.ai/new with the prompt pre-filled; a very long prompt gets an empty chat (it is on the clipboard too). */
function chatUrl(text) {
  const url = 'https://claude.ai/new?q=' + encodeURIComponent(text);
  return url.length <= 6000 ? url : 'https://claude.ai/new';
}

module.exports = { chatUrl, buildFixPrompt, parseFixReply, extractReply, planEdits, applyEdits, windowFor, anchorLine, FIX_SYSTEM };
