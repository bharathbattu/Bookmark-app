"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/utils/supabase/client";

type SessionGuardProps = {
  /** The user ID that the server rendered this page for. */
  serverUserId: string;
};

/**
 * Detects cross-tab session mismatches and forces a page refresh.
 *
 * Problem: In a single browser, cookies are shared across tabs. If Tab A is
 * signed in as User1 and Tab B signs in as User2, the session cookie is
 * silently overwritten. Tab A's server-rendered UI becomes stale — it still
 * shows User1's email and bookmarks while the cookie now belongs to User2.
 *
 * Solution: This component checks the actual auth session against the
 * server-provided userId in two scenarios:
 *   1. When the tab regains visibility (user switches back to it)
 *   2. When `onAuthStateChange` fires (e.g. token refresh reveals a new user)
 *
 * On mismatch it calls `router.refresh()` which re-runs the server component,
 * reads the current cookie, and renders the correct user's data. If the
 * session is gone entirely, it redirects to the sign-in page.
 */
export default function SessionGuard({ serverUserId }: SessionGuardProps) {
  const router = useRouter();
  const isChecking = useRef(false);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();

    async function checkSession() {
      // Prevent overlapping checks
      if (isChecking.current) return;
      isChecking.current = true;

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          // Session expired or signed out in another tab — go to sign-in
          window.location.href = "/";
          return;
        }

        if (user.id !== serverUserId) {
          // Different user signed in from another tab — refresh to pick up
          // the new session's data from the server component.
          router.refresh();
        }
      } catch {
        // Network error or similar — don't disrupt the current session
      } finally {
        isChecking.current = false;
      }
    }

    // --- Trigger 1: Tab becomes visible again ---
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        checkSession();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // --- Trigger 2: Auth state changes (e.g. token refresh) ---
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      // SIGNED_IN fires when a new session is established (e.g. another tab).
      // TOKEN_REFRESHED fires when the JWT is refreshed — the user may have
      // changed if another tab signed in as a different account.
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "SIGNED_OUT") {
        checkSession();
      }
    });

    // --- Trigger 3: Window regains focus (covers alt-tab, taskbar clicks) ---
    function handleFocus() {
      checkSession();
    }

    window.addEventListener("focus", handleFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      subscription.unsubscribe();
    };
  }, [serverUserId, router]);

  // This component renders nothing — it's purely behavioral.
  return null;
}
