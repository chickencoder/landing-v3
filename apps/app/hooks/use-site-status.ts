import { useMemo } from "react";

type SiteStatus = "creating" | "started" | "stopped" | "error" | "deleted";

interface Site {
  status?: SiteStatus;
  slug?: string;
  devServer?: {
    isRunning?: boolean;
  };
}

export function useSiteStatus(site: Site | null | undefined) {
  const previewUrl = site?.slug ? `https://${site.slug}.landing.local` : "";

  const shouldShowLoadingOverlay =
    site?.status !== "started" || !site?.devServer?.isRunning;

  const loadingMessage = useMemo(() => {
    if (site?.status === "creating") return "Setting up your workspace...";
    if (site?.status === "stopped") return "Workspace is stopped";
    if (site?.status === "error") return "Error loading workspace";
    if (site?.status === "deleted") return "Workspace has been deleted";
    if (site?.status === "started" && !site?.devServer?.isRunning) {
      return "Starting dev server...";
    }
    return "Loading workspace...";
  }, [site?.status, site?.devServer?.isRunning]);

  return {
    previewUrl,
    shouldShowLoadingOverlay,
    loadingMessage,
  };
}
