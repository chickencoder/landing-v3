import { httpRouter } from "convex/server";
import { Webhook } from "svix";
import { createClerkClient } from "@clerk/backend";
import { nanoid } from "nanoid";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

const http = httpRouter();

http.route({
  path: "/clerk-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;

    if (!webhookSecret) {
      return new Response("Webhook secret not configured", { status: 500 });
    }

    const svix_id = request.headers.get("svix-id");
    const svix_timestamp = request.headers.get("svix-timestamp");
    const svix_signature = request.headers.get("svix-signature");

    if (!svix_id || !svix_timestamp || !svix_signature) {
      return new Response("Missing svix headers", { status: 400 });
    }

    const payload = await request.text();
    const body = JSON.parse(payload);

    const wh = new Webhook(webhookSecret);
    let evt;

    try {
      evt = wh.verify(payload, {
        "svix-id": svix_id,
        "svix-timestamp": svix_timestamp,
        "svix-signature": svix_signature,
      });
    } catch (err) {
      console.error("Error verifying webhook:", err);
      return new Response("Webhook verification failed", { status: 400 });
    }

    const eventType = evt.type;

    if (eventType === "user.created" || eventType === "user.updated") {
      const { id, email_addresses, first_name, last_name, image_url } =
        evt.data;

      const primaryEmail = email_addresses.find(
        (email: any) => email.id === evt.data.primary_email_address_id
      );

      await ctx.runMutation(internal.users.syncUser, {
        userId: id,
        email: primaryEmail?.email_address || "",
        firstName: first_name || undefined,
        lastName: last_name || undefined,
        imageUrl: image_url || undefined,
      });

      // Auto-create personal organization on user creation
      if (eventType === "user.created") {
        const clerkSecretKey = process.env.CLERK_SECRET_KEY;
        if (!clerkSecretKey) {
          console.error("CLERK_SECRET_KEY not configured");
          return new Response(
            JSON.stringify({ error: "CLERK_SECRET_KEY not configured" }),
            { status: 500 }
          );
        }

        try {
          const clerk = createClerkClient({ secretKey: clerkSecretKey });

          const personalOrgName = first_name
            ? `${first_name}'s Workspace`
            : "Personal Workspace";

          // Generate base slug candidates
          const candidates = [];
          if (first_name) {
            candidates.push(first_name.toLowerCase().replace(/[^a-z0-9]/g, "-"));
          }
          if (primaryEmail?.email_address) {
            const emailUsername = primaryEmail.email_address.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "-");
            candidates.push(emailUsername);
          }
          if (first_name && last_name) {
            const fullName = `${first_name}-${last_name}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
            candidates.push(fullName);
          }
          candidates.push("user"); // Ultimate fallback

          // Find available slug
          const checkSlugAvailable = async (slug: string): Promise<boolean> => {
            try {
              await clerk.organizations.getOrganization({ slug });
              return false; // Slug exists, not available
            } catch (error: any) {
              // 404 means slug is available
              if (error?.status === 404) {
                return true;
              }
              throw error;
            }
          };

          let availableSlug: string | null = null;
          for (const baseSlug of candidates) {
            // Check base slug
            if (await checkSlugAvailable(baseSlug)) {
              availableSlug = baseSlug;
              break;
            }

            // If taken, try with a short nanoid suffix
            const slugWithId = `${baseSlug}-${nanoid(6).toLowerCase()}`;
            if (await checkSlugAvailable(slugWithId)) {
              availableSlug = slugWithId;
              break;
            }
          }

          if (!availableSlug) {
            throw new Error("Could not find available organization slug");
          }

          console.log(`Creating organization for user ${id} with slug: ${availableSlug}`);

          // Create organization using Clerk SDK
          const organization = await clerk.organizations.createOrganization({
            name: personalOrgName,
            slug: availableSlug,
            createdBy: id,
          });

          console.log(`Successfully created organization: ${organization.id} with slug: ${organization.slug}`);

          // Sync the organization to Convex
          await ctx.runMutation(internal.organizations.syncOrganization, {
            orgId: organization.id,
            name: organization.name,
            slug: organization.slug!,
            createdBy: id,
            imageUrl: organization.imageUrl || undefined,
          });

          // Set as user's primary org
          await ctx.runMutation(internal.users.updatePrimaryOrg, {
            userId: id,
            orgId: organization.id,
          });
        } catch (error) {
          console.error("Error creating personal organization:", error);
          return new Response(
            JSON.stringify({ error: "Failed to create organization", message: String(error) }),
            { status: 500 }
          );
        }
      }
    } else if (eventType === "user.deleted") {
      await ctx.runMutation(internal.users.deleteUser, {
        userId: evt.data.id,
      });
    } else if (
      eventType === "organization.created" ||
      eventType === "organization.updated"
    ) {
      const { id, name, slug, created_by, image_url } = evt.data;

      await ctx.runMutation(internal.organizations.syncOrganization, {
        orgId: id,
        name: name,
        slug: slug || id, // Fallback to orgId if no slug provided
        createdBy: created_by,
        imageUrl: image_url || undefined,
      });
    } else if (eventType === "organization.deleted") {
      await ctx.runMutation(internal.organizations.deleteOrganization, {
        orgId: evt.data.id,
      });
    } else if (eventType === "organizationMembership.created") {
      const { organization, public_user_data } = evt.data;

      // Update user's primary org if they don't have one
      const user = await ctx.runQuery(internal.users.getUser, {
        userId: public_user_data.user_id,
      });

      if (user && !user.primaryOrgId) {
        await ctx.runMutation(internal.users.updatePrimaryOrg, {
          userId: public_user_data.user_id,
          orgId: organization.id,
        });
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;
