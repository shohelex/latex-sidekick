// Pure path helper shared by the extension and the command-line tool (no VS Code API).

/** C:\foo\bar -> /mnt/c/foo/bar (for WSL); other paths just get forward slashes. */
function toWslPath(p) {
  const m = /^([a-zA-Z]):[\\/](.*)$/.exec(p);
  return m ? `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : p.replace(/\\/g, '/');
}

module.exports = { toWslPath };
