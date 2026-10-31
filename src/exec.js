const vscode = require('vscode');
const cp = require('child_process');

const cfg = () => vscode.workspace.getConfiguration('latexEditor');

const { toWslPath } = require('./paths');

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
    // A runaway document can print gigabytes. Keep the start (where errors are), a short tail (where latexmk
    // summarises), and stream only the first part to the output channel, so memory and the UI stay bounded.
    const HEAD = 3 * 1024 * 1024, TAIL = 256 * 1024, LIVE = 1024 * 1024;
    let head = '', tail = '', total = 0, finished = false;
    const take = (d) => {
      const s = d.toString('utf8').replace(/\0/g, '');
      if (head.length < HEAD) head += s.slice(0, HEAD - head.length);
      tail = (tail + s).slice(-TAIL);
      if (onData && total < LIVE) { onData(total + s.length > LIVE ? s.slice(0, LIVE - total) + '\n[output truncated]\n' : s); }
      total += s.length;
    };
    const text = () => {
      if (total <= HEAD) return head;
      if (total <= HEAD + TAIL) return head + tail.slice(-(total - HEAD));
      return head + '\n[… log truncated …]\n' + tail;
    };
    const finish = (ok) => { if (finished) return; finished = true; clearTimeout(timer); resolve({ ok, log: text() }); };
    const timer = timeoutMs ? setTimeout(() => {
      take('\n[build timed out]\n');
      try { p.kill(); } catch { /* already gone */ }
      setTimeout(() => finish(false), 3000);   // do not wait forever for a process that ignores the kill
    }, timeoutMs) : undefined;
    p.stdout.on('data', take);
    p.stderr.on('data', take);
    p.on('error', (e) => { take(`Failed to start ${cmd}: ${e.message}\n`); finish(false); });
    p.on('close', (code) => finish(code === 0));
  });
}

module.exports = { runTool, toWslPath, usingWsl, cfg };
