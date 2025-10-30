"use node";

import { internalAction, action } from "./_generated/server";
import { v } from "convex/values";
import { generateSessionToken } from "./lib/clerk";
import {
  buildSandboxImage,
  createSandbox,
  uploadAndStartWorker,
  getWorkerLogs,
} from "./lib/daytona";
import { internal } from "./_generated/api";
import { getWorkerSource } from "./lib/workerBundle";

export const startSandbox = internalAction({
  args: {
    siteId: v.id("sites"),
    message: v.string(),
  },
  handler: async (ctx, { siteId, message }) => {
    try {
      const site = await ctx.runQuery(internal.sites.getSiteById, { siteId });
      if (!site) {
        throw new Error(`Site ${siteId} not found`);
      }

      const { userId, orgId } = site;

      // Insert user message
      await ctx.runMutation(internal.messages.insertMessage, {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: message }],
        siteId,
        userId,
        orgId,
      });

      await ctx.runMutation(internal.sites.updateSiteStatus, {
        siteId,
        status: "creating",
      });

      // Generate Clerk token for worker authentication
      const clerkToken = await generateSessionToken(userId, orgId, 3600);

      // Build and create sandbox
      const image = buildSandboxImage();
      const convexUrl = process.env.CONVEX_CLOUD_URL;
      const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

      if (!convexUrl || !anthropicApiKey) {
        throw new Error("Missing required environment variables");
      }

      const sandbox = await createSandbox(image, {
        CONVEX_URL: convexUrl,
        SITE_ID: siteId,
        CLERK_TOKEN: clerkToken,
        ANTHROPIC_API_KEY: anthropicApiKey,
      });

      await ctx.runMutation(internal.sites.updateSandboxId, {
        siteId,
        sandboxId: sandbox.id,
      });

      // Upload and start worker
      const workerSource = getWorkerSource();
      const workerProcess = await uploadAndStartWorker(sandbox.id, workerSource);

      await ctx.runMutation(internal.sites.updateWorkerProcessIds, {
        siteId,
        daytonaSessionId: workerProcess.sessionId,
        commandId: workerProcess.commandId,
      });

      await ctx.runMutation(internal.sites.updateSiteStatus, {
        siteId,
        status: "ready",
      });

      return {
        success: true,
        sandboxId: sandbox.id,
      };
    } catch (error) {
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
