# LaTeX Sidekick

A VS Code extension for writing LaTeX papers the way Overleaf and Prism do, but on your own machine.
Press `Ctrl+S` and it builds with `latexmk` (inside WSL on Windows, or natively on Linux/macOS) and shows the PDF beside your source.

> **Status: early (v0.3).** It is young software and not yet widely tested. Please report anything that breaks.

## Features

- **Build on save** with `latexmk` (pdflatex, xelatex or lualatex). Progress and a "build complete" message appear when it finishes; errors show up in the Problems panel on the right line.
- **Side-by-side PDF preview** that fits the width of its pane by default, so it re-fits when you split or resize the window (zoom with +/- to set your own size, or press Fit width to go back). It keeps your scroll position between builds. Source text wraps at the width of its own pane too, so splitting the editor re-wraps it.
- **Click to jump (SyncTeX):** double-click the PDF to open the matching source line; `Ctrl+Alt+J` highlights the current source line in the PDF.
- **Citations:** search your `.bib` files (`Ctrl+Alt+C`), `\cite{` and `\ref{` autocomplete, hover to see a reference, and "Add Reference by DOI" (fetches BibTeX from doi.org).
- **Smart indentation:** Enter after `\begin{â€¦}` indents, `\end{â€¦}` moves back out, and Enter between them opens an indented line. Two-space indents.
- **Fast, lazy preview:** only the pages near your view are drawn, so long papers open instantly. `Ctrl+Alt+V` shows the last PDF at once and refreshes it after a rebuild.
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
code --install-extension latex-sidekick-0.3.5.vsix
```

Then reload VS Code. In VS Code you can also use Extensions â†’ `â€¦` â†’ **Install from VSIXâ€¦** and pick the `.vsix` file.

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

- **Problems panel and editor squiggles:** errors (red), warnings (yellow) and typesetting notes such as overfull boxes (blue), on the right file and line. Each comes with a short plain-English hint where one is known (undefined command, missing package, unmatched brace, undefined reference or citation, â€¦).
- **Issues list in the preview:** click **Issues** above the PDF to see them all, errors first. Click an item to jump to the source line. **Log** opens the full build log.
- **Status bar:** shows the counts, for example `2 errors, 5 warnings`. Click it to build again.

### Fixing problems

Each problem has a lightbulb (`Ctrl+.`) on its squiggle, and a **Fix with AI** button in the Issues list. Fixes that need no AI come first:

- **Add `\usepackage{â€¦}`** when a command or environment comes from a known package (`\includegraphics`, `\textcolor`, `\toprule`, `align`, `tabularx`, â€¦). Already-loaded packages are not added twice.
- **Change a misspelled `\ref` or `\cite` key** to the closest label or `.bib` key in your project, or **add a reference by DOI**.
- **Fix with Claude, no API key needed:** with no key set, the fix offers **Use my free Claude.ai account**. It copies a ready-made prompt and opens [claude.ai](https://claude.ai) (sign in, or create a free account). Paste the prompt, click the copy button on Claude's answer, then choose **Apply Claude's answer** (or run *LaTeX Editor: Apply Claude's Answer from Clipboard*). If Claude answers with plain code instead of the requested format, copy that code block and run the apply command; it is used as the replacement. You always review the diff first, and text that is not a plausible fix (part of the prompt, prose with no LaTeX) is refused, while a replacement that changes the number of lines a lot needs a second confirmation. Nothing is sent until you paste it yourself. (A claude.ai login cannot be used directly by an extension, which is why this is copy and paste.)
- **Fix with Claude, automatic** (needs an Anthropic API key from console.anthropic.com): sends the message and the source lines around it, shows the proposed change as a side-by-side diff, and applies it only when you click **Apply fix** (one undo step). If a fix needs something only you know (a missing file or bibliography entry), Claude explains instead of guessing. The failed-build notification also offers **Fix with AI** for the first error, and *LaTeX Editor: Fix First Build Problem with AI* is in the Command Palette.

What is recognised: LaTeX errors (undefined commands and environments, missing `$`, unbalanced braces, mismatched `\begin`/`\end`, missing files and images, Unicode characters, table and math mistakes, option clashes, and about 40 more), package and class errors (shown on *your* line, not inside the `.sty`), warnings (undefined references and citations, duplicate labels, missing characters, font substitutions, pdfTeX warnings), BibTeX and Biber problems (missing entries, syntax errors in the `.bib`, shown on the `.bib` line), overfull/underfull boxes, and setup problems (WSL, `latexmk`, `bibtex`/`biber` missing, main file not found, timeouts, no write permission).

When a build fails, the preview keeps showing the last good PDF with a "Build failed" banner instead of going blank. Setup problems (WSL not installed, `latexmk` not found, a build that runs past `latexEditor.buildTimeoutSeconds`) get their own message with the fix and an **Open settings** button.

## When something goes wrong

Errors never leave the extension stuck or change your files behind your back:

- A build that fails inside the extension, or runs away (an infinite loop printing gigabytes), is stopped and reported; the next save builds normally. Logs and problem lists are size-capped.
- If the AI service fails (bad key, no internet, out of credit, timeout after 90 s, nonsense reply), your file is untouched and the message offers the free Claude.ai route.
- A fix is only applied after you approve the diff; a fix that deletes most of the text needs a second confirmation, and text that is not a plausible fix is refused. After applying, **Undo** is one click (or Ctrl+Z).

## Troubleshooting

| Symptom | Fix |
|---|---|
| "WSL is not available" | Run `wsl --install`, or set `latexEditor.useWSL` to `false` |
| "latexmk was not found" | Install it (see step 1), then build again |
| `File 'xxx.sty' not found` | `sudo apt install texlive-latex-extra`, or `tlmgr install xxx` |
| Preview is blank | Open View â†’ Output â†’ **LaTeX Editor** and look for a `[preview]` line |
| Two builds run on save | Turn off LaTeX Workshop's auto build (see above) |
| Build never ends | Raise or lower `latexEditor.buildTimeoutSeconds`; check for an infinite loop |

## Multi-file papers

Set `latexEditor.mainFile` to your root file, or put `%!TEX root = main.tex` at the top of each chapter file.

## Privacy

Nothing leaves your machine except two things, and only when you ask:

- **Fix with AI (API key mode):** the build message, the source lines around the reported line (`latexEditor.ai.fixContextLines`, 12 each side by default) and your preamble's `\usepackage`/`\newcommand` lines are sent to the Anthropic API. Nothing is changed until you approve the diff. In claude.ai mode nothing is sent by the extension at all; you paste the prompt yourself.
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
| `latexEditor.ai.model` | `claude-sonnet-5-5` | Model for the writing assistant and Fix with AI |
| `latexEditor.ai.fixContextLines` | `12` | Source lines sent either side of the problem for Fix with AI |

## Development

```
npm test             # unit tests for the parsers (fast)
npm run test:vscode  # opens a real VS Code in a temporary profile: builds a paper, renders the preview, checks errors, quick fixes and Fix with AI
```

The Fix with AI test talks to a small local mock of the API (`LATEX_SIDEKICK_API_URL` and `LATEX_SIDEKICK_API_KEY` environment variables; the endpoint cannot be changed from a workspace setting). Set `IEEE_PAPER_DIR` to a folder with an IEEEtran paper (`main.tex`, `IEEEtran.cls`, a `.bib`) to also build it as part of the run.

## License

Apache-2.0. See [LICENSE](LICENSE).
