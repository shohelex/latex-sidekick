# LaTeX Sidekick

A VS Code extension for writing LaTeX papers the way Overleaf and Prism do, but on your own machine.
Press `Ctrl+S` and it builds with `latexmk` (inside WSL on Windows, or natively on Linux/macOS) and shows the PDF beside your source.

> **Status: early (v0.2).** It is young software and not yet widely tested. Please report anything that breaks.

## Features

- **Build on save** with `latexmk` (pdflatex, xelatex or lualatex). Progress and a "build complete" message appear when it finishes; errors show up in the Problems panel on the right line.
- **Side-by-side PDF preview** with zoom and fit-width. It keeps your scroll position between builds.
- **Click to jump (SyncTeX):** double-click the PDF to open the matching source line; `Ctrl+Alt+J` highlights the current source line in the PDF.
- **Citations:** search your `.bib` files (`Ctrl+Alt+C`), `\cite{` and `\ref{` autocomplete, hover to see a reference, and "Add Reference by DOI" (fetches BibTeX from doi.org).
- **Word wrap on by default** for `.tex` files, so long lines flow onto the next line like in Overleaf (turn it off with `"[latex]": { "editor.wordWrap": "off" }` in your settings).
- **Outline, word count, snippets,** an insert menu for symbols and environments, and `Ctrl+B` / `Ctrl+I` for bold and italic.
- **Optional Claude writing assistant** (`Ctrl+Alt+I`): rewrite, shorten or fix the selected text. Undo restores the original.

## Requirements

- VS Code 1.80 or newer.
- A TeX installation with `latexmk` and `synctex`. On Windows the default is WSL: `sudo apt install latexmk texlive-latex-extra` inside your distro. To use a native Windows TeX instead, set `latexEditor.useWSL` to `false`.

## Installation guide

### 1. Install a TeX toolchain

**Windows (recommended: WSL)**

1. Open PowerShell as administrator and run `wsl --install`, then restart and finish creating your Linux user.
2. In the Ubuntu terminal:
   ```
   sudo apt update
   sudo apt install latexmk texlive-latex-extra texlive-fonts-recommended texlive-science
   ```
   `texlive-full` also works if you have the disk space (about 5 GB).
3. Check it: `latexmk -v` and `synctex help` should both print a version.

**Windows without WSL:** install [MiKTeX](https://miktex.org) or [TeX Live](https://tug.org/texlive/), make sure `latexmk` and `synctex` are on your `PATH`, and set `latexEditor.useWSL` to `false`.

**macOS:** install [MacTeX](https://tug.org/mactex/) (or `brew install --cask basictex`, then `sudo tlmgr install latexmk`).

**Linux:** `sudo apt install latexmk texlive-latex-extra` (or your distro's equivalent).

### 2. Install the extension

You need [Node.js](https://nodejs.org) 18 or newer to build it.

```
git clone https://github.com/shohelex/latex-sidekick.git
cd latex-sidekick
npm install
npx @vscode/vsce package
code --install-extension latex-sidekick-0.2.0.vsix
```

Then reload VS Code. In VS Code you can also use Extensions → `…` → **Install from VSIX…** and pick the `.vsix` file.

### 3. First use

1. Open a folder containing a `.tex` file.
2. Press `Ctrl+S`. The extension builds the file and opens the PDF beside it.
3. Double-click the PDF to jump to the source line.

If the first build fails, the message will say whether the problem is the setup (WSL or `latexmk` missing) or your document. See [Troubleshooting](#troubleshooting).

### Try it from source

Open this folder in VS Code and press `F5`. A test window opens on `sample/`. Run `npm test` for the unit tests.

### Using it next to other LaTeX extensions

If LaTeX Workshop is installed, turn off its build-on-save (`latex-workshop.latex.autoBuild.run: never`) so the two don't both compile. If VS Code warns that LaTeX Workshop clashes with `vscode-pdf`, disable one of them; Sidekick does not need either.

### Uninstall

`code --uninstall-extension local.latex-sidekick`

## Errors and warnings

Every build reads the LaTeX log and reports problems three ways:

- **Problems panel and editor squiggles:** errors (red), warnings (yellow) and typesetting notes such as overfull boxes (blue), on the right file and line. Each comes with a short plain-English hint where one is known (undefined command, missing package, unmatched brace, undefined reference or citation, …).
- **Issues list in the preview:** click **Issues** above the PDF to see them all, errors first. Click an item to jump to the source line. **Log** opens the full build log.
- **Status bar:** shows the counts, for example `2 errors, 5 warnings`. Click it to build again.

When a build fails, the preview keeps showing the last good PDF with a "Build failed" banner instead of going blank. Setup problems (WSL not installed, `latexmk` not found, a build that runs past `latexEditor.buildTimeoutSeconds`) get their own message with the fix and an **Open settings** button.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "WSL is not available" | Run `wsl --install`, or set `latexEditor.useWSL` to `false` |
| "latexmk was not found" | Install it (see step 1), then build again |
| `File 'xxx.sty' not found` | `sudo apt install texlive-latex-extra`, or `tlmgr install xxx` |
| Preview is blank | Open View → Output → **LaTeX Editor** and look for a `[preview]` line |
| Two builds run on save | Turn off LaTeX Workshop's auto build (see above) |
| Build never ends | Raise or lower `latexEditor.buildTimeoutSeconds`; check for an infinite loop |

## Multi-file papers

Set `latexEditor.mainFile` to your root file, or put `%!TEX root = main.tex` at the top of each chapter file.

## Privacy

Nothing leaves your machine except two things, and only when you ask:

- **Claude assistant:** the text you selected is sent to the Anthropic API. Your API key is kept in VS Code's encrypted secret storage, never in a file. Set it with "LaTeX Editor: Set Anthropic API Key".
- **Add Reference by DOI:** the DOI is sent to doi.org.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `latexEditor.useWSL` | `true` | Run `latexmk` and `synctex` in WSL (Windows only) |
| `latexEditor.wslDistro` | empty | WSL distro; empty uses the default |
| `latexEditor.compileOnSave` | `true` | Build when you save |
| `latexEditor.autoOpenPreview` | `true` | Open the preview on first save |
| `latexEditor.mainFile` | empty | Root `.tex` file for multi-file papers |
| `latexEditor.engine` | `pdflatex` | `pdflatex`, `xelatex` or `lualatex` |
| `latexEditor.outDir` | `.latex-build` | Build output folder |
| `latexEditor.buildTimeoutSeconds` | `120` | Stop a build that runs longer than this |
| `latexEditor.showTypesettingNotes` | `true` | List overfull/underfull box notes as information |
| `latexEditor.ai.model` | `claude-sonnet-5-5` | Model for the writing assistant |

## Development

```
npm test      # unit tests for the parsers
```

## License

Apache-2.0. See [LICENSE](LICENSE).
