// Build the .vsix and install it into your VS Code, in one step: npm run install-local
// After this the extension is available in every folder you open.
const { spawnSync } = require('child_process');
const path = require('path');
const root = path.resolve(__dirname, '..');
const version = require(path.join(root, 'package.json')).version;
const vsix = `latex-sidekick-${version}.vsix`;
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) { console.error(`\n"${cmd} ${args.join(' ')}" failed. See the message above.`); process.exit(r.status || 1); }
};
run('npx', ['--yes', '@vscode/vsce', 'package']);
run('code', ['--install-extension', vsix, '--force']);
console.log(`\nInstalled ${vsix}. Reload VS Code (Ctrl+Shift+P, "Reload Window") to use it in any project.`);
