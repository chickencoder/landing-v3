"use client";

import { useMutation } from "convex/react";
import { api } from "@repo/convex/_generated/api";
import { useRouter, useParams } from "next/navigation";
import type { PromptInputMessage } from "./ai-elements/prompt-input";
import {
  PromptInput,
  PromptInputActionMenu,
  PromptInputBody,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "./ai-elements/prompt-input";
import { FormEvent, useEffect, useState } from "react";

export function NewSiteForm() {
  const createSite = useMutation(api.sites.create);
  const router = useRouter();
  const params = useParams();
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (
    message: PromptInputMessage,
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    if (!message.text?.trim()) return;

    setIsLoading(true);
    setTimeout(() => setIsLoading(false), 30_000);

    const { slug } = await createSite({ message: message.text });
    router.push(`/${params.orgSlug}/${slug}`);
  };

  useEffect(() => {
    console.log({ isLoading });
  }, [isLoading]);

  return (
    <PromptInputProvider>
      <PromptInput
        globalDrop
        multiple
        resetOnSubmit={false}
        onSubmit={handleSubmit}
        className="bg-card"
      >
        <PromptInputBody>
          <PromptInputTextarea />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <PromptInputActionMenu></PromptInputActionMenu>
          </PromptInputTools>
          <PromptInputSubmit
            variant="secondary"
            status={isLoading ? "submitted" : "ready"}
          />
        </PromptInputFooter>
      </PromptInput>
    </PromptInputProvider>
  );
}
