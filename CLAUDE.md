# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Structure

This is a Turborepo monorepo containing:
- **apps/app**: Next.js 16 application with App Router, React 19, TypeScript, and Tailwind CSS 4

## Package Manager

This project uses **pnpm** (v10.14.0) as specified in `package.json`. Always use `pnpm` for package management operations.

## Development Commands

### Running the Dev Server
```bash
# From apps/app directory
pnpm dev

# Or from root using turbo
turbo dev
```

The Next.js app runs on http://localhost:3000

### Building
```bash
# From root - builds all apps with dependency awareness
turbo build

# From apps/app directory - builds just the app
pnpm build
```

### Type Checking
```bash
# From root
turbo check-types
```

## Tech Stack

### apps/app
- **Next.js 16** with App Router
- **React 19**
- **TypeScript 5**
- **Tailwind CSS 4** with PostCSS
- **shadcn/ui** components (New York style, with CSS variables)
  - Base color: neutral
  - Icon library: lucide-react
  - Path aliases: `@/components`, `@/lib/utils`, `@/components/ui`, `@/lib`, `@/hooks`
- **Fonts**: Geist Sans and Geist Mono via `next/font`

## Architecture Notes

- This is an App Router application - all routes are in `apps/app/app/` directory
- shadcn/ui components live in `apps/app/components/ui/`
- Utility functions use `apps/app/lib/utils.ts` with clsx and tailwind-merge
- Tailwind CSS 4 configuration via PostCSS (no tailwind.config.js)
- Global styles in `apps/app/app/globals.css`
- **Next.js 16 uses `proxy.ts` instead of `middleware.ts`** - This is the new convention for middleware in Next.js 16

## Turborepo Configuration

The monorepo uses Turborepo with these task pipelines:
- **build**: Depends on upstream builds, outputs to `.next/**` (excluding cache)
- **check-types**: Depends on upstream type checking
- **dev**: Persistent task with no caching

## Convex Authentication Pattern

**IMPORTANT**: When writing Convex mutations and queries, ALWAYS extract `userId` and `orgId` from the Clerk JWT token using `ctx.auth.getUserIdentity()` rather than accepting them as function arguments.

### Correct Pattern:
```typescript
export const myMutation = mutation({
  args: {
    siteId: v.id("sites"),
    // DO NOT include userId or orgId in args
  },
  handler: async (ctx, { siteId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const userId = identity.subject;
    const orgId = identity.org_id;

    if (!orgId) throw new Error("No active organization");

    // Use userId and orgId from token
  },
});
```

### Why This Is More Secure:
- **Prevents impersonation**: Clients cannot forge userId/orgId values
- **Token-based authentication**: Values come from cryptographically verified JWT
- **Single source of truth**: Authentication state managed by Clerk
- **Automatic verification**: Convex validates the JWT before function execution

Never accept `userId` or `orgId` as function arguments unless there's a specific admin use case that requires it.

## Sandbox Worker Architecture

The application uses a sandboxed worker system to run Claude Agent SDK code in isolated Daytona environments. This architecture enables secure execution of AI agents with Convex backend integration.

### Overview

1. **packages/sandbox**: Contains the worker code that runs in Daytona sandboxes
2. **packages/convex/sandbox.ts**: Convex action that creates and manages sandboxes
3. **packages/convex/lib/daytona.ts**: Daytona SDK integration utilities
4. **packages/convex/lib/workerBundle.ts**: Auto-generated bundled worker code

### How It Works

#### 1. Build Process

```bash
# In packages/sandbox
pnpm build
```

This command:
- Bundles `src/index.ts` into `dist/worker.js` using Bun
- Runs `scripts/copy-to-convex.ts` which:
  - Reads `dist/worker.js`
  - Escapes it as a template literal
  - Generates `packages/convex/lib/workerBundle.ts` with a `getWorkerSource()` function
  - This allows Convex to bundle the worker code at deploy time

#### 2. Sandbox Creation Flow

When `startSandbox` is called (from `packages/convex/sandbox.ts`):

1. **Generates Clerk session token** for the worker to authenticate with Convex
2. **Builds Daytona image** with Node.js 22 and Claude Code CLI installed via official install script
3. **Creates sandbox** with environment variables:
   - `CONVEX_URL`: Convex deployment URL
   - `SITE_ID`: ID of the site this sandbox is for
   - `CLERK_TOKEN`: Time-limited JWT for authentication
4. **Uploads worker** by calling `getWorkerSource()` and uploading to `/home/landing/project/worker.js`
   - Worker is a **single bundled file** with all dependencies (including Anthropic SDKs) included
   - No node_modules dependencies - survives `npm install` runs in the project
5. **Starts worker** by executing `node /home/landing/project/worker.js`

#### 3. Worker Runtime (packages/sandbox/src/index.ts)

The worker:
- Connects to Convex using the provided `CONVEX_URL` and authenticates with `CLERK_TOKEN`
- Subscribes to new user messages for the site via `api.messages.getLatestUserMessage`
- Streams messages to Claude Agent SDK using the `query()` function
- Writes assistant responses back to Convex in real-time using `api.messages.upsertMessage`
- Maintains session state to resume conversations across restarts

### Key Implementation Details

**Static vs Dynamic Imports**: The worker bundle MUST be imported statically in `sandbox.ts`:
```typescript
import { getWorkerSource } from "./lib/workerBundle";
```

NOT dynamically:
```typescript
// ❌ This fails in Convex's bundler
const { getWorkerSource } = await import("./lib/workerBundle");
```

**Worker Bundle Size**: The worker bundle includes all dependencies (Convex client, Anthropic Agent SDK, etc.) to ensure it can run without any node_modules dependencies. This makes the worker resilient to `npm install` operations in the project directory.

**Token Expiration**: Clerk tokens are generated with a 1-hour lifetime. The worker validates token expiration on startup and exits if the token is expired or expiring soon (<5 minutes).

### Building the Worker

The worker must be rebuilt whenever changes are made to `packages/sandbox/src/index.ts`:

```bash
# From packages/sandbox
pnpm build

# Or from root (builds all packages)
turbo build
```

The build artifacts in `packages/sandbox/dist/` are gitignored and should not be committed.
