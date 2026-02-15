"use client";

import { useState } from "react";
import { createBrowserSupabaseClient } from "@/utils/supabase/client";

export default function GoogleSignInButton() {
  const [isLoading, setIsLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    if (isLoading) {
      return;
    }

    try {
      setIsLoading(true);
      const supabase = createBrowserSupabaseClient();
      const redirectTo = `${window.location.origin}/auth/callback`;

      await supabase.auth.signOut({ scope: "local" });

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          queryParams: {
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
