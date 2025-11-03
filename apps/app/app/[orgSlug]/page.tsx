import { NewSiteForm } from "@/components/new-site-form";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function Page() {
  const { orgId } = await auth();

  if (!orgId) {
    return redirect("/");
  }

  return (
    <>
      <main className="max-w-2xl mx-auto text-center p-4 py-20">
        <h1 className="text-4xl font-medium tracking-tighter mb-8">
          What should we create?
        </h1>
        <NewSiteForm />
      </main>
    </>
  );
}
