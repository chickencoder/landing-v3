import { NewSiteForm } from "@/components/new-site-form";
import { SiteGrid } from "@/components/site-grid";
import { UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function Page() {
  const { orgId } = await auth();

  if (!orgId) {
    return redirect("/");
  }

  return (
    <>
      <main className="max-w-5xl mx-auto text-center p-4 py-20">
        <div className="absolute top-0 right-0 p-4">
          <UserButton />
        </div>
        <h1 className="text-4xl font-medium tracking-tighter mb-8">
          What should we create?
        </h1>
        <NewSiteForm className="mb-16" />
        <SiteGrid />
      </main>
    </>
  );
}
