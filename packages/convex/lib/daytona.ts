"use node";

import { Daytona, Image } from "@daytonaio/sdk";

/**
 * Initialize Daytona SDK client
 */
export function getDaytonaClient(): Daytona {
  const apiUrl = process.env.DAYTONA_API_URL;
  const apiKey = process.env.DAYTONA_API_KEY;

  if (!apiUrl || !apiKey) {
    throw new Error(
      "DAYTONA_API_URL and DAYTONA_API_KEY environment variables are required",
    );
  }

  return new Daytona({
    apiKey,
    apiUrl,
    target: "us",
  });
}

/**
 * Build the landing base image with pre-cloned repository and dependencies
 * This significantly speeds up sandbox creation by avoiding git clone and npm install at runtime
 * @returns Daytona Image object ready to be used for sandbox creation
 */
export function buildSandboxImage(): Image {
  return Image.base("node:22-slim")
    .runCommands(
      // Install essential utilities and ripgrep (required by Claude Code)
      "apt-get update && apt-get install -y curl coreutils procps git ripgrep && rm -rf /var/lib/apt/lists/*",
      // Install Anthropic packages globally: claude-code (CLI), claude-agent-sdk (SDK), and sdk (API client)
      "npm install -g @anthropic-ai/claude-code @anthropic-ai/claude-agent-sdk @anthropic-ai/sdk",
      // Create landing user with home directory
      "useradd -m -d /home/landing -s /bin/bash landing",
      "VERSION=2",
    )
    .dockerfileCommands(["USER landing"])
    .runCommands(
      // Clone the landing starter repository
      "git clone https://github.com/chickencoder/landing-starter /home/landing/project",
      // Install project dependencies
      "cd /home/landing/project && npm install",
      // Pre-install worker SDK dependencies in project directory
      "cd /home/landing/project && npm install --no-save @anthropic-ai/claude-agent-sdk@^0.1.28 @anthropic-ai/sdk@^0.68.0",
    )
    .workdir("/home/landing/project");
}

/**
 * Create a Daytona sandbox with the specified image and environment variables
 */
export async function createSandbox(
  image: Image,
  envVars: Record<string, string>,
  options?: {
    cpu?: number;
    memory?: number;
    disk?: number;
  },
) {
  const daytona = getDaytonaClient();

  const sandbox = await daytona.create(
    {
      image,
      envVars,
      public: true,
      resources: {
        cpu: options?.cpu || 2,
        memory: options?.memory || 4,
        disk: options?.disk || 10,
      },
    },
    { timeout: 0 },
  );

  console.log("[DAYTONA] Sandbox created:", {
    id: sandbox.id,
  });

  return sandbox;
}

/**
 * Clone the landing starter repository into the sandbox
 */
export async function cloneStarterRepo(sandboxId: string) {
  const daytona = getDaytonaClient();
  const sandbox = await daytona.findOne({ id: sandboxId });

  if (!sandbox) {
    throw new Error(`Sandbox ${sandboxId} not found`);
  }

  // Clone the starter repository
  await sandbox.process.executeCommand(
    "git clone https://github.com/chickencoder/landing-starter /home/landing/project",
  );

  // Install dependencies
  await sandbox.process.executeCommand(
    "cd /home/landing/project && npm install 2>&1",
  );

  return { success: true };
}

/**
 * Start the dev server in the project directory
 */
export async function startDevServer(sandboxId: string) {
  const daytona = getDaytonaClient();
  const sandbox = await daytona.findOne({ id: sandboxId });

  if (!sandbox) {
    throw new Error(`Sandbox ${sandboxId} not found`);
  }

  // Create Daytona session for the dev server process
  const sessionId = `dev-server-${Date.now()}`;
  await sandbox.process.createSession(sessionId);

  // Start dev server in background
  const command = await sandbox.process.executeSessionCommand(sessionId, {
    command: "cd /home/landing/project && npm run dev > dev.log 2>&1",
    runAsync: true,
  });

  if (!command.cmdId) {
    throw new Error("Failed to start dev server process");
  }

  // Get the public preview URL for port 3000
  // Using getPreviewLink as per Daytona SDK documentation
  const previewInfo = await sandbox.getPreviewLink(3000);
  const previewUrl = previewInfo.url;

  console.log("[DAYTONA] Dev server preview URL retrieved:", {
    previewUrl,
    hasToken: !!previewInfo.token,
    sandboxId: sandbox.id,
  });

  return {
    sessionId,
    commandId: command.cmdId,
    previewUrl,
  };
}

/**
 * Upload worker file to sandbox and start it
 * Dependencies are already pre-installed in the image
 */
export async function uploadAndStartWorker(
  sandboxId: string,
  workerSource: string,
) {
  const daytona = getDaytonaClient();
  const sandbox = await daytona.findOne({ id: sandboxId });

  if (!sandbox) {
    throw new Error(`Sandbox ${sandboxId} not found`);
  }

  // Upload worker file
  await sandbox.fs.uploadFile(
    Buffer.from(workerSource, "utf-8"),
    "/home/landing/project/worker.js",
  );

  await sandbox.process.executeCommand(
    "chmod +x /home/landing/project/worker.js",
  );

  // Create Daytona session for the worker process
  const sessionId = `worker-${Date.now()}`;
  await sandbox.process.createSession(sessionId);

  // Start worker in background
  const command = await sandbox.process.executeSessionCommand(sessionId, {
    command: "cd /home/landing/project && node worker.js > worker.log 2>&1",
    runAsync: true,
  });

  if (!command.cmdId) {
    throw new Error("Failed to start worker process");
  }

  return {
    sessionId,
    commandId: command.cmdId,
  };
}

/**
 * Get logs from a worker process
 */
export async function getWorkerLogs(sandboxId: string) {
  const daytona = getDaytonaClient();
  const sandbox = await daytona.findOne({ id: sandboxId });

  if (!sandbox) {
    throw new Error(`Sandbox ${sandboxId} not found`);
  }

  try {
    const logBuffer = await sandbox.fs.downloadFile(
      "/home/landing/project/worker.log",
    );
    const logText = logBuffer.toString("utf-8");

    return {
      stdout: logText,
      stderr: "",
      output: logText,
    };
  } catch (error) {
    return {
      stdout: "",
      stderr: "",
      output: "No logs available",
    };
  }
}
