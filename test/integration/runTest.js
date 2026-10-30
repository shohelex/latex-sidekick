// Launches a real VS Code with only this extension, in a throwaway profile, and runs ./suite.js inside it.
// Usage: npm run test:vscode   (set VSCODE_EXE to use a specific Code.exe)
const path = require('path');
const os = require('os');
const fs = require('fs');
const { runTests } = require('@vscode/test-electron');

function findCode() {
  if (process.env.VSCODE_EXE) return process.env.VSCODE_EXE;
  const local = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe');
  return local && fs.existsSync(local) ? local : undefined;   // undefined: download a stable build
}

(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sidekick-test-'));
  try {
    await runTests({
      vscodeExecutablePath: findCode(),
      extensionDevelopmentPath: root,
      extensionTestsPath: path.join(__dirname, 'suite.js'),
      launchArgs: [path.join(root, 'sample'), '--disable-extensions', '--user-data-dir', path.join(profile, 'data'), '--extensions-dir', path.join(profile, 'ext'), '--disable-workspace-trust'],
    });
  } catch (e) {
    console.error('Integration tests failed:', e.message);
    process.exitCode = 1;
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
})();
