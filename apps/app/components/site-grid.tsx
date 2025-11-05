"use client";

import { api } from "@repo/convex/_generated/api";
import type { Doc } from "@repo/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { Card, CardHeader, CardTitle } from "./ui/card";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Skeleton } from "./ui/skeleton";

export function SiteGrid() {
  const sites = useQuery(api.sites.list);
  const { orgSlug } = useParams<{ orgSlug: string }>();

  return (
    <div className="grid grid-cols-3 gap-4">
      {!sites && (
        <>
          <Skeleton className="aspect-[1.26] w-full h-full" />
          <Skeleton className="aspect-[1.26] w-full h-full" />
          <Skeleton className="aspect-[1.26] w-full h-full" />
          <Skeleton className="aspect-[1.26] w-full h-full" />
          <Skeleton className="aspect-[1.26] w-full h-full" />
          <Skeleton className="aspect-[1.26] w-full h-full" />
        </>
      )}
      {sites?.map((site: Doc<"sites">) => (
        <Link href={`/${orgSlug}/${site.slug}`} key={site._id}>
          <Card className="shadow-xs pt-0 pb-4 rounded-md">
            <div className="aspect-video w-full bg-accent/70 rounded-md border-b rounded-b-none" />
            <CardHeader className="text-left">
              <CardTitle className="mb-0">{site.slug}</CardTitle>
            </CardHeader>
          </Card>
        </Link>
      ))}
    </div>
  );
}
