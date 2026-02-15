import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request,
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabasePublishableKey = (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )?.trim();

  if (!supabaseUrl || !supabasePublishableKey) {
    // Return early instead of throwing — lets the request continue so the
    // route handler can display a proper error or the page can still render.
    console.error(
      "updateSession: Missing Supabase environment variables. " +
        "Set NEXT_PUBLIC_SUPABASE_URL and one of NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
    return { response, user: null };
  }

  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({
          request,
        });

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
