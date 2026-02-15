import { NextResponse } from "next/server";
import {
  createServerClient,
  parseCookieHeader,
  serializeCookieHeader,
} from "@supabase/ssr";

/**
 * Resolve the canonical app origin for redirects.
 *
 * Priority order:
 *   1. x-forwarded-host header (set by Vercel edge proxy — most reliable in production)
 *   2. host header
 *   3. Explicit NEXT_PUBLIC_APP_URL (set by the developer)
 *   4. VERCEL_PROJECT_PRODUCTION_URL (auto-set by Vercel — stable across deploys)
 *   5. VERCEL_URL (auto-set by Vercel — per-deployment, changes on each deploy)
 *   6. Parsed request.url origin (fallback)
 */
function getRequestOrigin(request: Request) {
  const forwardedHost =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto") ?? "https";

  if (forwardedHost) {
    return `${protocol}://${forwardedHost}`;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) {
    return appUrl.replace(/\/$/, "");
  }

  const vercelProductionUrl =
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelProductionUrl) {
    return `https://${vercelProductionUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  }

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    return `https://${vercelUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  }

  try {
    return new URL(request.url).origin;
  } catch {
    return "http://localhost:3000";
  }
}

function redirectWithError(
  request: Request,
  errorCode: string,
  headers?: Headers,
) {
  const errorUrl = new URL("/", getRequestOrigin(request));
  errorUrl.searchParams.set("error", errorCode);
  const response = NextResponse.redirect(errorUrl);
  // Carry any Set-Cookie headers so the browser state stays consistent.
  if (headers) {
    headers.getSetCookie().forEach((cookie) => {
      response.headers.append("Set-Cookie", cookie);
    });
  }
  return response;
}

/**
 * OAuth callback handler.
 *
 * IMPORTANT: This route creates its own Supabase client using raw HTTP cookie
 * handling (parseCookieHeader / serializeCookieHeader) instead of the shared
 * `createClient()` from `utils/supabase/server.ts`. This is intentional:
 *
 *   1. `cookies()` from `next/headers` can fail to expose the PKCE
 *      `code_verifier` cookie in Next.js 16 route handlers, causing
 *      `exchangeCodeForSession` to fail before it even makes the /token call.
 *
 *   2. Cookies set via `cookieStore.set()` are not guaranteed to be included
 *      in a `NextResponse.redirect()` response, so session tokens can be lost
 *      on the redirect to /dashboard.
 *
 * By reading cookies from the raw `Cookie` header and writing `Set-Cookie`
 * headers directly on the redirect response, we ensure reliable PKCE exchange
 * AND reliable session persistence across the redirect.
 */
export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const code = requestUrl.searchParams.get("code");
    const providerError = requestUrl.searchParams.get("error");

    if (providerError) {
      console.error("OAuth provider returned error", providerError);
      return redirectWithError(request, "auth_provider_error");
    }

    if (!code) {
      console.error("Auth callback missing code parameter");
      return redirectWithError(request, "missing_code");
    }

    // ── Build Supabase client with explicit HTTP-level cookie handling ──

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const supabaseKey = (
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )?.trim();

    if (!supabaseUrl || !supabaseKey) {
      console.error("Auth callback: missing Supabase env vars");
      return redirectWithError(request, "auth_callback_unexpected");
    }

    // Read cookies from the raw Cookie header — not from next/headers.
    const rawCookieHeader = request.headers.get("cookie") ?? "";
    const requestCookies = parseCookieHeader(rawCookieHeader).map((c) => ({
      name: c.name,
      value: c.value ?? "",
    }));

    // Diagnostic: log cookie names (not values) so we can verify the
    // code_verifier cookie is present in production logs.
    const cookieNames = requestCookies.map((c) => c.name);
    console.log("Auth callback cookies received:", cookieNames);

    // Collect Set-Cookie headers that the Supabase client wants to write.
    const responseCookies = new Headers();

    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return requestCookies;
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            responseCookies.append(
              "Set-Cookie",
              serializeCookieHeader(name, value, options),
            );
          });
        },
      },
    });

    // ── Exchange the auth code for a session ──

    const { error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(code);

    if (exchangeError) {
      console.error("exchangeCodeForSession failed", {
        message: exchangeError.message,
        code: exchangeError.code,
        status: exchangeError.status,
      });

      // Fallback: if the code was already used (e.g. browser retry),
      // a valid session may already exist in cookies.
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        console.log("Auth callback: exchange failed but session exists, proceeding");
        const response = NextResponse.redirect(
          new URL("/dashboard", getRequestOrigin(request)),
        );
        responseCookies.getSetCookie().forEach((cookie) => {
          response.headers.append("Set-Cookie", cookie);
        });
        return response;
      }

      return redirectWithError(request, "auth_callback_failed", responseCookies);
    }

    // ── Success: redirect to dashboard with session cookies ──

    const response = NextResponse.redirect(
      new URL("/dashboard", getRequestOrigin(request)),
    );
    responseCookies.getSetCookie().forEach((cookie) => {
      response.headers.append("Set-Cookie", cookie);
    });
    return response;
  } catch (error) {
    console.error("Auth callback unexpected error", error);
    return redirectWithError(request, "auth_callback_unexpected");
  }
}
