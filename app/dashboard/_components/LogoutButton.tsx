"use client";

import { useState } from "react";
import { createBrowserSupabaseClient } from "@/utils/supabase/client";

export default function LogoutButton() {
  const [isLoading, setIsLoading] = useState(false);

  const handleLogout = async () => {
    try {
      setIsLoading(true);
      const supabase = createBrowserSupabaseClient();
      const { error } = await supabase.auth.signOut({ scope: "global" });

      if (error) {
        console.error("Sign out failed", { message: error.message, code: error.code });
        return;
      }

      window.location.href = "/";
    } catch (error) {
      console.error("Sign out failed", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={isLoading}
      className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isLoading ? "Signing out..." : "Sign out"}
    </button>
  );
}
