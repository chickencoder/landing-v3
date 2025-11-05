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
 * Build the landing base image with pre-cloned repository, dependencies, and supervisord
 * Supervisord automatically starts the dev server and worker when the sandbox boots
 * Worker is downloaded from R2 at image build time
 * @returns Daytona Image object ready to be used for sandbox creation
 */
export function buildSandboxImage(): Image {
  // Get worker URL from environment variable
  const workerUrl = process.env.WORKER_URL;

  if (!workerUrl) {
    throw new Error(
      "WORKER_URL environment variable is required for building sandbox images",
    );
  }

  console.log(`[DAYTONA] Building image with worker from: ${workerUrl}`);

  return Image.base("node:22-slim")
    .runCommands(
      // Install essential utilities, ripgrep (required by Claude Code), supervisor, and tmux
      "apt-get update && apt-get install -y curl coreutils procps git ripgrep supervisor tmux && rm -rf /var/lib/apt/lists/*",
      // Install Claude Code using official install script and make it globally accessible
      "curl -fsSL https://claude.ai/install.sh | bash",
      "cp /root/.local/bin/claude /usr/local/bin/claude",
      // Create landing user with home directory
      "useradd -m -d /home/landing -s /bin/bash landing",
      "VERSION=12",
    )
    .dockerfileCommands(["USER landing"])
    .runCommands(
      // Clone the landing starter repository
      "git clone https://github.com/chickencoder/landing-starter /home/landing/project",
      // Install project dependencies
      "cd /home/landing/project && npm install",
    )
    .dockerfileCommands(["USER root"])
    .runCommands(
      // Download worker from R2
      `curl -fsSL -o /home/landing/project/worker.js "${workerUrl}"`,
      // Make worker executable and set ownership
      "chmod +x /home/landing/project/worker.js",
      "chown landing:landing /home/landing/project/worker.js",
      // Create supervisord configuration for dev-server
      'echo "[program:dev-server]" > /etc/supervisor/conf.d/landing.conf',
      'echo "command=npm run dev" >> /etc/supervisor/conf.d/landing.conf',
      'echo "directory=/home/landing/project" >> /etc/supervisor/conf.d/landing.conf',
      'echo "user=landing" >> /etc/supervisor/conf.d/landing.conf',
      'echo "autostart=true" >> /etc/supervisor/conf.d/landing.conf',
      'echo "autorestart=true" >> /etc/supervisor/conf.d/landing.conf',
      'echo "stdout_logfile=/home/landing/project/dev.log" >> /etc/supervisor/conf.d/landing.conf',
      'echo "stderr_logfile=/home/landing/project/dev.log" >> /etc/supervisor/conf.d/landing.conf',
      'echo "environment=HOME=\\"/home/landing\\",USER=\\"landing\\",PATH=\\"/usr/local/bin:/usr/bin:/bin\\"" >> /etc/supervisor/conf.d/landing.conf',
      'echo "" >> /etc/supervisor/conf.d/landing.conf',
      // Create supervisord configuration for worker
      'echo "[program:worker]" >> /etc/supervisor/conf.d/landing.conf',
      'echo "command=node worker.js" >> /etc/supervisor/conf.d/landing.conf',
      'echo "directory=/home/landing/project" >> /etc/supervisor/conf.d/landing.conf',
      'echo "user=landing" >> /etc/supervisor/conf.d/landing.conf',
      'echo "autostart=true" >> /etc/supervisor/conf.d/landing.conf',
      'echo "autorestart=true" >> /etc/supervisor/conf.d/landing.conf',
      'echo "stdout_logfile=/home/landing/project/worker.log" >> /etc/supervisor/conf.d/landing.conf',
      'echo "stderr_logfile=/home/landing/project/worker.log" >> /etc/supervisor/conf.d/landing.conf',
      'echo "environment=HOME=\\"/home/landing\\",USER=\\"landing\\",PATH=\\"/usr/local/bin:/usr/bin:/bin\\",CONVEX_URL=\\"%(ENV_CONVEX_URL)s\\",SITE_ID=\\"%(ENV_SITE_ID)s\\",CLERK_TOKEN=\\"%(ENV_CLERK_TOKEN)s\\",ANTHROPIC_API_KEY=\\"%(ENV_ANTHROPIC_API_KEY)s\\"" >> /etc/supervisor/conf.d/landing.conf',
    )
    .workdir("/home/landing/project")
    .cmd(["supervisord", "-n", "-c", "/etc/supervisor/supervisord.conf"]);
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

  console.log("[DAYTONA] Creating sandbox with configuration:", {
    cpu: options?.cpu || 2,
    memory: options?.memory || 4,
    disk: options?.disk || 10,
    public: true,
    envVarsCount: Object.keys(envVars).length,
  });

  try {
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
      { timeout: 60000 }, // 60 second timeout
    );

    console.log("[DAYTONA] Sandbox created:", {
      id: sandbox.id,
      state: sandbox.state,
    });

    return sandbox;
  } catch (error) {
    console.error("[DAYTONA] Sandbox creation failed:", {
      error: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : "Unknown",
    });
    throw error;
  }
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

/**
 * Stop a Daytona sandbox
 */
export async function stopSandboxInstance(sandboxId: string) {
  const daytona = getDaytonaClient();
  const sandbox = await daytona.findOne({ id: sandboxId });

  if (!sandbox) {
    throw new Error(`Sandbox ${sandboxId} not found`);
  }

  console.log("[DAYTONA] Stopping sandbox:", { id: sandboxId });

  try {
    await sandbox.stop(60);
    console.log("[DAYTONA] Sandbox stopped successfully:", { id: sandboxId });
  } catch (error) {
    console.error("[DAYTONA] Failed to stop sandbox:", {
      id: sandboxId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Start a stopped Daytona sandbox
 */
export async function startSandboxInstance(sandboxId: string) {
  const daytona = getDaytonaClient();
  const sandbox = await daytona.findOne({ id: sandboxId });

  if (!sandbox) {
    throw new Error(`Sandbox ${sandboxId} not found`);
  }

  console.log("[DAYTONA] Starting sandbox:", { id: sandboxId });

  try {
    await sandbox.start(60);
    console.log("[DAYTONA] Sandbox started successfully:", { id: sandboxId });
  } catch (error) {
    console.error("[DAYTONA] Failed to start sandbox:", {
      id: sandboxId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
