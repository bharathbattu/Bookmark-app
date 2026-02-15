"use client";

import { useState } from "react";
import { createBrowserSupabaseClient } from "@/utils/supabase/client";

export default function GoogleSignInButton() {
  const [isLoading, setIsLoading] = useState(false);

  const getAppOrigin = () => {
    // 1. Explicit override (developer-configured)
    const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
    if (configuredAppUrl) {
      return configuredAppUrl.replace(/\/$/, "");
    }

    // 2. Vercel production URL (auto-set by Vercel, stable across deploys)
    const vercelProductionUrl = process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL?.trim();
    if (vercelProductionUrl) {
      return `https://${vercelProductionUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
    }

    // 3. Vercel deployment URL (auto-set, per-deployment)
    const vercelUrl = process.env.NEXT_PUBLIC_VERCEL_URL?.trim();
    if (vercelUrl) {
      return `https://${vercelUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
    }

    // 4. Fallback to the browser's current origin (works for local dev)
    return window.location.origin;
  };

  const handleGoogleSignIn = async () => {
    if (isLoading) {
      return;
    }

    try {
      setIsLoading(true);
      const supabase = createBrowserSupabaseClient();
      const redirectTo = `${getAppOrigin()}/auth/callback`;

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          queryParams: {
            // Forces Google to show the account picker even if the user has a
            // single account or is already signed in. This replaces the
            // previous signOut({ scope: "local" }) call, which was removed
            // because it could interfere with PKCE cookie state.
            prompt: "select_account",
          },
        },
      });
      if (error) {
        console.error("Google sign-in failed", { message: error.message, code: error.code });
      }
    } catch (error) {
      console.error("Google sign-in failed", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleGoogleSignIn}
      disabled={isLoading}
      className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isLoading ? "Redirecting..." : "Sign in with Google"}
    </button>
  );
}
