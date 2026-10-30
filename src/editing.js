const vscode = require('vscode');
const { parseSections, countWords } = require('./parse');

const isTex = (d) => d && (d.languageId === 'latex' || d.languageId === 'tex' || d.fileName.endsWith('.tex'));

const SYMBOLS = [
  ['Greek', ['\\alpha', '\\beta', '\\gamma', '\\delta', '\\epsilon', '\\theta', '\\lambda', '\\mu', '\\pi', '\\sigma', '\\phi', '\\omega', '\\Delta', '\\Sigma', '\\Omega']],
  ['Operators', ['\\leq', '\\geq', '\\neq', '\\approx', '\\sim', '\\propto', '\\times', '\\cdot', '\\pm', '\\infty', '\\partial', '\\nabla', '\\in', '\\subset', '\\forall', '\\exists', '\\rightarrow', '\\Rightarrow', '\\leftrightarrow']],
  ['Math templates', ['\\frac{${1}}{${2}}', '\\sqrt{${1}}', '\\sum_{${1:i=1}}^{${2:n}}', '\\int_{${1:a}}^{${2:b}} ${3} \\, d${4:x}', '\\mathbb{${1:R}}', '\\hat{${1}}', '\\vec{${1}}', '\\left( ${1} \\right)']],
  ['Environments', [
    '\\begin{equation}\n\t${1}\n\\end{equation}',
    '\\begin{align}\n\t${1}\n\\end{align}',
    '\\begin{itemize}\n\t\\item ${1}\n\\end{itemize}',
    '\\begin{enumerate}\n\t\\item ${1}\n\\end{enumerate}',
    '\\begin{figure}[t]\n\t\\centering\n\t\\includegraphics[width=\\linewidth]{${1:file}}\n\t\\caption{${2}}\n\t\\label{fig:${3}}\n\\end{figure}',
    '\\begin{table}[t]\n\t\\centering\n\t\\caption{${1}}\n\t\\label{tab:${2}}\n\t\\begin{tabular}{${3:lcc}}\n\t\t\\hline\n\t\t${4}\n\t\t\\hline\n\t\\end{tabular}\n\\end{table}',
    '\\begin{theorem}\n\t${1}\n\\end{theorem}',
    '\\begin{abstract}\n\t${1}\n\\end{abstract}',
  ]],
];

function register(context) {
  const sel = [{ language: 'latex' }, { language: 'tex' }];

  // Outline: VS Code's built-in Outline view and breadcrumbs use these symbols.
  context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(sel, {
    provideDocumentSymbols(doc) {
      const secs = parseSections(doc.getText());
      const roots = [];
      const stack = [];
      secs.forEach((s, i) => {
        const endLine = (() => {
          for (let j = i + 1; j < secs.length; j++) if (secs[j].level <= s.level) return secs[j].line - 1;
          return doc.lineCount - 1;
        })();
        const range = new vscode.Range(s.line, 0, Math.max(s.line, endLine), 0);
        const sym = new vscode.DocumentSymbol(s.title || '(untitled)', s.kind, vscode.SymbolKind.String, range, doc.lineAt(s.line).range);
        while (stack.length && stack[stack.length - 1].level >= s.level) stack.pop();
        (stack.length ? stack[stack.length - 1].sym.children : roots).push(sym);
        stack.push({ level: s.level, sym });
      });
      return roots;
    },
  }));

  // Word count in the status bar.
  const wc = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10);
  let timer;
  const update = () => {
    const ed = vscode.window.activeTextEditor;
    if (!ed || !isTex(ed.document)) { wc.hide(); return; }
    const sel = ed.selection;
    const n = countWords(ed.document.getText(sel.isEmpty ? undefined : sel));
    wc.text = `$(book) ${n.toLocaleString()} word${n === 1 ? '' : 's'}${sel.isEmpty ? '' : ' (selection)'}`;
    wc.tooltip = 'Approximate word count (body text only; math, commands and comments excluded)';
    wc.show();
  };
  const later = () => { clearTimeout(timer); timer = setTimeout(update, 400); };
  context.subscriptions.push(wc,
    vscode.window.onDidChangeActiveTextEditor(update),
    vscode.window.onDidChangeTextEditorSelection(later),
    vscode.workspace.onDidChangeTextDocument(later));
  update();

  // Toolbar-style insert menu and formatting shortcuts.
  context.subscriptions.push(
    vscode.commands.registerCommand('latexEditor.insert', async () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed) return;
      const cat = await vscode.window.showQuickPick(SYMBOLS.map(([label]) => label), { placeHolder: 'Insert…' });
      if (!cat) return;
      const items = SYMBOLS.find(([l]) => l === cat)[1];
      const pick = await vscode.window.showQuickPick(items.map((s) => ({ label: s.replace(/\$\{\d+(:[^}]*)?\}/g, '▢').split('\n')[0], snippet: s })), { placeHolder: cat });
      if (pick) await ed.insertSnippet(new vscode.SnippetString(pick.snippet.startsWith('\\') && !/[{}]/.test(pick.snippet) ? pick.snippet + ' ' : pick.snippet));
    }),
    vscode.commands.registerCommand('latexEditor.wrap', async (cmd) => {
      const ed = vscode.window.activeTextEditor;
      if (!ed || typeof cmd !== 'string') return;
      await ed.edit((eb) => {
        for (const s of ed.selections) {
          const t = ed.document.getText(s);
          eb.replace(s, s.isEmpty ? `\\${cmd}{}` : `\\${cmd}{${t}}`);
        }
      });
      // Put the caret inside the braces when nothing was selected.
      ed.selections = ed.selections.map((s, i) => (ed.selections[i].isEmpty
        ? new vscode.Selection(s.active.translate(0, -1), s.active.translate(0, -1)) : s));
    }));
}

module.exports = { register };
