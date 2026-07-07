# GoLand Exact Theme

A VS Code theme and lightweight companion extension tuned to make the editor feel closer to dark GoLand, especially for Go projects.

## Goals

- Match GoLand dark window surfaces and contrast
- Match project/sidebar colors and selection behavior
- Match Go syntax colors more closely for keywords, strings, functions, types, and comments
- Add a few Go-specific editor affordances that stock VS Code themes cannot provide on their own

## What This Includes

- `GoLand Exact Dark`: the color theme
- `GoLand Exact Icons`: the icon theme
- A small extension layer that adds:
  - Go-aware coloring adjustments for some symbols that are hard to express with theme scopes alone
  - clickable inline implementation hints for interface methods
  - a Reveal Active File button in the Explorer title bar

## Scope

This project is intentionally optimized for Go-first workflows.

- The UI palette is generic and works for any language.
- The extra editor behavior and symbol coloring are primarily designed for Go files.
- The extension uses heuristics, not a full Go parser, so small differences from GoLand can still exist.

## Installation

### Local

1. Symlink or copy this folder into your VS Code extensions directory.
2. Reload the editor window.
3. Select `GoLand Exact Dark` from the theme picker.
4. Select `GoLand Exact Icons` from the file icon theme picker if it is not already active.

### VSIX

1. Run:

```bash
npm run validate
npx @vscode/vsce package
```

2. Install the generated `.vsix` file in VS Code.

## Development

```bash
npm run validate
```

## Repository

- Source: `https://github.com/sagaryadaviitk/goland-exact-theme`
- Issues: `https://github.com/sagaryadaviitk/goland-exact-theme/issues`

## Notes

- File icons are separate from the color theme.
- Some visual differences will always remain because VS Code and GoLand render UI and semantic language data differently.
- Implementation hints depend on your Go language tooling returning implementation locations.
- Before publishing publicly, set `repository`, `homepage`, and `bugs` fields in `package.json` to your real project URLs.
