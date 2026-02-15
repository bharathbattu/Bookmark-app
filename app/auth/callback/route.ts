import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

/**
 * Resolve the canonical app origin for redirects.
 *
 * Priority order:
 *   1. Explicit NEXT_PUBLIC_APP_URL (set by the developer)
 *   2. VERCEL_PROJECT_PRODUCTION_URL (auto-set by Vercel — stable across deploys)
 *   3. VERCEL_URL (auto-set by Vercel — per-deployment, changes on each deploy)
 */
function getConfiguredOrigin() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) {
    return appUrl.replace(/\/$/, "");
  }

  const vercelProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelProductionUrl) {
    return `https://${vercelProductionUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  }

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    return `https://${vercelUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  }

  return null;
}

function getRequestOrigin(request: Request) {
  // On Vercel, x-forwarded-host is set by the edge proxy and is always correct.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto") ?? "https";

  if (host) {
    return `${protocol}://${host}`;
  }

  const configuredOrigin = getConfiguredOrigin();
  if (configuredOrigin) {
    return configuredOrigin;
  }

  try {
    const requestOrigin = new URL(request.url).origin;
    const requestHost = new URL(request.url).hostname;

    if (requestHost !== "localhost" && requestHost !== "127.0.0.1") {
      return requestOrigin;
    }
  } catch {
    return "http://localhost:3000";
  }

  return "http://localhost:3000";
}

function redirectWithError(request: Request, errorCode: string) {
  const errorUrl = new URL("/", getRequestOrigin(request));
  errorUrl.searchParams.set("error", errorCode);
  return NextResponse.redirect(errorUrl);
}

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const code = requestUrl.searchParams.get("code");
    const providerError = requestUrl.searchParams.get("error");

    if (providerError) {
      return redirectWithError(request, "auth_provider_error");
    }

    if (!code) {
      return redirectWithError(request, "missing_code");
    }

    const supabase = await createClient();

    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

    if (exchangeError) {
      return redirectWithError(request, "auth_callback_failed");
    }

    return NextResponse.redirect(new URL("/dashboard", getRequestOrigin(request)));
  } catch {
    return redirectWithError(request, "auth_callback_unexpected");
  }
}
