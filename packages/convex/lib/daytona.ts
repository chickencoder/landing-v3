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
 * Build the landing base image without embedded worker
 * Worker will be uploaded separately after sandbox creation
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
    )
    .dockerfileCommands(["USER landing"])
    .workdir("/home/landing");
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

  return sandbox;
}

/**
 * Upload worker file to sandbox and start it
 */
export async function uploadAndStartWorker(
  sandboxId: string,
  workerSource: string,
) {
  const daytona = getDaytonaClient();
  const sandbox = await daytona.findOne({ idOrName: sandboxId });

  if (!sandbox) {
    throw new Error(`Sandbox ${sandboxId} not found`);
  }

  // Upload worker file
  await sandbox.fs.uploadFile(
    Buffer.from(workerSource, "utf-8"),
    "/home/landing/worker.js"
  );

  await sandbox.process.executeCommand("chmod +x /home/landing/worker.js");

  // Upload package.json with SDK dependencies
  const packageJson = {
    type: "module",
    dependencies: {
      "@anthropic-ai/claude-agent-sdk": "^0.1.28",
      "@anthropic-ai/sdk": "^0.68.0",
    },
  };

  await sandbox.fs.uploadFile(
    Buffer.from(JSON.stringify(packageJson, null, 2)),
    "/home/landing/package.json"
  );

  // Install dependencies
  await sandbox.process.executeCommand(
    "cd /home/landing && npm install --no-save --prefer-offline 2>&1"
  );

  // Create Daytona session for the worker process
  const sessionId = `worker-${Date.now()}`;
  await sandbox.process.createSession(sessionId);

  // Start worker in background
  const command = await sandbox.process.executeSessionCommand(sessionId, {
    command: "cd /home/landing && node worker.js > worker.log 2>&1",
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
  const sandbox = await daytona.findOne({ idOrName: sandboxId });

  if (!sandbox) {
    throw new Error(`Sandbox ${sandboxId} not found`);
  }

  try {
    const logBuffer = await sandbox.fs.downloadFile("/home/landing/worker.log");
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
