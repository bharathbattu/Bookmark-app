"use client";

import { useEffect, useState } from "react";
import { createBrowserSupabaseClient } from "@/utils/supabase/client";
import BookmarkForm from "./BookmarkForm";
import BookmarkItem from "./BookmarkItem";
import type { Bookmark } from "@/types/bookmark";
import type { RealtimeChannel } from "@supabase/supabase-js";

type BookmarkListProps = {
  initialBookmarks: Bookmark[];
  userId: string;
};

export default function BookmarkList({ initialBookmarks, userId }: BookmarkListProps) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(initialBookmarks);

  const handleBookmarkAdded = (bookmark: Bookmark) => {
    setBookmarks((prev) => {
      if (prev.some((item) => item.id === bookmark.id)) {
        return prev;
      }

      return [bookmark, ...prev];
    });
  };

  const handleBookmarkDeleted = (bookmarkId: string) => {
    setBookmarks((prev) => prev.filter((bookmark) => bookmark.id !== bookmarkId));
  };

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    let channel: RealtimeChannel | null = null;
    let isCancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 10;
    const BASE_DELAY_MS = 1_000;

    /**
     * Create the Realtime channel and subscribe to INSERT / DELETE events.
     *
     * This is called only AFTER the auth session is confirmed so the
     * WebSocket connection carries a valid access-token and Supabase
     * Realtime can evaluate RLS policies with the correct `auth.uid()`.
     */
    function setupChannel() {
      if (channel || isCancelled) return;

      channel = supabase
        .channel(`bookmarks-realtime-${userId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "bookmarks",
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            const inserted = payload.new as Bookmark;
            setBookmarks((prev) => {
              if (prev.some((b) => b.id === inserted.id)) return prev;
              return [inserted, ...prev];
            });
          },
        )
        .on(
          "postgres_changes",
          {
            event: "DELETE",
            schema: "public",
            table: "bookmarks",
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            const deleted = payload.old as { id: string };
            setBookmarks((prev) => prev.filter((b) => b.id !== deleted.id));
          },
        )
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            console.error("Bookmark realtime channel disconnected", status);

            if (channel) {
              supabase.removeChannel(channel);
              channel = null;
            }

            if (!isCancelled && !reconnectTimer && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
              const delay = Math.min(BASE_DELAY_MS * 2 ** reconnectAttempts, 30_000);
              reconnectAttempts++;
              reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                setupChannel();
              }, delay);
            } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
              console.error("Bookmark realtime: max reconnect attempts reached, giving up.");
            }
          } else if (status === "SUBSCRIBED") {
            reconnectAttempts = 0;
          }
        });
    }

    // ------------------------------------------------------------------
    // KEY FIX: Wait for the auth session before subscribing.
    //
    // `onAuthStateChange` fires an `INITIAL_SESSION` event once the
    // client has loaded the JWT from cookies.  The internal Supabase
    // listener (registered in the SupabaseClient constructor) calls
    // `realtime.setAuth(token)` *before* our external listener fires,
    // so by the time `setupChannel()` runs the WebSocket already
    // carries the authenticated token.
    // ------------------------------------------------------------------
    const {
      data: { subscription: authListener },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setupChannel();
      }
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setupChannel();
      }
    });

    return () => {
      isCancelled = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      authListener.unsubscribe();
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [userId]);

  return (
    <section>
      <BookmarkForm onAdded={handleBookmarkAdded} />

      <div className="mt-6 space-y-3">
        {bookmarks.length === 0 ? (
          <p className="text-sm text-zinc-500">No bookmarks yet.</p>
        ) : (
          bookmarks.map((bookmark) => (
            <BookmarkItem
              key={bookmark.id}
              bookmark={bookmark}
              onDeleted={handleBookmarkDeleted}
            />
          ))
        )}
      </div>
    </section>
  );
}
