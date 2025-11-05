"use client";

import { Loader } from "lucide-react";
import { Button } from "./ui/button";

interface BuilderPreviewProps {
  previewUrl: string;
  shouldShowLoadingOverlay: boolean;
  loadingMessage: string;
}

function LoadingState({ message }: { message: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background/95 backdrop-blur-sm rounded-md border z-10">
      <div className="flex flex-col items-center gap-2">
        <Loader className="size-4 animate-spin" />
        <p className="text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

function Preview({ url }: { url: string }) {
  return (
    url && (
      <iframe
        src={url}
        className="w-full h-full border rounded-md overflow-hidden"
        allowFullScreen
      />
    )
  );
}

function PreviewToolbar() {
  return (
    <div className="flex items-center justify-end">
      <Button size="sm">Publish</Button>
    </div>
  );
}

export function BuilderPreview({
  previewUrl,
  shouldShowLoadingOverlay,
  loadingMessage,
}: BuilderPreviewProps) {
  return (
    <div className="w-full flex flex-col gap-2">
      <PreviewToolbar />
      <div className="flex-1 relative">
        {shouldShowLoadingOverlay && <LoadingState message={loadingMessage} />}
        <Preview url={previewUrl} />
      </div>
    </div>
  );
}
