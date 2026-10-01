<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
at specs/090-volunteer-frame/plan.md
<!-- SPECKIT END -->

## Development conventions

- **Markdown is owned by markdownlint, never prettier.** `*.md` is in `.prettierignore` (one owner
  per file type — see the reasoning there), so `prettier --check some.md` reports success because
  the file was **skipped**, not because it is clean. That false pass is the trap; do not use it as a
  gate.

  **While editing, do not lint by hand.** A project hook (`.claude/settings.json`, PostToolUse on
  Write|Edit) runs `markdownlint-cli2 --fix` on every `.md` written with Write or Edit. So edit
  Markdown with those tools, not with scripts in Bash, which the hook does not see.

  **Check once, just before each commit** (not after each edit): run `pnpm lint:md`, and check that
  no prose line in the `.md` files the commit changes is longer than 100 characters. Count
  characters, not bytes: an em dash is one character.

  `--fix` repairs nearly everything on its own — emphasis/bullet-marker consistency (MD049/MD004,
  resolved *per file* from the first marker used, so a file may not mix `_` and `*`), blank lines
  around headings, lists and fences, trailing whitespace, blank-line runs, and the final newline.
  Only two rules it cannot fix, so write these correctly the first time:
  - **MD040** — every fenced code block needs a language (` ```bash `, ` ```sql `, ` ```text ` for
    plain output).
  - **MD036** — a bold-only line is not a heading; use a real `###` heading, or fold the bold text
    into a sentence.

  Two house conventions the linter does not enforce: wrap prose at **100 columns** (MD013 is off
  only because SpecKit task lines and wide tables must not wrap — prose still wraps), and write
  **compact** table pipes `|---|---|` (MD060 is off for this reason).

- **Route index**: `src/app/dev/routes/page.tsx` lists every UI page and API endpoint. As of feature
  016 it is **generated from the source tree** (`src/server/lib/routeInventory.ts`, shared with
  `auth.routeInventory.test.ts`) and shown only to a Super-user. There is **nothing to
  hand-maintain** — a new route appears automatically. *(The previous convention to keep two arrays
  in sync was retired here.)*
