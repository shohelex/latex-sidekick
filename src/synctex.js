const vscode = require('vscode');
const path = require('path');
const { runTool, usingWsl, cfg } = require('./exec');
const { parseSynctex, wslToWin } = require('./parse');

const rel = (p) => p.replace(/\\/g, '/');

/** Source position -> PDF rectangle: [{ page, x, y, W, H }] in PDF points. */
async function forward(file, line, column, mainDir, pdfPath) {
  const input = rel(path.relative(mainDir, file));
  const { log } = await runTool('synctex', ['view', '-i', `${line}:${column}:${input}`, '-o', rel(path.relative(mainDir, pdfPath))], mainDir);
  return parseSynctex(log).filter((r) => r.page !== undefined);
}

/** PDF point -> source location, opened in the editor. */
async function reverse(page, x, y, mainDir, pdfPath) {
  const { log } = await runTool('synctex', ['edit', '-o', `${page}:${x.toFixed(2)}:${y.toFixed(2)}:${rel(path.relative(mainDir, pdfPath))}`], mainDir);
  const hit = parseSynctex(log).find((r) => r.input);
  if (!hit) return false;
  let file = usingWsl() ? wslToWin(hit.input) : hit.input;
  file = path.resolve(mainDir, file);
  const doc = await vscode.workspace.openTextDocument(file);
  const ed = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preserveFocus: false });
  const pos = new vscode.Position(Math.max(0, hit.line - 1), Math.max(0, hit.column));
  ed.selection = new vscode.Selection(pos, pos);
  ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  return true;
}

module.exports = { forward, reverse, cfg };
