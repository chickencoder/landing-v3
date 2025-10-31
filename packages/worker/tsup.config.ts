import { defineConfig } from "tsup";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { createHash } from "crypto";
import { config } from "dotenv";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load environment variables from .env.local in worker package
config({ path: join(__dirname, ".env.local") });

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  clean: false,
  sourcemap: false,
  bundle: true,
  minify: false,
  target: "node18",
  platform: "node",
  outDir: "dist",
  outExtension: () => ({ js: ".js" }),
  // Bundle all dependencies except Node.js built-ins and Anthropic SDK packages
  external: [
    // Node.js built-ins
    "fs",
    "path",
    "crypto",
    "os",
    "url",
    "util",
    "events",
    "stream",
    "buffer",
    "process",
    "child_process",
    "worker_threads",
    "cluster",
    "net",
    "http",
    "https",
    "tls",
    "zlib",
    "querystring",
    "assert",
    "console",
    "timers",
    "dns",
    // External modules that need access to their original file structure
    "@anthropic-ai/claude-agent-sdk",
    "@anthropic-ai/sdk",
  ],
  // Bundle most dependencies but exclude those that need to remain external
  noExternal: [/^(?!@anthropic-ai\/(claude-agent-sdk|sdk)$).*/],
  // Add shebang for executable
  banner: {
    js: "#!/usr/bin/env node\n",
  },
  // Upload worker to R2 and update Convex env var
  onSuccess: async () => {
    const workerBundlePath = join(__dirname, "dist/index.js");

    try {
      console.log("Reading worker bundle from:", workerBundlePath);
      const bundleContent = readFileSync(workerBundlePath, "utf-8");

      // Calculate hash of worker content
      const hash = createHash("sha256")
        .update(bundleContent)
        .digest("hex")
        .slice(0, 12);
      const fileName = `worker-${hash}.js`;

      console.log(`✓ Worker hash: ${hash}`);
      console.log(
        `  Size: ${(Buffer.byteLength(bundleContent, "utf-8") / 1024).toFixed(2)} KB`,
      );

      // Upload to R2 if credentials are available
      const r2Endpoint = process.env.R2_ENDPOINT;
      const r2AccessKey = process.env.R2_ACCESS_KEY_ID;
      const r2SecretKey = process.env.R2_SECRET_ACCESS_KEY;
      const r2BucketName = process.env.R2_BUCKET_NAME || "landing-workers";

      if (r2Endpoint && r2AccessKey && r2SecretKey) {
        console.log("Uploading worker to R2...");

        const s3Client = new S3Client({
          region: "auto",
          endpoint: r2Endpoint,
          credentials: {
            accessKeyId: r2AccessKey,
            secretAccessKey: r2SecretKey,
          },
        });

        await s3Client.send(
          new PutObjectCommand({
            Bucket: r2BucketName,
            Key: fileName,
            Body: bundleContent,
            ContentType: "application/javascript",
          }),
        );

        console.log(`✓ Worker uploaded to R2: ${fileName}`);

        // Update Convex environment variable
        const r2PublicUrl = process.env.R2_PUBLIC_URL;
        if (r2PublicUrl) {
          const fullWorkerUrl = `${r2PublicUrl}/${r2BucketName}/${fileName}`;
          console.log(`\n✓ Worker URL: ${fullWorkerUrl}`);
          console.log("\nUpdating Convex environment variable...");

          try {
            const convexDir = join(__dirname, "../convex");
            execSync(`npx convex env set WORKER_URL "${fullWorkerUrl}"`, {
              cwd: convexDir,
              stdio: "inherit",
            });
            console.log("✓ WORKER_URL updated in Convex");
          } catch (error) {
            console.error("✖ Failed to update Convex env var:");
            console.error(`  Run manually: npx convex env set WORKER_URL "${fullWorkerUrl}"`);
          }
        }
      } else {
        console.log("⚠ R2 credentials not found, skipping upload");
        console.log(
          "  Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY to enable R2 upload",
        );
      }
    } catch (error) {
      console.error("✖ Failed to process worker:", error);
      throw error;
    }
  },
});
