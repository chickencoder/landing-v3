import { useMutation } from "convex/react";
import { useEffect } from "react";
import { api } from "@repo/convex/_generated/api";

export function useSitePresence(slug: string, isAuthenticated: boolean) {
  const heartbeat = useMutation(api.presence.heartbeat);
  const leave = useMutation(api.presence.leave);

  useEffect(() => {
    if (!isAuthenticated) return;

    const handleError = (context: string) => (err: unknown) =>
      console.error(`[presence] ${context} failed:`, err);

    // Send initial heartbeat
    heartbeat({ slug }).catch(handleError("Initial heartbeat"));

    // Periodic heartbeat while tab is visible
    const interval = setInterval(() => {
      if (!document.hidden) {
        heartbeat({ slug }).catch(handleError("Heartbeat"));
      }
    }, 10_000);

    const handleVisibilityChange = () => {
      if (document.hidden) {
        leave({ slug }).catch(handleError("Leave (visibility)"));
      } else {
        heartbeat({ slug }).catch(handleError("Heartbeat (visibility)"));
      }
    };

    const handleBeforeUnload = () => {
      leave({ slug }).catch(handleError("Leave (beforeunload)"));
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      leave({ slug }).catch(handleError("Leave (unmount)"));
    };
  }, [slug, heartbeat, leave, isAuthenticated]);
}
