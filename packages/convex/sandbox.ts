"use node";

import { internalAction, action } from "./_generated/server";
import { v } from "convex/values";
import { generateSessionToken } from "./lib/clerk";
import {
  buildSandboxImage,
  createSandbox,
  startDevServer,
  uploadAndStartWorker,
  getWorkerLogs,
} from "./lib/daytona";
import { internal } from "./_generated/api";
import { getWorkerSource } from "./lib/workerBundle";

export const startSandbox = internalAction({
  args: {
    siteId: v.id("sites"),
  },
  handler: async (ctx, { siteId }) => {
    console.log("[CONVEX A(sandbox:startSandbox)] Starting sandbox creation", {
      siteId,
    });

    try {
      const site = await ctx.runQuery(internal.sites.getSiteById, { siteId });
      if (!site) {
        throw new Error(`Site ${siteId} not found`);
      }

      const { userId, orgId } = site;
      console.log("[CONVEX A(sandbox:startSandbox)] Site found", {
        userId,
        orgId,
      });

      await ctx.runMutation(internal.sites.updateSiteStatus, {
        siteId,
        status: "creating",
      });
      console.log(
        "[CONVEX A(sandbox:startSandbox)] Site status set to creating"
      );

      // Generate Clerk token for worker authentication
      const clerkToken = await generateSessionToken(userId, orgId, 3600);
      console.log(
        "[CONVEX A(sandbox:startSandbox)] Clerk token generated for worker auth"
      );

      // Build and create sandbox
      const image = buildSandboxImage();
      const convexUrl = process.env.CONVEX_CLOUD_URL;
      const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

      if (!convexUrl || !anthropicApiKey) {
        throw new Error("Missing required environment variables");
      }
      console.log(
        "[CONVEX A(sandbox:startSandbox)] Environment variables validated"
      );

      console.log(
        "[CONVEX A(sandbox:startSandbox)] Creating Daytona sandbox..."
      );
      const sandbox = await createSandbox(image, {
        CONVEX_URL: convexUrl,
        SITE_ID: siteId,
        CLERK_TOKEN: clerkToken,
        ANTHROPIC_API_KEY: anthropicApiKey,
      });

      console.log("[CONVEX A(sandbox:startSandbox)] Sandbox created", {
        sandboxId: sandbox.id,
        sandboxData: JSON.stringify(sandbox, null, 2),
      });

      await ctx.runMutation(internal.sites.updateSandboxId, {
        siteId,
        sandboxId: sandbox.id,
      });
      console.log(
        "[CONVEX A(sandbox:startSandbox)] Sandbox ID stored in database"
      );

      // Start dev server
      console.log("[CONVEX A(sandbox:startSandbox)] Starting dev server...");
      const devServer = await startDevServer(sandbox.id);
      console.log("[CONVEX A(sandbox:startSandbox)] Dev server started", {
        previewUrl: devServer.previewUrl,
      });

      // Use the preview URL from the dev server
      const previewUrl = devServer.previewUrl;
      console.log(
        "[CONVEX A(sandbox:startSandbox)] Using preview URL from dev server",
        {
          previewUrl,
        }
      );

      await ctx.runMutation(internal.sites.updatePreviewUrl, {
        siteId,
        previewUrl,
      });
      console.log(
        "[CONVEX A(sandbox:startSandbox)] Preview URL stored in database"
      );

      // Upload and start worker
      console.log(
        "[CONVEX A(sandbox:startSandbox)] Uploading and starting worker..."
      );
      const workerSource = getWorkerSource();
      await uploadAndStartWorker(sandbox.id, workerSource);
      console.log("[CONVEX A(sandbox:startSandbox)] Worker started");

      await ctx.runMutation(internal.sites.updateSiteStatus, {
        siteId,
        status: "started",
      });
      console.log(
        "[CONVEX A(sandbox:startSandbox)] Site status set to started - sandbox fully operational"
      );

      return {
        success: true,
        sandboxId: sandbox.id,
      };
    } catch (error) {
      console.error(
        "[CONVEX A(sandbox:startSandbox)] Error during sandbox creation:",
        error
      );
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
