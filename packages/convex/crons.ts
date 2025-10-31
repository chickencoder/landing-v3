import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Clean up stale activeUsers entries every minute
crons.interval(
  "cleanup stale presence",
  { minutes: 1 },
  internal.presence.cleanupStaleUsers
);

export default crons;
