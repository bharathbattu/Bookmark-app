import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

function getRequestOrigin(request: Request) {
  try {
    return new URL(request.url).origin;
  } catch {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    const protocol = request.headers.get("x-forwarded-proto") ?? "https";

    if (host) {
      return `${protocol}://${host}`;
    }

    return "http://localhost:3000";
  }
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
