import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Clean up stale activeUsers entries every minute
crons.interval(
  "cleanup stale presence",
  { minutes: 1 },
  internal.presence.cleanupStaleUsers
);

// Clean up stuck worker streaming state every 5 minutes
crons.interval(
  "cleanup stuck worker state",
  { minutes: 5 },
  internal.presence.cleanupStuckWorkerState
);

export default crons;
