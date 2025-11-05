import { Builder } from "@/components/builder";

export default async function BuilderPage({
  params,
}: {
  params: Promise<{ orgSlug: string; slug: string }>;
}) {
  const { slug } = await params;

  return <Builder slug={slug} />;
}
