const vscode = require('vscode');
const cp = require('child_process');

const cfg = () => vscode.workspace.getConfiguration('latexEditor');

function toWslPath(p) {
  const m = /^([a-zA-Z]):[\\/](.*)$/.exec(p);
  return m ? `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : p.replace(/\\/g, '/');
}

const usingWsl = () => process.platform === 'win32' && cfg().get('useWSL');

/** Run a TeX tool (latexmk, synctex) in `dir`, through WSL when configured. */
function runTool(tool, args, dir, onData, timeoutMs) {
  let cmd, cmdArgs, opts = {};
  if (usingWsl()) {
    const distro = cfg().get('wslDistro');
    cmd = 'wsl.exe';
    cmdArgs = [...(distro ? ['-d', distro] : []), '--cd', toWslPath(dir), tool, ...args];
  } else {
    cmd = tool;
    cmdArgs = args;
    opts = { cwd: dir };
  }
  return new Promise((resolve) => {
    const p = cp.spawn(cmd, cmdArgs, opts);
    let log = '';
    const take = (d) => { const s = d.toString('utf8').replace(/\0/g, ''); log += s; if (onData) onData(s); };
    const timer = timeoutMs ? setTimeout(() => { take('\n[build timed out]\n'); p.kill(); }, timeoutMs) : undefined;
    p.stdout.on('data', take);
    p.stderr.on('data', take);
    p.on('error', (e) => { clearTimeout(timer); take(`Failed to start ${cmd}: ${e.message}\n`); resolve({ ok: false, log }); });
    p.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, log }); });
  });
}

module.exports = { runTool, toWslPath, usingWsl, cfg };
