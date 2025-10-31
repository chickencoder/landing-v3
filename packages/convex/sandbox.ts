"use node";

import { internalAction, action } from "./_generated/server";
import { v } from "convex/values";
import { generateSessionToken } from "./lib/clerk";
import {
  buildSandboxImage,
  createSandbox,
  getWorkerLogs,
  stopSandboxInstance,
  startSandboxInstance,
} from "./lib/daytona";
import { internal } from "./_generated/api";

/**
 * Validate required environment variables
 */
function validateEnvironment() {
  const convexUrl = process.env.CONVEX_CLOUD_URL;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const workerUrl = process.env.WORKER_URL;

  if (!convexUrl || !anthropicApiKey || !workerUrl) {
    throw new Error(
      "Missing required environment variables: CONVEX_CLOUD_URL, ANTHROPIC_API_KEY, or WORKER_URL"
    );
  }

  return { convexUrl, anthropicApiKey };
}

export const startSandbox = internalAction({
  args: {
    siteId: v.id("sites"),
  },
  handler: async (ctx, { siteId }) => {
    console.log("[startSandbox] Starting", { siteId });

    try {
      // Load site and validate
      const site = await ctx.runQuery(internal.sites.getSiteById, { siteId });
      if (!site) throw new Error(`Site ${siteId} not found`);

      // Set status to creating
      await ctx.runMutation(internal.sites.updateSiteStatus, {
        siteId,
        status: "creating",
      });

      // Validate environment and generate auth token
      const { convexUrl, anthropicApiKey } = validateEnvironment();
      const clerkToken = await generateSessionToken(site.userId, site.orgId, 3600);

      // Build sandbox image configuration
      const image = buildSandboxImage();

      // Prepare environment variables for sandbox
      const envVars: Record<string, string> = {
        CONVEX_URL: convexUrl,
        SITE_ID: siteId,
        CLERK_TOKEN: clerkToken,
        ANTHROPIC_API_KEY: anthropicApiKey,
      };

      // Include session ID for resumption if available
      if (site.sessionId) {
        envVars.SESSION_ID = site.sessionId;
        console.log("[startSandbox] Including session ID for resumption");
      }

      // Create Daytona sandbox
      console.log("[startSandbox] Creating sandbox...");
      const sandbox = await createSandbox(image, envVars);

      // Store sandbox ID and get preview URL
      await ctx.runMutation(internal.sites.updateSandboxId, {
        siteId,
        sandboxId: sandbox.id,
      });

      const previewInfo = await sandbox.getPreviewLink(3000);
      await ctx.runMutation(internal.sites.updatePreviewUrl, {
        siteId,
        previewUrl: previewInfo.url,
      });

      // Mark as started (webhook will also update this when Daytona confirms)
      await ctx.runMutation(internal.sites.updateSiteStatus, {
        siteId,
        status: "started",
      });

      console.log("[startSandbox] Completed", {
        sandboxId: sandbox.id,
        previewUrl: previewInfo.url,
      });

      return {
        success: true,
        sandboxId: sandbox.id,
      };
    } catch (error) {
      console.error("[startSandbox] Failed", {
        error: error instanceof Error ? error.message : String(error),
      });

      await ctx.runMutation(internal.sites.updateSiteStatus, {
        siteId,
        status: "error",
      });

      throw error;
    }
  },
});

export const getWorkerProcessLogs = action({
  args: {
    siteId: v.id("sites"),
  },
  handler: async (ctx, { siteId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const site = await ctx.runQuery(internal.sites.getSiteById, { siteId });
    if (!site) {
      throw new Error(`Site ${siteId} not found`);
    }

    if (site.userId !== identity.subject) {
      throw new Error("Unauthorized");
    }

    if (!site.sandboxId) {
      throw new Error("Sandbox not started yet");
    }

    const logs = await getWorkerLogs(site.sandboxId);

    console.log("[CONVEX A(sandbox:getWorkerProcessLogs)] [LOG]", logs.output);

    return logs;
  },
});

/**
 * Stop a sandbox (called when presence becomes empty after 30s delay)
 */
export const stopSandbox = internalAction({
  args: {
    siteId: v.id("sites"),
  },
  handler: async (ctx, { siteId }) => {
    console.log("[stopSandbox] Stopping sandbox for site", { siteId });

    try {
      const site = await ctx.runQuery(internal.sites.getSiteById, { siteId });
      if (!site) {
        throw new Error(`Site ${siteId} not found`);
      }

      if (!site.sandboxId) {
        console.log("[stopSandbox] No sandbox to stop");
        return { success: false, reason: "no_sandbox" };
      }

      // Check if site is already stopped
      if (site.status === "stopped") {
        console.log("[stopSandbox] Sandbox already stopped");
        return { success: false, reason: "already_stopped" };
      }

      // Stop the sandbox
      await stopSandboxInstance(site.sandboxId);

      // Update status in database
      await ctx.runMutation(internal.sites.updateSiteStatus, {
        siteId,
        status: "stopped",
      });

      // Clear the scheduled shutdown ID
      await ctx.runMutation(internal.sites.clearScheduledShutdown, {
        siteId,
      });

      console.log("[stopSandbox] Sandbox stopped successfully", {
        siteId,
        sandboxId: site.sandboxId,
      });

      return { success: true };
    } catch (error) {
      console.error("[stopSandbox] Failed to stop sandbox:", {
        siteId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
});

/**
 * Resume a stopped sandbox (called when presence returns)
 */
export const resumeSandbox = internalAction({
  args: {
    siteId: v.id("sites"),
  },
  handler: async (ctx, { siteId }) => {
    console.log("[resumeSandbox] Resuming sandbox for site", { siteId });

    try {
      const site = await ctx.runQuery(internal.sites.getSiteById, { siteId });
      if (!site) {
        throw new Error(`Site ${siteId} not found`);
      }

      if (!site.sandboxId) {
        console.log("[resumeSandbox] No sandbox to resume");
        return { success: false, reason: "no_sandbox" };
      }

      // Check if already running
      if (site.status === "started") {
        console.log("[resumeSandbox] Sandbox already running");
        return { success: false, reason: "already_started" };
      }

      // Start the sandbox
      await startSandboxInstance(site.sandboxId);

      // Update status in database
      await ctx.runMutation(internal.sites.updateSiteStatus, {
        siteId,
        status: "started",
      });

      console.log("[resumeSandbox] Sandbox resumed successfully", {
        siteId,
        sandboxId: site.sandboxId,
      });

      return { success: true };
    } catch (error) {
      console.error("[resumeSandbox] Failed to resume sandbox:", {
        siteId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
});
