"use client";

import {
  OrganizationList,
  RedirectToSignIn,
  useAuth,
  UserButton,
} from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "@repo/convex/_generated/api";
import { Loader } from "lucide-react";

export default function RootPage() {
  const { userId, isLoaded: authLoaded } = useAuth();

  const organizations = useQuery(
    api.organizations.getUserOrganizations,
    userId ? {} : "skip",
  );

  if (!userId && authLoaded) {
    return <RedirectToSignIn />;
  }

  if (!authLoaded || organizations === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <Loader className="size-4 animate-spin" />
          <p className="text-muted-foreground">Loading workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center relative">
      <div className="absolute top-0 right-0 p-4">
        <UserButton />
      </div>
      <OrganizationList
        hidePersonal
        afterSelectOrganizationUrl={(org) => `/${org.slug}`}
      />
    </div>
  );
}
