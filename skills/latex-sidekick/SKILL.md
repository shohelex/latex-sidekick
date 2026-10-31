---
name: latex-sidekick
description: Build a LaTeX project, read its errors and warnings with plain-English hints, fix them, and set the project up for VS Code. Use when the user asks to compile or build a .tex paper, fix LaTeX errors or warnings (undefined control sequence, missing package, undefined reference or citation, BibTeX problems, overfull boxes), check that the TeX tools work, or prepare a folder for LaTeX Sidekick in VS Code. Works in any project, on Windows (through WSL), macOS and Linux.
---

# LaTeX Sidekick

This skill bundles a small command-line tool, `scripts/sidekick.js` (inside this skill's folder), that runs `latexmk`, reads the TeX and BibTeX logs, and prints every problem with its file, line, the offending source text and a hint. Run it with `node` from the project; no install step.

In the commands below, `SK` means this skill's folder, so the tool is `node SK/scripts/sidekick.js`.

## Build and fix

1. Find the main file (the one with `\documentclass`; for multi-file papers the file that `\input`s the others).
2. Build it:
   ```
   node SK/scripts/sidekick.js build path/to/main.tex
   ```
   Options: `--engine xelatex|lualatex`, `--outdir .latex-build`, `--timeout 120`, `--json` (machine-readable), `--all` (also list overfull/underfull box notes), `--native` (skip WSL on Windows).
3. Read the report. Each line is `ERROR|WARNING file:line message`, then `source:` (what LaTeX was reading) and `hint:`. Exit code: 0 clean, 1 problems in the document, 2 the setup is broken (see `SETUP PROBLEM`).
4. Fix errors first, then warnings. Make the smallest edit that fixes the problem and leave the rest of the text exactly as it is. Typical fixes:
   - *Undefined control sequence* with a known package: add `\usepackage{...}` after the last existing `\usepackage` (the hint names the package). Otherwise check the spelling.
   - *Undefined reference*: correct the `\label`/`\ref` name. *Undefined citation*: correct the key, or add the entry to the `.bib`.
   - *Missing `$`*, *Missing `}`*, *Runaway argument*: look at the lines just before the reported line, since the mistake is usually earlier.
   - An error inside a package or class (`via` in `--json`) is reported on the line of the document that triggered it. Fix your line, not the package.
5. Rebuild and repeat until the build is clean, or only warnings you can justify remain. Later errors are often side effects of the first one, so rebuild after each fix.

Never invent bibliography entries, labels, figure files or results. If a fix needs something only the author knows (a missing image, a reference that is not in the `.bib`), say what is missing and ask. Do not delete content just to make the build pass.

## If the build cannot start (exit code 2)

Run `node SK/scripts/sidekick.js doctor`. It lists which of `latexmk`, `pdflatex`, `synctex`, `bibtex` and `biber` are found. On Windows the tools run inside WSL; if they are missing, tell the user to run `sudo apt install latexmk texlive-latex-extra` in their WSL distro (or use `--native` with MiKTeX or TeX Live). Do not install system packages without asking.

## Edit this repo's LaTeX in VS Code

When the user wants to write or edit the LaTeX in VS Code (for example "set this repo up for LaTeX in VS Code", "open the paper in VS Code", "I want the side-by-side PDF"), run one command from the repo:
```
node SK/scripts/sidekick.js setup . --open
```
It does everything in order, and prints what it did:
1. finds the main `.tex` file (the one with `\documentclass`; `--main path/to/main.tex` to choose another when several exist);
2. installs the LaTeX Sidekick VS Code extension from the `.vsix` bundled with this skill, or updates it if the installed one is older (installed once for all repos);
3. adds `.latex-build/` to `.gitignore` and the main file to `.vscode/settings.json` (never overwrites a line that is already there; a settings file with comments is left alone and the lines to add are printed);
4. if the LaTeX Workshop extension is installed, turns off its build-on-save for this repo only, so two builds do not run on every save (it does not uninstall anything);
5. checks that `latexmk` is available, and says how to install it if not;
6. with `--open`, opens the repo and the paper in VS Code.

Tell the user to reload the VS Code window once if it was already open, then press `Ctrl+S` in the `.tex` file: the PDF appears beside it, errors show in the Problems panel, and the lightbulb offers fixes. Running `setup` is what the user asked for in this case, so no extra confirmation is needed; do not run it just because a repo contains `.tex` files. To only write the repo files without touching VS Code, use `init . --main main.tex` instead (add `--disable-workshop` if LaTeX Workshop is installed).

## Notes

- Build output goes to `.latex-build/` next to the main file; suggest adding it to `.gitignore`, and do not commit it.
- Do not submit or declare a manuscript ready from a clean build alone. A clean build only means it compiles.
