// Tests the command-line tool and the skill bundle. They need latexmk (through WSL on Windows), like the VS Code tests.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tool = path.join(root, 'scripts', 'sidekick.js');
const sk = (script, args, cwd) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', timeout: 180000 });
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name));
const rm = (d) => { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp */ } };
const doc = (body) => '\\documentclass{article}\n\\begin{document}\n' + body + '\n\\end{document}\n';

const haveTex = sk(tool, ['doctor'], root).stdout.includes('ok      latexmk');

test('build reports a clean paper with exit code 0', { skip: !haveTex && 'latexmk not available' }, () => {
  const dir = tmp('sk-good-');
  try {
    fs.writeFileSync(path.join(dir, 'main.tex'), doc('Hello world.'));
    const r = sk(tool, ['build', 'main.tex'], dir);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /BUILD OK \(0 errors/);
    assert.ok(fs.existsSync(path.join(dir, '.latex-build', 'main.pdf')));
  } finally { rm(dir); }
});

test('build lists an error with line, source text and hint, and exits 1', { skip: !haveTex && 'latexmk not available' }, () => {
  const dir = tmp('sk-bad-');
  try {
    fs.writeFileSync(path.join(dir, 'main.tex'), doc('Some \\textcolor{red}{x} text, see \\ref{nope}.'));
    const r = sk(tool, ['build', 'main.tex'], dir);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /BUILD FAILED/);
    assert.match(r.stdout, /ERROR main\.tex:3  Undefined control sequence/);
    assert.match(r.stdout, /source: .*textcolor/);
    assert.match(r.stdout, /usepackage\{xcolor\}/);
    const j = JSON.parse(sk(tool, ['build', 'main.tex', '--json'], dir).stdout);
    assert.strictEqual(j.ok, false);
    assert.ok(j.issues.some((i) => i.code === 'undefined-command' && i.cmd === '\\textcolor' && i.line === 3));
  } finally { rm(dir); }
});

test('init is opt-in and never overwrites', () => {
  const dir = tmp('sk-init-');
  try {
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n');
    const r = sk(tool, ['init', dir, '--main', 'paper/main.tex'], root);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), /^node_modules\n\n# LaTeX Sidekick build output\n\.latex-build\/\n$/);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, '.vscode', 'settings.json'), 'utf8'))['latexEditor.mainFile'], 'paper/main.tex');
  } finally { rm(dir); }
});

test('the installed skill is self-contained: it builds from a copy with no access to the repository', { skip: !haveTex && 'latexmk not available' }, () => {
  const skills = tmp('sk-skills-'), proj = tmp('sk-proj-');
  try {
    const r = sk(tool, ['install-skill', '--to', skills], root);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const dest = path.join(skills, 'latex-sidekick');
    for (const f of ['SKILL.md', 'scripts/sidekick.js', 'src/parse.js', 'src/issues.js', 'src/project.js', 'src/paths.js']) assert.ok(fs.existsSync(path.join(dest, f)), 'missing ' + f);
    assert.match(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8'), /^---\nname: latex-sidekick\ndescription: .+\n---/);
    fs.writeFileSync(path.join(proj, 'main.tex'), doc('Hi \\nosuchcommand there.'));
    const b = sk(path.join(dest, 'scripts', 'sidekick.js'), ['build', 'main.tex'], proj);
    assert.strictEqual(b.status, 1, b.stdout + b.stderr);
    assert.match(b.stdout, /Undefined control sequence/);
  } finally { rm(skills); rm(proj); }
});

test('setup finds the main file in a repo and prepares it (extension step skipped here)', () => {
  const dir = tmp('sk-setup-');
  try {
    fs.mkdirSync(path.join(dir, 'paper'));
    fs.mkdirSync(path.join(dir, 'paper', 'sections'));
    fs.writeFileSync(path.join(dir, 'paper', 'main.tex'), doc('Hi.'));
    fs.writeFileSync(path.join(dir, 'paper', 'sections', 'intro.tex'), '\\section{Intro}\nText.\n');   // no \documentclass: not a main file
    const r = sk(tool, ['setup', dir, '--skip-extension'], root);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Main file: paper[\\/]main\.tex/);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, '.vscode', 'settings.json'), 'utf8'))['latexEditor.mainFile'], 'paper/main.tex');
    assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), /\.latex-build\//);
    const again = sk(tool, ['setup', dir, '--skip-extension'], root);   // running it twice changes nothing
    assert.match(again.stdout, /already/);
    const none = sk(tool, ['setup', tmp('sk-empty-'), '--skip-extension'], root);
    assert.strictEqual(none.status, 2);
  } finally { rm(dir); }
});
