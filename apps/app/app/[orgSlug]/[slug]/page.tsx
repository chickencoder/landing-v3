import { Builder } from "@/components/builder";
import { auth } from "@clerk/nextjs/server";
import { preloadQuery } from "convex/nextjs";
import { api } from "@repo/convex/_generated/api";

export default async function BuilderPage({
  params,
}: {
  params: Promise<{ orgSlug: string; slug: string }>;
}) {
  const { slug } = await params;
  const { getToken } = await auth();

  const token = await getToken({ template: "convex" });

  const preloadedMessagesQuery = await preloadQuery(
    api.messages.getMessagesBySite,
    { slug },
    { token: token ?? undefined }
  );

  return (
    <Builder
      slug={slug}
      preloadedMessagesQuery={preloadedMessagesQuery}
    />
  );
}
