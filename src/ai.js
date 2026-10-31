const vscode = require('vscode');
const path = require('path');
const { stripFences } = require('./parse');
const fix = require('./fix');
const { cfg } = require('./exec');

const KEY = 'latexEditor.anthropicApiKey';

const SYSTEM = [
  'You are an editor for LaTeX manuscripts.',
  'Apply the user\'s instruction to the given LaTeX fragment.',
  'Keep every LaTeX command, environment, label, citation and math expression valid and intact unless the instruction says to change it.',
  'Reply with the revised fragment only: no explanation, no code fences.',
].join(' ');

const PRESETS = [
  { label: 'Fix grammar and spelling', instruction: 'Fix grammar, spelling and punctuation. Do not change the meaning or style.' },
  { label: 'Make more concise', instruction: 'Make this shorter and tighter while keeping all technical content.' },
  { label: 'Make more formal / academic', instruction: 'Rewrite in a precise, formal academic register.' },
  { label: 'Expand', instruction: 'Expand with a little more explanatory detail, without inventing facts or results.' },
  { label: 'Custom instruction…', instruction: null },
];

// The endpoint can only be overridden by an environment variable (the tests use it), never by a workspace
// setting, so a project you open cannot redirect your API key.
const ENDPOINT = () => process.env.LATEX_SIDEKICK_API_URL || 'https://api.anthropic.com/v1/messages';

async function callClaude(apiKey, system, user, signal) {
  const res = await fetch(ENDPOINT(), {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: cfg().get('ai.model'),
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch { /* ignore */ }
    throw new Error(`Anthropic API ${res.status}${detail ? ': ' + detail : ''}`);
  }
  const data = await res.json();
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
}

// ---- Fix with AI: proposed text is shown in a diff, and applied only after the user confirms ----
const proposals = new Map();
const SCHEME = 'latex-sidekick-fix';
let pending;   // a fix waiting for the user to paste Claude's answer from claude.ai

function toRange(doc, e) {
  const n = doc.lineCount;
  if (e.start === e.end) return new vscode.Range(Math.min(e.start, n), 0, Math.min(e.start, n), 0);
  return e.end < n ? new vscode.Range(e.start, 0, e.end, 0) : new vscode.Range(e.start, 0, n - 1, doc.lineAt(n - 1).text.length);
}

/** Show the proposal as a diff, ask, and apply. `ctx` = { doc, lines, eol, version, prompt }. */
async function finishFix(ctx, reply, opts = {}) {
  const { doc, lines, eol, version, prompt } = ctx;
  const parsed = fix.parseFixReply(reply);
  const plan = fix.planEdits(lines, prompt.window, parsed, prompt.fragment);
  const extra = plan.skippedPreamble.length ? ` Also add to your preamble: ${plan.skippedPreamble.join(' ')}` : '';
  if (!plan.edits.length) {
    vscode.window.showInformationMessage(`Claude: ${parsed.explanation || 'no change suggested.'}${extra}`);
    return { applied: false, explanation: parsed.explanation };
  }
  if (!opts.apply) {
    const id = String(Date.now());
    proposals.set(id, fix.applyEdits(lines, plan.edits).join(eol));
    const right = vscode.Uri.from({ scheme: SCHEME, path: '/' + path.basename(doc.uri.fsPath), query: id });
    await vscode.commands.executeCommand('vscode.diff', doc.uri, right, `Claude's fix for ${path.basename(doc.uri.fsPath)} (right side is the proposal)`);
    const choice = await vscode.window.showInformationMessage(`${parsed.explanation}${extra}`, 'Apply fix', 'Discard');
    proposals.delete(id);
    if (choice !== 'Apply fix') return { applied: false, explanation: parsed.explanation };
  }
  if (doc.version !== version) {
    vscode.window.showWarningMessage('The file changed while Claude was working. Run the fix again.');
    return { applied: false, explanation: parsed.explanation };
  }
  const we = new vscode.WorkspaceEdit();
  for (const e of plan.edits) {
    const r = toRange(doc, e);
    const body = e.lines.join(eol);
    if (e.start === e.end) we.insert(doc.uri, r.start, e.start >= doc.lineCount ? eol + body : body + eol);
    else we.replace(doc.uri, r, e.end < doc.lineCount ? body + eol : body);
  }
  await vscode.workspace.applyEdit(we);
  vscode.window.setStatusBarMessage('$(check) Claude fix applied (Ctrl+Z to undo). Save to rebuild.', 6000);
  return { applied: true, explanation: parsed.explanation };
}

const CHAT_FORMAT = 'Put your entire reply, tags included, inside ONE fenced code block (```), so it can be copied with the copy button.';

/**
 * Open a URL in the default browser. VS Code's own openExternal re-encodes the query (breaking ?q=), so launch the
 * browser directly with the URL as one argument (no shell, so & and % are safe). Remote windows use openExternal.
 */
function openUrl(url) {
  if (vscode.env.remoteName) return vscode.env.openExternal(vscode.Uri.parse(url.split('?')[0]));
  const cmd = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const child = require('child_process').spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' });
  child.on('error', () => vscode.env.openExternal(vscode.Uri.parse(url.split('?')[0])));
  child.unref();
}
let stopWatching;
/**
 * While waiting for the answer, look at the clipboard every 1.5 s. Only the text is checked for the reply format;
 * it is used only when it is a reply (not our own prompt). Stops on cancel, on success, or after 15 minutes.
 */
function watchForAnswer(promptText, opts) {
  if (stopWatching) stopWatching();
  vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Waiting for Claude\'s answer: send the prompt in claude.ai, then click its copy button', cancellable: true },
    (_p, token) => new Promise((resolve) => {
      const started = Date.now();
      let last = promptText, busy = false;
      const done = () => { clearInterval(timer); stopWatching = undefined; resolve(); };
      const timer = setInterval(async () => {
        if (busy) return;
        busy = true;
        try {
          if (Date.now() - started > 15 * 60 * 1000) { done(); return; }
          const t = await vscode.env.clipboard.readText();
          if (t === last) return;
          last = t;
          if (fix.extractReply(t) !== undefined && !t.includes('<fragment>')) { done(); applyClipboardFix({ apply: opts.apply }); }
        } finally { busy = false; }
      }, 1500);
      stopWatching = done;
      token.onCancellationRequested(done);
    }));
}

async function fixIssue(context, issue, opts = {}) {
  if (!issue) { vscode.window.showInformationMessage('No build problem to fix. Build first (Ctrl+S).'); return; }
  const file = issue.path || (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.fsPath);
  let doc;
  try { doc = await vscode.workspace.openTextDocument(file); } catch { vscode.window.showWarningMessage('Could not open ' + file); return; }
  const lines = doc.getText().split(/\r?\n/);
  const ctx = {
    doc, lines, version: doc.version, eol: doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n',
    prompt: fix.buildFixPrompt(issue, lines, cfg().get('ai.fixContextLines') || 12),
  };

  let key = process.env.LATEX_SIDEKICK_API_KEY || await context.secrets.get(KEY);
  let mode = opts.mode || (key ? 'api' : undefined);
  if (!mode) {
    // No API key: a free claude.ai account works too, by copy and paste.
    const pick = await vscode.window.showQuickPick([
      { label: '$(comment-discussion) Use my free Claude.ai account', description: 'No API key. Copy the prompt, paste it into claude.ai, paste the answer back.', mode: 'chat' },
      { label: '$(key) Use an Anthropic API key', description: 'Automatic. Needs a key from console.anthropic.com.', mode: 'api' },
    ], { placeHolder: 'How should Claude fix this?' });
    if (!pick) return;
    mode = pick.mode;
  }

  if (mode === 'chat') {
    const text = `${ctx.prompt.system}\n${CHAT_FORMAT}\n\n${ctx.prompt.user}`;
    await vscode.env.clipboard.writeText(text);   // fallback if the chat opens empty
    pending = { ctx };
    if (!opts.noOpen) openUrl(fix.chatUrl(text));
    if (opts.watch !== false) watchForAnswer(text, opts);
    return { pending: true, prompt: text };
  }

  if (!key) {
    await vscode.commands.executeCommand('latexEditor.ai.setApiKey');
    key = await context.secrets.get(KEY);
    if (!key) return;
  }
  let reply;
  try {
    reply = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Asking Claude to fix: ' + issue.message.slice(0, 60), cancellable: true },
      (_p, token) => {
        const ac = new AbortController();
        token.onCancellationRequested(() => ac.abort());
        return callClaude(key, ctx.prompt.system, ctx.prompt.user, ac.signal);
      });
  } catch (e) {
    if (e.name !== 'AbortError') vscode.window.showErrorMessage(`AI fix failed: ${e.message}`);
    return { error: e.message };
  }
  return finishFix(ctx, reply, opts);
}

async function applyClipboardFix(opts = {}) {
  if (!pending) { vscode.window.showInformationMessage('Nothing is waiting. Use "Fix with AI" on a build problem first.'); return; }
  if (stopWatching) stopWatching();
  const reply = fix.extractReply(await vscode.env.clipboard.readText());
  if (reply === undefined) {
    vscode.window.showWarningMessage('The clipboard does not hold Claude\'s answer. Copy the whole answer from claude.ai (the copy button on its code block) and try again.');
    return { applied: false };
  }
  const { ctx } = pending;
  const out = await finishFix(ctx, reply, opts);
  if (out && (out.applied || out.explanation !== undefined)) pending = undefined;
  return out;
}

function register(context, host = {}) {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, { provideTextDocumentContent: (uri) => proposals.get(uri.query) || '' }),
    vscode.commands.registerCommand('latexEditor.ai.setApiKey', async () => {
      const key = await vscode.window.showInputBox({
        prompt: 'Anthropic API key (stored in VS Code\'s encrypted secret storage, never in files)',
        password: true, ignoreFocusOut: true,
      });
      if (key) { await context.secrets.store(KEY, key.trim()); vscode.window.showInformationMessage('API key saved.'); }
    }),
    vscode.commands.registerCommand('latexEditor.ai.fixIssue', (issue, opts) => fixIssue(context, issue, opts)),
    vscode.commands.registerCommand('latexEditor.ai.fixInChat', (issue, opts) => fixIssue(context, issue || firstProblem(host), { ...opts, mode: 'chat' })),
    vscode.commands.registerCommand('latexEditor.ai.applyClipboardFix', (opts) => applyClipboardFix(opts)),
    vscode.commands.registerCommand('latexEditor.ai.fixFirstError', () => fixIssue(context, firstProblem(host))),
    vscode.commands.registerCommand('latexEditor.ai.edit', async () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed) return;
      let range = ed.selection;
      if (range.isEmpty) {
        // Fall back to the current paragraph.
        const doc = ed.document;
        let a = range.start.line, b = a;
        while (a > 0 && doc.lineAt(a - 1).text.trim() !== '') a--;
        while (b < doc.lineCount - 1 && doc.lineAt(b + 1).text.trim() !== '') b++;
        range = new vscode.Range(a, 0, b, doc.lineAt(b).text.length);
      }
      const text = ed.document.getText(range);
      if (!text.trim()) return;
      let key = process.env.LATEX_SIDEKICK_API_KEY || await context.secrets.get(KEY);
      if (!key) {
        await vscode.commands.executeCommand('latexEditor.ai.setApiKey');
        key = await context.secrets.get(KEY);
        if (!key) return;
      }
      const pick = await vscode.window.showQuickPick(PRESETS, { placeHolder: 'What should the assistant do with the selected text?' });
      if (!pick) return;
      const instruction = pick.instruction || await vscode.window.showInputBox({ prompt: 'Instruction' });
      if (!instruction) return;
      try {
        const result = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Asking Claude…', cancellable: true },
          (_p, token) => {
            const ac = new AbortController();
            token.onCancellationRequested(() => ac.abort());
            return callClaude(key, SYSTEM, `Instruction: ${instruction}\n\nLaTeX fragment:\n${text}`, ac.signal)
              .then((t) => stripFences(t).replace(/\s+$/, ''));
          });
        await ed.edit((eb) => eb.replace(range, result));   // one undo step restores the original
        vscode.window.setStatusBarMessage('$(check) Claude edit applied (Ctrl+Z to undo)', 5000);
      } catch (e) {
        if (e.name !== 'AbortError') vscode.window.showErrorMessage(`AI edit failed: ${e.message}`);
      }
    }));
}

function firstProblem(host) {
  const list = (host.issues && host.issues() && host.issues().issues) || [];
  return list.find((i) => i.severity === 'error') || list.find((i) => i.severity === 'warning');
}

module.exports = { register };
