# agents.md

This file defines **how AI agents must work in this repository**.\
It is binding. When in doubt, choose the most conservative option and change less, not more.

---

## Core Principles

- **Minimal diffs only**\
  Small, focused changes. No broad refactors unless explicitly requested.

- **Vanilla first**\
  Plain HTML, CSS, and JavaScript. No frameworks.

- **Pragmatic over clever**\
  No academic abstractions. No overengineering.

- **Consistency beats best practice**\
  Follow existing patterns in this repo over generic advice.

---

## Tech Stack Rules

- **JavaScript:** Vanilla JS only
  - ES Modules allowed and preferred where already used
    - Use `.js` file extensions.
    - Use relative paths only (`./`, `../`).
    - Do not use bare module specifiers.
- **No TypeScript**
- **No new dependencies**
  - No npm packages
  - No bundlers
  - No build steps
- **JSON as data**
  - May be imported via `import ... with { type: "json" }` if already used in the project

---

## Code Style

- **Indentation:** 4 spaces
- **Quotes:** Use double quotes "..." in JavaScript and HTML attributes.
  - Use template strings `` `...${x}...` `` for interpolation.
- **Semicolons:** Always use semicolons. Do not rely on ASI.
  - Do not rely on ASI in edge cases (e.g. return statements, IIFEs).
- **Braces:** Always use `{}` for `if / else / for / while`, even for single-line blocks
- **Naming**
  - JavaScript: `camelCase`
  - CSS classes: `kebab-case`
  - IDs: follow existing project style (often `camelCase`)
- **Equality**
  - Use strict equality only: `===` and `!==`.
- **Declarations**
  - Prefer `const`. Use `let` only when reassignment is required. Never use `var`.
- **Functions**
  - Use classic `function name() {}` for primary, named, higher-level logic (core game logic,
    exported/public entry points, longer functions).
  - Use arrow functions for callbacks and small/local helpers.
  - Do not refactor between `function` and arrows without a clear reason.
  - Arrow functions are the preferred form for event listener callbacks, unless the handler is
    reused or grows significantly.
- **Comments**
  - English only
  - Use sparingly and intentionally
  - Prefer explaining **why**, not **what**
  - Do not comment obvious code
  - Use comments to mark logical sections or explain non-obvious decisions
  - Remove outdated comments
- If a project defines formatting or linting via tooling (e.g. `deno.json`), those rules are
  authoritative and override any generic style guidelines in this file.
- Always inspect existing config files before assuming defaults.
- **Commit messages:** English only

---

## Preferred File Structure

Files are typically structured top-to-bottom in a readable, intentional order. Follow existing files
as reference and prefer this structure unless there is a clear reason not to.

Typical order:

1. **Imports**\
   All static imports at the top of the file.

2. **Constants and global state**\
   Configuration values and shared state used across functions.\
   No logic here.

3. **DOM references (if applicable)**\
   Collected in one place, not scattered throughout the file.

4. **Function blocks grouped by responsibility**\
   Functions are grouped by logical domain, not by visibility or call order.\
   Typical groups include:
   - Data / parsing / mapping
   - Core logic (e.g. game logic)
   - UI rendering
   - Event handling
   - Helpers

5. **Initialization function**\
   A clearly named `init()` (or equivalent) that wires everything together.

6. **Explicit start**\
   The entry point is called explicitly at the bottom of the file.

7. **Optional global debug object**\
   If used, a single intentional object on `globalThis` for debugging or inspection.

Avoid:

- Executing logic at top level outside of `init()`
- Mixing DOM access, state mutation, and startup logic
- Implicit or hidden entry points

---

## HTML Conventions

- Prefer semantic elements (`header`, `main`, `section`, `aside`, `footer`)
- No unnecessary wrapper elements
- Interactive elements:
  - Use `<button>` when appropriate
  - Otherwise follow existing project patterns
- Use `data-*` attributes only when they serve a real purpose (state, keys, templates)
- Use `<template>` for reusable or non-trivial DOM structures.
- Prefer `<template>` when:
  - The markup contains multiple nested elements.
  - The structure is rendered in a loop or reused.
  - There are multiple dynamic fields or states.
  - Event listeners or querying of child elements is required.
- `innerHTML` is acceptable only for small, fully controlled, static snippets.
- Do not build complex markup via string-based `innerHTML`.

---

## CSS Conventions

- Prefer **CSS custom properties** for colors, spacing, shadows, timing
- Respect `prefers-color-scheme` when present
- **Scoped selectors over prefix inflation**
  - Prefer `#container .item` over BEM-style prefixes like `block__element`
  - Do not introduce BEM or verbose naming schemes
- Do not rename existing classes or IDs without a strong reason
- Avoid cosmetic-only cleanups

---

## DOM & Events

- Collect DOM references near the top of the file
- Do not register duplicate event listeners
- If the project uses `AbortController` for listeners, follow that pattern
- Avoid new global side effects
- If globals are required, follow existing usage (`globalThis.*`)

---

## State & Persistence

- Use `localStorage` conservatively
- Respect existing key prefixes, formats, and TTL logic
- Do not introduce breaking changes to stored state
- Do not silently migrate or invalidate user data

---

## Networking & Fetch

- Handle `fetch` defensively:
  - Check `res.ok`
  - Handle failures gracefully
- Abort / timeout logic only if already established in the project
- Do not add new endpoints unless explicitly requested
- Respect existing CORS and `keepalive` patterns

---

## Browser Support

- Target modern evergreen browsers (Chrome, Edge, Firefox, Safari incl. iOS).
- No legacy or IE support.
- The following features are allowed:
  - Optional chaining (`?.`)
  - Nullish coalescing (`??`)
  - `Array.prototype.at()`
  - `structuredClone()`
  - `AbortController`
  - ES Modules
- Do not introduce polyfills or transpilation.

---

## Baseline Policy for Web Platform Features

- Only use web platform features that are considered **baseline** and widely supported in modern
  browsers, including iOS Safari.
- If you are not sure whether a feature is baseline, **do not use it**.
- Prefer well-established APIs over newer convenience features.
- Do not introduce polyfills, transpilation, or compatibility layers.
- When in doubt, choose the simpler, more conservative solution.

---

## Accessibility (Intentional Scope)

- These projects are primarily visual and interactive games.
- Screenreader-only usage is **not a supported use case**.
- Do **not** add ARIA roles, `aria-*` attributes, or accessibility abstractions by default.
- Do not introduce `aria-live`, role mappings, or hidden helper text unless explicitly requested.

Allowed and expected:

- Reasonable keyboard interaction where interaction already exists.
- Focus handling only when it solves a concrete UX problem.

Accessibility should be **pragmatic, not performative**.

---

## Error Handling

- Use `try/catch` where failure is expected (fetch, JSON parsing, storage).
- `console.warn` and `console.error` are allowed.
- Do not silently swallow errors without at least logging them.
- User-facing feedback (modal, toast, message) only when it meaningfully improves UX.
- Do not introduce global error handlers without explicit instruction.

---

## Security

- Prefer `textContent` over `innerHTML`.
- Use `innerHTML` only with fully controlled, static templates.
- Never inject unescaped user input into HTML.
- Avoid dynamic script or style injection.

---

## Analytics (Important)

- **Single, consolidated event**
  - Prefer one analytics event at game end
  - Do not scatter multiple micro-events
- **Event consistency**
  - Keep event name and payload shape consistent with existing calls
- Keep `umami.track` calls consistent with existing usage.
- Defensive usage only:
  ```js
  globalThis.umami?.track("EventName", { ... });
  ```
- Do not add analytics unless the project already uses them.

---

## Service Workers (Very Conservative)

- Do not modify SW logic unless explicitly requested.
- Respect:
  - Versioning
  - Cache prefixes
  - Scope detection (GitHub Pages vs custom domain vs localhost)
- Never experiment with SW behavior.
- Do not enable SWs in environments explicitly excluded by the project.

---

## UI Text & Copy

- Do not rewrite or “improve” UI text unless explicitly asked.
- Respect the project language (German vs English).
- Avoid tone changes, marketing language, or stylistic rewrites.

---

## Working Style

When making changes, always provide:

1. What & why (short and technical)
2. Directly applicable code blocks (copy & paste ready)
3. Risk note
   - Mention possible side effects if relevant

- Prefer code-first answers. Explanations should be concise and technical.
- Validate data only at clear module/API boundaries; avoid redundant guards inside controlled flows
  unless a concrete failure mode exists.
- For data generated and consumed within the same module or lifecycle, trust the structure and do
  not add fallbacks or extra type checks.

---

## Testing Expectations

- If a reproducible scenario exists: describe it.
- If no test setup exists: provide a short manual checklist (max 5 items).
- Never claim tests were run if they were not.

---

## Environment Assumptions

- Development is typically done via:
  - VS Code
  - Local static server (e.g. `http://127.0.0.1:5500`)
- Deployment targets:
  - GitHub Pages
  - Sometimes custom domains
- Do not assume Node.js scripts, CLIs, or build pipelines.

---

## Deno Usage

- Deno is used **only** for server-side or edge code (e.g. APIs, endpoints, KV-backed logic).
- Client-side code runs in the browser and must use Web Platform APIs only.
- Do not use Node.js-specific APIs (`fs`, `path`, `process`, etc.).
- Do not mix browser code and Deno-specific code in the same file.
- Follow the existing project structure to determine whether a file targets browser or Deno.
- Server-side endpoints are deployed via **Deno Deploy**.
- Cloud functions live inside the GitHub Pages repository.
- Endpoints are typically implemented in a single entry file (e.g. `api/main.js`), which Deno Deploy
  uses to build and expose the API routes.
- Follow the existing API file structure instead of introducing multiple entry points.

---

## Asset Handling

- Assets (images, SVGs, fonts) are stored locally in the repository.
- Use relative paths for all asset references.
- Do not hotlink external images or SVGs.
- SVGs may be used inline or via `<img>`, following existing project patterns.
- Do not introduce build-time asset processing or optimization steps.

---

## Git Workflow (Scope)

- Prefer small, focused changes per commit.
- Avoid unrelated changes in the same commit.
- Do not reformat or restructure files unless explicitly requested.
- Branching strategies, pull requests, and release workflows are out of scope for this file.

---

## What You Must Not Do

- No TypeScript
- No React, Vue, Svelte, etc.
- No bundlers, linters, formatters, or new toolchains
- No large refactors without explicit approval
- No stylistic cleanups “because it looks nicer”

---

## Conflict Resolution

If this file conflicts with existing project code:

- The existing codebase wins.
- Follow the current repository’s patterns, not external best practices.

This file is intentional. Treat it as a contract.
