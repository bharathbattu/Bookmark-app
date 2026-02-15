"use client";

import { useState } from "react";
import { createBrowserSupabaseClient } from "@/utils/supabase/client";
import type { Bookmark } from "@/types/bookmark";

type BookmarkItemProps = {
  bookmark: Bookmark;
  onDeleted: (bookmarkId: string) => void;
};

export default function BookmarkItem({ bookmark, onDeleted }: BookmarkItemProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    try {
      setIsDeleting(true);
      const supabase = createBrowserSupabaseClient();

      const { error } = await supabase.from("bookmarks").delete().eq("id", bookmark.id);

      if (error) {
        console.error("Failed to delete bookmark", { message: error.message, code: error.code });
        return;
      }

      onDeleted(bookmark.id);
    } catch (error) {
      console.error("Failed to delete bookmark", error);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <article className="flex items-start justify-between gap-4 rounded-lg border border-zinc-200 p-4">
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold text-zinc-900">{bookmark.title}</h3>
        <a
          href={bookmark.url}
          target="_blank"
          rel="noreferrer"
          className="mt-1 block truncate text-sm text-zinc-600 hover:text-zinc-900"
        >
          {bookmark.url}
        </a>
      </div>

      <button
        type="button"
        onClick={handleDelete}
        disabled={isDeleting}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isDeleting ? "Deleting..." : "Delete"}
      </button>
    </article>
  );
}
