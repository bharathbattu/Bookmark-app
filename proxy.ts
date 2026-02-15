import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/utils/supabase/middleware";

export async function proxy(request: NextRequest) {
  // Skip session refresh for the OAuth callback route. The callback
  // establishes a NEW session via PKCE code exchange, and running
  // updateSession() here can corrupt the code_verifier cookie before
  // exchangeCodeForSession() reads it — causing intermittent auth failures.
  if (request.nextUrl.pathname.startsWith("/auth/callback")) {
    return NextResponse.next();
  }

  try {
    // Refresh session cookies on every matched request so the browser-side
    // Supabase client always has a valid JWT available in cookies.
    const { response, user } = await updateSession(request);

    // Protect dashboard routes — redirect unauthenticated visitors to home.
    if (!user && request.nextUrl.pathname.startsWith("/dashboard")) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }

    return response;
  } catch {
    // If session refresh fails (e.g. missing env vars at edge runtime),
    // let the request continue so route handlers can still respond.
    return NextResponse.next();
  }
}

export const config = {
  matcher: [
    /*
     * Run on all routes except static assets so the session is refreshed
     * on every navigation (critical for keeping browser-side JWTs fresh).
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
