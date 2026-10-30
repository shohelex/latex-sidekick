const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { parseBib, parseLabels } = require('./parse');

const CITE_RE = /\\(?:[a-zA-Z]*cite[a-zA-Z]*|nocite)\*?(?:\[[^\]]*\])*\{[^}]*$/;
const REF_RE = /\\(?:ref|eqref|autoref|cref|Cref|pageref|vref)\*?\{[^}]*$/;
const SKIP = '**/{node_modules,.latex-build,.git}/**';

async function readAll(glob) {
  const files = await vscode.workspace.findFiles(glob, SKIP, 500);
  const out = [];
  for (const f of files) {
    const open = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === f.fsPath);
    try { out.push({ file: f.fsPath, text: open ? open.getText() : fs.readFileSync(f.fsPath, 'utf8') }); } catch { /* unreadable */ }
  }
  return out;
}

async function allEntries() {
  const entries = [];
  for (const { file, text } of await readAll('**/*.bib')) {
    for (const e of parseBib(text)) entries.push({ ...e, file });
  }
  return entries;
}

const firstAuthor = (a = '') => a.split(/\s+and\s+/)[0].replace(/[{}]/g, '');
const describe = (e) => `${firstAuthor(e.fields.author)}${e.fields.year ? ' (' + e.fields.year + ')' : ''}`;
const clean = (s = '') => s.replace(/[{}]/g, '');

function register(context) {
  const provider = {
    async provideCompletionItems(doc, pos) {
      const before = doc.lineAt(pos).text.slice(0, pos.character);
      if (CITE_RE.test(before)) {
        return (await allEntries()).map((e) => {
          const it = new vscode.CompletionItem(e.key, vscode.CompletionItemKind.Reference);
          it.detail = describe(e);
          it.documentation = clean(e.fields.title);
          return it;
        });
      }
      if (REF_RE.test(before)) {
        const labels = new Set();
        for (const { text } of await readAll('**/*.tex')) parseLabels(text).forEach((l) => labels.add(l));
        return [...labels].map((l) => new vscode.CompletionItem(l, vscode.CompletionItemKind.Reference));
      }
      return undefined;
    },
  };
  const hover = {
    async provideHover(doc, pos) {
      const range = doc.getWordRangeAtPosition(pos, /[\w:.\-/]+/);
      if (!range || !CITE_RE.test(doc.lineAt(pos).text.slice(0, range.end.character))) return undefined;
      const key = doc.getText(range);
      const e = (await allEntries()).find((x) => x.key === key);
      return e ? new vscode.Hover(`**${clean(e.fields.title)}**\n\n${clean(e.fields.author)} — ${e.fields.year || ''} ${clean(e.fields.journal || e.fields.booktitle || '')}`) : undefined;
    },
  };
  const sel = [{ language: 'latex' }, { language: 'tex' }];

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(sel, provider, '{', ','),
    vscode.languages.registerHoverProvider(sel, hover),
    vscode.commands.registerCommand('latexEditor.insertCitation', async () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed) return;
      const entries = await allEntries();
      if (!entries.length) { vscode.window.showInformationMessage('No .bib entries found in this workspace. Use "LaTeX Editor: Add Reference by DOI".'); return; }
      const picks = await vscode.window.showQuickPick(
        entries.map((e) => ({ label: e.key, description: describe(e), detail: clean(e.fields.title) })),
        { canPickMany: true, matchOnDescription: true, matchOnDetail: true, placeHolder: 'Search your references' });
      if (picks && picks.length) {
        await ed.insertSnippet(new vscode.SnippetString(`\\cite{${picks.map((p) => p.label).join(', ')}}`));
      }
    }),
    vscode.commands.registerCommand('latexEditor.addByDoi', async () => {
      const raw = await vscode.window.showInputBox({ prompt: 'DOI (e.g. 10.1000/xyz123) — fetched from doi.org', ignoreFocusOut: true });
      const doi = raw && raw.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
      if (!doi) return;
      if (!/^10\.\d{4,9}\/\S+$/.test(doi)) { vscode.window.showErrorMessage('That does not look like a DOI.'); return; }
      try {
        const res = await fetch('https://doi.org/' + encodeURI(doi), { headers: { Accept: 'application/x-bibtex' }, redirect: 'follow' });
        if (!res.ok) throw new Error(`doi.org returned ${res.status}`);
        const bib = (await res.text()).trim();
        if (!/^@\w+\s*\{/.test(bib)) throw new Error('doi.org did not return BibTeX');
        const existing = (await vscode.workspace.findFiles('**/*.bib', SKIP, 1))[0];
        const ed = vscode.window.activeTextEditor;
        const target = existing ? existing.fsPath : path.join(
          ed ? path.dirname(ed.document.uri.fsPath) : vscode.workspace.workspaceFolders[0].uri.fsPath, 'references.bib');
        fs.appendFileSync(target, (fs.existsSync(target) && fs.statSync(target).size ? '\n\n' : '') + bib + '\n');
        const key = /^@\w+\s*\{\s*([^,\s]+)/.exec(bib)[1];
        vscode.window.showInformationMessage(`Added ${key} to ${path.basename(target)}`);
      } catch (e) {
        vscode.window.showErrorMessage(`Could not add reference: ${e.message}`);
      }
    }));
}

module.exports = { register };
