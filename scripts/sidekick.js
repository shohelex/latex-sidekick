#!/usr/bin/env node
// LaTeX Sidekick command-line tool: build a paper and list its problems, with hints, without VS Code.
// Used by the Claude Code skill (skills/latex-sidekick), but works on its own:
//   node sidekick.js build main.tex        build with latexmk (WSL on Windows) and report errors/warnings
//   node sidekick.js doctor                check that the TeX tools are available
//   node sidekick.js setup [dir] [--open]  one step for a repo: install/update the VS Code extension, init, open VS Code
//   node sidekick.js init [dir] [--main main.tex]   add .gitignore entry and .vscode/settings.json (never overwrites)
//   node sidekick.js install-extension     install the VS Code extension (.vsix)
//   node sidekick.js install-skill         copy the Claude Code skill (self-contained) into ~/.claude/skills
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseLog, parseBlg, diagnoseSetup, wslToWin } = require('../src/parse');
const { toWslPath } = require('../src/paths');
const { initProject } = require('../src/project');

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : dflt; };
const VALUE_FLAGS = ['engine', 'outdir', 'timeout', 'main', 'to'];
const positional = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && VALUE_FLAGS.includes(all[i - 1].replace(/^--/, '')) && all[i - 1].startsWith('--')));
const native = !!flag('native', false) || process.platform !== 'win32';

/** Run a tool, through WSL on Windows unless --native. Output is captured (bounded). */
function run(tool, args, dir, timeoutMs) {
  const [c, a, o] = native ? [tool, args, { cwd: dir }] : ['wsl.exe', ['--cd', toWslPath(dir), tool, ...args], {}];
  const r = spawnSync(c, a, { ...o, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, shell: false });
  const err = r.error ? `Failed to start ${c}: ${r.error.message}\n` : '';
  return { status: r.status, log: err + (r.stdout || '') + (r.stderr || '') + (r.signal ? '\n[build timed out]\n' : '') };
}

const readHead = (f, max) => { try { return fs.readFileSync(f, 'utf8').slice(0, max); } catch { return ''; } };

function build(file) {
  if (!file) { console.error('Usage: sidekick.js build <main.tex> [--engine pdflatex|xelatex|lualatex] [--outdir .latex-build] [--timeout 120] [--json] [--all]'); return 2; }
  const main = path.resolve(file);
  if (!fs.existsSync(main)) { console.error(`File not found: ${main}`); return 2; }
  const dir = path.dirname(main), outDir = flag('outdir', '.latex-build');
  const engine = { pdflatex: '-pdf', xelatex: '-xelatex', lualatex: '-lualatex' }[flag('engine', 'pdflatex')] || '-pdf';
  const t0 = Date.now();
  const { status, log } = run('latexmk', [engine, '-interaction=nonstopmode', '-file-line-error', '-synctex=1', `-output-directory=${outDir}`, path.basename(main)], dir, Number(flag('timeout', 120)) * 1000);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const setup = diagnoseSetup(log);
  const stem = path.join(dir, outDir, path.basename(main).replace(/\.tex$/i, ''));
  const text = setup ? log : readHead(stem + '.log', 8 * 1024 * 1024) || log;
  const found = [...parseLog(text), ...(setup ? [] : parseBlg(readHead(stem + '.blg', 2 * 1024 * 1024)))];
  const locate = (f) => { if (!f) return main; const p = path.resolve(dir, wslToWin(f)); return fs.existsSync(p) ? p : fs.existsSync(path.join(dir, path.basename(f))) ? path.join(dir, path.basename(f)) : main; };
  const issues = found.map((i) => ({ ...i, path: locate(i.file) }));
  const count = (s) => issues.filter((i) => i.severity === s).length;
  const pdf = stem + '.pdf';
  const ok = status === 0 && !count('error');

  if (flag('json', false)) {
    console.log(JSON.stringify({ ok, setupProblem: setup || null, seconds: Number(secs), pdf: fs.existsSync(pdf) ? pdf : null, issues }, null, 2));
  } else {
    console.log(`${ok ? 'BUILD OK' : 'BUILD FAILED'} (${count('error')} errors, ${count('warning')} warnings, ${count('info')} typesetting notes) in ${secs}s${fs.existsSync(pdf) ? '  PDF: ' + pdf : ''}`);
    if (setup) console.log('SETUP PROBLEM: ' + setup);
    const order = { error: 0, warning: 1, info: 2 };
    let shown = 0;
    for (const i of [...issues].sort((a, b) => order[a.severity] - order[b.severity])) {
      if (i.severity === 'info' && !flag('all', false)) continue;
      if (++shown > 60) { console.log(`... ${issues.length - 60} more not shown (use --json or --all)`); break; }
      const rel = path.relative(process.cwd(), i.path) || i.path;
      console.log(`${i.severity.toUpperCase()} ${rel}${i.line ? ':' + i.line : ''}  ${i.message}`);
      if (i.context) console.log(`    source: ${i.context}`);
      if (i.hint) console.log(`    hint: ${i.hint}`);
    }
    if (!ok && !setup && !count('error')) console.log('No recognisable error. Last lines of the log:\n' + log.split(/\r?\n/).slice(-15).join('\n'));
  }
  return setup ? 2 : ok ? 0 : 1;
}

function doctor() {
  let bad = 0;
  for (const [tool, args] of [['latexmk', ['-v']], ['pdflatex', ['--version']], ['synctex', ['help']], ['bibtex', ['--version']], ['biber', ['--version']]]) {
    const r = run(tool, args, process.cwd(), 20000);
    const found = r.status === 0 || (tool === 'synctex' && /synctex/i.test(r.log));
    const first = (r.log.split(/\r?\n/).find((l) => l.trim()) || '').slice(0, 80);
    console.log(`${found ? 'ok     ' : 'MISSING'} ${tool}${found ? '  ' + first : ''}`);
    if (!found && ['latexmk', 'pdflatex'].includes(tool)) bad = 1;
  }
  if (bad) console.log('\n' + (diagnoseSetup('latexmk: not found') + ' (On Windows without WSL, use --native with MiKTeX/TeX Live.)'));
  return bad;
}

function init(dir) {
  const root = path.resolve(dir || '.');
  const main = flag('main', '');
  const r = initProject(root, { main: typeof main === 'string' ? main : '', disableWorkshop: !!flag('disable-workshop', false) });
  [...r.done, ...r.skipped].forEach((l) => console.log(l));
  return 0;
}

function codeCli(args) {
  const r = spawnSync('code', args, { stdio: 'inherit', shell: process.platform === 'win32' });
  return r.status === 0 ? 0 : 1;
}

const semver = (v) => v.split('.').map(Number);
const newer = (a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
const vsixVersion = (f) => (/^latex-sidekick-(\d+\.\d+\.\d+)\.vsix$/.exec(f) || [])[1];

/** The newest latex-sidekick-X.Y.Z.vsix in a folder. */
function findVsix(where) {
  return fs.readdirSync(where).filter((f) => vsixVersion(f)).sort((a, b) => (newer(vsixVersion(a), vsixVersion(b)) ? 1 : -1)).pop();
}

/** Find the root .tex file(s) of a project: files containing \documentclass, shallowest first, main.tex preferred. */
function findMainFiles(dir) {
  const found = [];
  const walk = (d, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 3) walk(p, depth + 1);
      else if (e.isFile() && /\.tex$/i.test(e.name) && /^\s*\\documentclass/m.test(readHead(p, 20000))) found.push({ p, depth });
    }
  };
  walk(dir, 0);
  return found.sort((a, b) => (a.depth - b.depth) || ((/^main\.tex$/i.test(path.basename(b.p)) ? 1 : 0) - (/^main\.tex$/i.test(path.basename(a.p)) ? 1 : 0)) || a.p.localeCompare(b.p)).map((f) => f.p);
}

/** Everything needed to edit a repo's LaTeX in VS Code: extension installed and current, project set up, VS Code opened. */
function setup(dir) {
  const root = path.resolve(dir || '.');
  const explicit = flag('main', '');
  const mains = typeof explicit === 'string' && explicit ? [path.resolve(root, explicit)] : findMainFiles(root);
  if (!mains.length) { console.error(`No .tex file with \\documentclass found under ${root}. Pass --main path/to/main.tex.`); return 2; }
  const main = mains[0];
  console.log(`Main file: ${path.relative(root, main)}${mains.length > 1 ? `  (also found: ${mains.slice(1, 4).map((m) => path.relative(root, m)).join(', ')}${mains.length > 4 ? ', ...' : ''})` : ''}`);

  const installed = {};
  if (!flag('skip-extension', false)) {
    const r = spawnSync('code', ['--list-extensions', '--show-versions'], { encoding: 'utf8', shell: process.platform === 'win32' });
    if (r.status !== 0) console.log('VS Code command "code" not found. Install VS Code and enable its "code" command, then run this again.');
    else {
      for (const l of r.stdout.split(/\r?\n/)) { const m = /^(.+)@(.+)$/.exec(l.trim()); if (m) installed[m[1].toLowerCase()] = m[2]; }
      const have = installed['local.latex-sidekick'];
      const where = [path.resolve(__dirname, '..'), __dirname, path.resolve(__dirname, '..', 'vsix')].find((w) => fs.existsSync(w) && findVsix(w));
      const want = where && vsixVersion(findVsix(where));
      if (have && (!want || !newer(want, have))) console.log(`VS Code extension: LaTeX Sidekick ${have} is already installed.`);
      else if (!where) console.log('VS Code extension: not installed, and no .vsix is bundled here. Build it in the extension repository with: npm run install-local');
      else { console.log(`VS Code extension: ${have ? 'updating ' + have + ' to ' + want : 'installing ' + want}`); installExtension(); }
    }
  }

  const workshop = !!installed['james-yu.latex-workshop'];
  const r = initProject(root, { main: path.relative(root, main), disableWorkshop: workshop });
  [...r.done, ...r.skipped].forEach((l) => console.log(l));
  if (workshop) console.log('LaTeX Workshop is installed: its build-on-save is turned off for this repo only, so two builds do not run on every save.');
  const tools = run('latexmk', ['-v'], root, 20000);
  if (tools.status !== 0) console.log('TeX tools: latexmk was not found. ' + diagnoseSetup('latexmk: not found'));

  if (flag('open', false)) {
    const child = spawnSync('code', [root, main], { shell: process.platform === 'win32', stdio: 'ignore' });
    console.log(child.status === 0 ? 'Opened the repo and the paper in VS Code.' : 'Could not open VS Code; open the folder yourself.');
  }
  console.log('Done. In VS Code: reload the window once if it was already open, then press Ctrl+S in the .tex file to build and see the PDF.');
  return 0;
}

function installExtension() {
  for (const where of [path.resolve(__dirname, '..'), __dirname, path.resolve(__dirname, '..', 'vsix')]) {
    if (!fs.existsSync(where)) continue;
    const v = findVsix(where);
    if (v) { console.log('Installing ' + path.join(where, v)); return codeCli(['--install-extension', path.join(where, v), '--force']); }
  }
  console.error('No latex-sidekick-*.vsix found next to this tool. Build it with: npm run install-local (in the extension repository).');
  return 1;
}

/** Copy a self-contained skill (SKILL.md, this tool, the modules it needs, and the .vsix if present) to ~/.claude/skills. */
function installSkill() {
  const root = path.resolve(__dirname, '..');
  const src = path.join(root, 'skills', 'latex-sidekick', 'SKILL.md');
  if (!fs.existsSync(src)) { console.error('SKILL.md not found; run this from the extension repository.'); return 1; }
  const dest = path.join(flag('to', path.join(os.homedir(), '.claude', 'skills')), 'latex-sidekick');
  fs.mkdirSync(path.join(dest, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dest, 'src'), { recursive: true });
  fs.copyFileSync(src, path.join(dest, 'SKILL.md'));
  fs.copyFileSync(__filename, path.join(dest, 'scripts', 'sidekick.js'));
  for (const f of ['parse.js', 'issues.js', 'project.js', 'paths.js']) fs.copyFileSync(path.join(root, 'src', f), path.join(dest, 'src', f));
  const vsix = findVsix(root);
  if (vsix) { fs.mkdirSync(path.join(dest, 'vsix'), { recursive: true }); fs.copyFileSync(path.join(root, vsix), path.join(dest, 'vsix', vsix)); }
  console.log(`Skill installed to ${dest}${vsix ? ' (with ' + vsix + ')' : ' (no .vsix found; run npm run install-local first to include it)'}`);
  console.log('Remove it any time by deleting that folder.');
  return 0;
}

const commands = { build: () => build(positional[0]), doctor, init: () => init(positional[0]), setup: () => setup(positional[0]), 'install-extension': installExtension, 'install-skill': installSkill };
if (!commands[cmd]) {
  console.log('LaTeX Sidekick tool\n  build <main.tex>   doctor   setup [dir] [--open]   init [dir] [--main main.tex]   install-extension   install-skill');
  process.exit(cmd ? 2 : 0);
}
process.exit(commands[cmd]());
