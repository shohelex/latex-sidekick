// Opt-in project setup (no VS Code API, so it can be unit-tested): .gitignore entry and .vscode/settings.json.
const fs = require('fs');
const path = require('path');

/**
 * Prepare a project folder. Never overwrites anything the user has: it appends a .gitignore line only if missing,
 * and adds settings keys only if the file is plain JSON and the key is not already set.
 * Returns { done: string[], skipped: string[] } describing what happened, for showing to the user.
 */
function initProject(dir, { main, outDir = '.latex-build', gitignore = true, settings = true, disableWorkshop = false } = {}) {
  const done = [], skipped = [];

  if (gitignore) {
    const file = path.join(dir, '.gitignore');
    const entry = outDir.replace(/\\/g, '/').replace(/\/?$/, '/');
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const has = text.split(/\r?\n/).some((l) => l.trim().replace(/^\//, '') === entry || l.trim().replace(/^\//, '') === entry.slice(0, -1));
    if (has) skipped.push(`.gitignore already ignores ${entry}`);
    else {
      fs.writeFileSync(file, text + (text && !text.endsWith('\n') ? '\n' : '') + `${text ? '\n' : ''}# LaTeX Sidekick build output\n${entry}\n`);
      done.push(`.gitignore: added ${entry}`);
    }
  }

  if (settings) {
    const want = {};
    if (main) want['latexEditor.mainFile'] = main.replace(/\\/g, '/');
    if (disableWorkshop) want['latex-workshop.latex.autoBuild.run'] = 'never';
    const file = path.join(dir, '.vscode', 'settings.json');
    let cur = {};
    let ok = true;
    if (fs.existsSync(file)) {
      try { cur = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '') || '{}'); } catch { ok = false; }
    }
    if (!ok) skipped.push(`.vscode/settings.json has comments or is not plain JSON, so it was left alone. Add this yourself: ${JSON.stringify(want)}`);
    else {
      const add = Object.keys(want).filter((k) => !(k in cur));
      if (!add.length) skipped.push('.vscode/settings.json already has these settings');
      else {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        for (const k of add) cur[k] = want[k];
        fs.writeFileSync(file, JSON.stringify(cur, null, 2) + '\n');
        done.push(`.vscode/settings.json: added ${add.join(', ')}`);
      }
    }
  }
  return { done, skipped };
}

module.exports = { initProject };
