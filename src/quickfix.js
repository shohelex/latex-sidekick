const vscode = require('vscode');
const { packageFor, planPackage, closest } = require('./issues');

/**
 * Lightbulb fixes for build problems. Local fixes first (they need no network), then "Fix with Claude".
 * host.lookup(uri, diagnostic) -> issue; host.candidates(kind) -> Promise<string[]> (kind: 'label' | 'cite').
 */
function register(context, host) {
  const provider = {
    async provideCodeActions(doc, _range, ctx) {
      try { return await actionsFor(doc, ctx); } catch (e) { console.error('[latex-sidekick] quick fixes', e); return []; }   // a lightbulb must never break the editor
    },
  };
  async function actionsFor(doc, ctx) {
      const actions = [];
      for (const d of ctx.diagnostics) {
        if (d.source !== 'latex') continue;
        const issue = host.lookup(doc.uri, d);
        if (!issue) continue;
        const make = (title) => { const a = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix); a.diagnostics = [d]; return a; };

        const pkg = packageFor(issue);
        const plan = pkg && planPackage(doc.getText(), pkg);
        if (plan) {
          const a = make(`Add \\usepackage{${pkg}}`);
          a.isPreferred = true;
          a.edit = new vscode.WorkspaceEdit();
          a.edit.insert(doc.uri, new vscode.Position(plan.line, 0), plan.text + '\n');
          actions.push(a);
        }
        if ((issue.code === 'undefined-ref' || issue.code === 'undefined-cite') && issue.key) {
          const near = closest(issue.key, await host.candidates(issue.code === 'undefined-ref' ? 'label' : 'cite'));
          const at = d.range.start.line;
          const col = at < doc.lineCount ? doc.lineAt(at).text.indexOf(issue.key) : -1;
          if (near && col >= 0) {
            const a = make(`Change "${issue.key}" to "${near}"`);
            a.isPreferred = true;
            a.edit = new vscode.WorkspaceEdit();
            a.edit.replace(doc.uri, new vscode.Range(at, col, at, col + issue.key.length), near);
            actions.push(a);
          }
          if (issue.code === 'undefined-cite') {
            const a = make('Add a reference by DOI…');
            a.command = { command: 'latexEditor.addByDoi', title: 'Add by DOI' };
            actions.push(a);
          }
        }
        const ai = make('Fix with Claude: ' + issue.message.slice(0, 50));
        ai.command = { command: 'latexEditor.ai.fixIssue', title: 'Fix with Claude', arguments: [issue] };
        actions.push(ai);
        const chat = make('Fix with free Claude.ai account (copy & paste, no API key)');
        chat.command = { command: 'latexEditor.ai.fixInChat', title: 'Fix in Claude.ai', arguments: [issue] };
        actions.push(chat);
        const log = make('Show build log');
        log.command = { command: 'latexEditor.showLog', title: 'Show build log' };
        actions.push(log);
      }
      return actions;
  }
  context.subscriptions.push(vscode.languages.registerCodeActionsProvider(
    [{ language: 'latex' }, { language: 'tex' }, { language: 'bibtex' }, { pattern: '**/*.{tex,bib}' }], provider,
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }));
}

module.exports = { register };
