"use client";

import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";

export type LoadingTextProps = ComponentProps<"span">;

export const LoadingText = ({
  children,
  className,
  ...props
}: LoadingTextProps) => (
  <span
    className={cn(
      "inline-flex items-center gap-1 text-muted-foreground",
      className
    )}
    {...props}
  >
    {children}
    <span className="inline-flex gap-0.5">
      <span className="animate-bounce [animation-delay:0ms]">.</span>
      <span className="animate-bounce [animation-delay:150ms]">.</span>
      <span className="animate-bounce [animation-delay:300ms]">.</span>
    </span>
  </span>
);
