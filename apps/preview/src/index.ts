/**
 * Cloudflare Worker that proxies requests to Daytona preview environments
 * Based on site slugs (e.g., {slug}.landing.local)
 */

import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../packages/convex/_generated/api';

interface Env {
	SANDBOX_CACHE: KVNamespace;
	CONVEX_URL: string;
}

interface SandboxInfo {
	sandboxId: string | undefined;
	status: string | undefined;
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		const hostname = url.hostname;

		// Extract slug from hostname (e.g., "my-site.landing.local" -> "my-site")
		const slug = hostname.split('.')[0];

		if (!slug || slug === 'landing') {
			return new Response('Invalid subdomain', { status: 400 });
		}

		// Try to get sandboxId from cache first
		const cacheKey = `sandbox:${slug}`;
		let sandboxId = await env.SANDBOX_CACHE.get(cacheKey);

		// If not in cache, fetch from Convex
		if (!sandboxId) {
			try {
				const client = new ConvexHttpClient(env.CONVEX_URL);
				const result: SandboxInfo | null = await client.query(api.sites.getSandboxIdBySlug, { slug });

				if (!result || !result.sandboxId) {
					return new Response('Site not found or sandbox not created', { status: 404 });
				}

				sandboxId = result.sandboxId;

				// Cache the sandboxId for 5 minutes
				ctx.waitUntil(env.SANDBOX_CACHE.put(cacheKey, sandboxId, { expirationTtl: 300 }));
			} catch (error) {
				console.error('Error fetching from Convex:', error);
				return new Response(`Error: ${error instanceof Error ? error.message : String(error)}`, {
					status: 500,
				});
			}
		}

		// Construct Daytona proxy URL
		const daytonaUrl = `https://3000-${sandboxId}.proxy.daytona.works${url.pathname}${url.search}`;

		// Proxy the request with Daytona skip preview warning header
		const proxyHeaders = new Headers(request.headers);
		proxyHeaders.set('X-Daytona-Skip-Preview-Warning', 'true');

		const proxyRequest = new Request(daytonaUrl, {
			method: request.method,
			headers: proxyHeaders,
			body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
		});

		const response = await fetch(proxyRequest);

		// If response is 4xx or 5xx error, add Refresh header to retry
		if (response.status >= 400 && response.status < 600) {
			const retryResponse = new Response(null, {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers,
			});
			retryResponse.headers.set('Refresh', '3');
			retryResponse.headers.set('Retry-After', '3');
			return retryResponse;
		}

		return response;
	},
} satisfies ExportedHandler<Env>;
