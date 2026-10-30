# LaTeX Sidekick

A VS Code extension for writing LaTeX papers the way Overleaf and Prism do, but on your own machine.
Press `Ctrl+S` and it builds with `latexmk` (inside WSL on Windows, or natively on Linux/macOS) and shows the PDF beside your source.

> **Status: early (v0.2).** It is young software and not yet widely tested. Please report anything that breaks.

## Features

- **Build on save** with `latexmk` (pdflatex, xelatex or lualatex). Progress and a "build complete" message appear when it finishes; errors show up in the Problems panel on the right line.
- **Side-by-side PDF preview** with zoom and fit-width. It keeps your scroll position between builds.
- **Click to jump (SyncTeX):** double-click the PDF to open the matching source line; `Ctrl+Alt+J` highlights the current source line in the PDF.
- **Citations:** search your `.bib` files (`Ctrl+Alt+C`), `\cite{` and `\ref{` autocomplete, hover to see a reference, and "Add Reference by DOI" (fetches BibTeX from doi.org).
- **Outline, word count, snippets,** an insert menu for symbols and environments, and `Ctrl+B` / `Ctrl+I` for bold and italic.
- **Optional Claude writing assistant** (`Ctrl+Alt+I`): rewrite, shorten or fix the selected text. Undo restores the original.

## Requirements

- VS Code 1.80 or newer.
- A TeX installation with `latexmk` and `synctex`. On Windows the default is WSL: `sudo apt install latexmk texlive-latex-extra` inside your distro. To use a native Windows TeX instead, set `latexEditor.useWSL` to `false`.

## Install

```
npm install
npx vsce package
code --install-extension latex-sidekick-0.2.0.vsix
```

To try it from source, open this folder in VS Code and press `F5`. A test window opens on `sample/`.

If you also have LaTeX Workshop installed, turn off its build-on-save (`latex-workshop.latex.autoBuild.run: never`) so the two don't both compile.

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
| `latexEditor.ai.model` | `claude-sonnet-5-5` | Model for the writing assistant |

## Development

```
npm test      # unit tests for the parsers
```

## License

Apache-2.0. See [LICENSE](LICENSE).
