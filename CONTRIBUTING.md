# Contributing

Thanks for helping improve omni-mcp. This document covers local setup, commit messages, pull requests, and how releases are published.

Please also follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Prerequisites

- **Node.js 22.12** or later (`engines.node` is `>=22.12.0`)
- npm (comes with Node)

```bash
git clone https://github.com/RaviDasari/omni-mcp.git
cd omni-mcp
npm ci
npm --prefix web ci
```

Git hooks are installed via `husky` on `npm ci` / `npm install`. The `commit-msg` hook lint-checks Conventional Commits locally.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run lint` | Typecheck with `tsc --noEmit` |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run build` | Build the web UI, bundle with tsup, copy `dist/ui` |
| `npm run dev:ui` | Vite UI on port 5173 (proxies `/api` to the gateway) |
| `npm start` | Run the CLI `start` command from `dist` |

Do not bump `package.json` / `package-lock.json` version by hand. **semantic-release owns the version** on `main`.

## Commit messages

This repo uses [Conventional Commits](https://www.conventionalcommits.org/). Messages are linted locally (husky) and on pull requests (GitHub Actions).

Format:

```text
<type>(optional-scope): <subject>

[optional body]

[optional footer]
```

- Use an **imperative** subject (`add`, not `added` or `adds`)
- Do **not** end the subject with a period
- Keep the subject around 72 characters

### Types

| Type | Release | When to use |
|------|---------|-------------|
| `feat` | minor | A new user-facing capability |
| `fix` | patch | A bug fix |
| `perf` | patch | A performance improvement |
| `docs` | none | Documentation only |
| `style` | none | Formatting; no behavior change |
| `refactor` | none | Internal change that is not a fix or feature |
| `test` | none | Adding or correcting tests |
| `build` | none | Build tooling or dependencies |
| `ci` | none | CI configuration |
| `chore` | none | Maintenance that does not fit elsewhere |
| `revert` | depends | Reverts a previous commit |

Breaking changes: add `BREAKING CHANGE:` in the footer, or use a `!` after the type (`feat!: ...`). That becomes a **major** release (`1.0.0` if you are still on `0.x`).

### Examples

```text
feat: add reload command for hot-swapping profiles
fix: isolate crashed stdio servers from the gateway
docs: document Conventional Commits in CONTRIBUTING
feat!: require Node 22 for the CLI
```

```text
feat: support JWT tokens at the proxy layer

BREAKING CHANGE: token files must use the new schema under `auth.tokens`.
```

Merge commits from GitHub (`Merge pull request #…`) are fine on `main`; feature-branch commits should follow the table above so the next release notes stay accurate.

## Pull requests

1. Branch from `main`.
2. Keep the change focused; include tests when behavior changes.
3. Run `npm run lint`, `npm run lint:web`, `npm test`, and `npm run build` before you push.
4. Fill in the pull request template.
5. Wait for the **CI** workflow (root typecheck/tests, Web lint, build, and commitlint on the PR
   range).

## Releases

On every push to `main`, the **Release** workflow runs tests and then **semantic-release**:

- Analyzes Conventional Commits since the last git tag
- Runs the release verification gate, then bumps the version, updates `CHANGELOG.md`, and publishes
  the packed npm artifact with provenance
- Creates a GitHub Release and commits version files with `chore(release): x.y.z [skip ci]`

If there are no `feat` / `fix` / `perf` / breaking commits, nothing is published.

Repo secret required for npm: **`NPM_TOKEN`**.
