# Repository Guidelines

## Project Structure & Module Organization
- `apps/app` hosts the Next.js App Router UI (`app/` for routes, `components/`, `lib/`, `public/` assets).
- `packages/convex` provides Convex backend functions plus shared auth helpers consumed by the app and sandbox.
- `packages/sandbox` contains Bun-based automation that bundles agent code into `dist/` and syncs it to Convex.
- Use workspace-local `node_modules/` within each package; cross-package imports rely on pnpm workspace aliases.

## Build, Test, and Development Commands
- `pnpm install` sets up the Turborepo workspace; run at the root after pulling changes.
- `pnpm dev` runs all `dev` tasks (Next app, Convex, sandbox) via Turbo for a full-stack playground.
- `pnpm --filter app build` compiles the Next.js app; `pnpm --filter app lint` runs ESLint.
- `pnpm --filter @repo/convex dev` starts the Convex local server; `pnpm --filter @repo/sandbox build` emits the worker bundle.

## Coding Style & Naming Conventions
- TypeScript is required; prefer named exports and React function components in PascalCase (`ConvexClientProvider`).
- Follow ESLint’s Next.js Core Web Vitals config (`pnpm --filter app lint`); fix warnings before merging.
- Tailwind CSS utility classes drive styling—group related classes logically and keep files formatted with the default two-space indent.
- Store shared utilities under `apps/app/lib` and colocate UI pieces under `apps/app/components/ui` for reuse.

## Testing Guidelines
- No automated test harness exists yet; pair manual verification with screenshots or recordings for UI work.
- When adding tests, colocate `*.test.ts[x]` beside the implementation and pick tooling consistent with Next.js (Vitest or Testing Library).
- Document any new test commands in package scripts and wire them into Turbo before submitting the PR.

## Commit & Pull Request Guidelines
- The repository has no commit history; use concise, imperative subject lines (e.g., `Add hero animation`) and explain “why” in the body when necessary.
- Keep PRs scoped to one feature or fix, include a summary, affected areas, and manual test notes.
- Link tracking issues and add before/after screenshots for visual updates; mention required environment variables for reviewers.

## Environment & Configuration
- Frontend expects `NEXT_PUBLIC_CONVEX_URL`; Convex and sandbox scripts rely on `CONVEX_URL`, `SITE_ID`, `CLERK_TOKEN`, `CLERK_SECRET_KEY`, and Daytona API keys.
- Store secrets in your local `.env` files; never commit them. Use the same variable names when configuring deployment targets.
