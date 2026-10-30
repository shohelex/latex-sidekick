const vscode = require('vscode');
const { stripFences } = require('./parse');
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

async function callClaude(apiKey, instruction, text, signal) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: cfg().get('ai.model'),
      max_tokens: 4096,
      system: SYSTEM,
      messages: [{ role: 'user', content: `Instruction: ${instruction}\n\nLaTeX fragment:\n${text}` }],
    }),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch { /* ignore */ }
    throw new Error(`Anthropic API ${res.status}${detail ? ': ' + detail : ''}`);
  }
  const data = await res.json();
  return stripFences((data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('')).replace(/\s+$/, '');
}

function register(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('latexEditor.ai.setApiKey', async () => {
      const key = await vscode.window.showInputBox({
        prompt: 'Anthropic API key (stored in VS Code\'s encrypted secret storage, never in files)',
        password: true, ignoreFocusOut: true,
      });
      if (key) { await context.secrets.store(KEY, key.trim()); vscode.window.showInformationMessage('API key saved.'); }
    }),
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
      let key = await context.secrets.get(KEY);
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
            return callClaude(key, instruction, text, ac.signal);
          });
        await ed.edit((eb) => eb.replace(range, result));   // one undo step restores the original
        vscode.window.setStatusBarMessage('$(check) Claude edit applied (Ctrl+Z to undo)', 5000);
      } catch (e) {
        if (e.name !== 'AbortError') vscode.window.showErrorMessage(`AI edit failed: ${e.message}`);
      }
    }));
}

module.exports = { register };
