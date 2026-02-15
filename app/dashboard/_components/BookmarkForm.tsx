"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { createBrowserSupabaseClient } from "@/utils/supabase/client";
import type { Bookmark } from "@/types/bookmark";

type BookmarkFormProps = {
  onAdded: (bookmark: Bookmark) => void;
};

export default function BookmarkForm({ onAdded }: BookmarkFormProps) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedTitle = title.trim();
    const trimmedUrl = url.trim();

    if (!trimmedTitle || !trimmedUrl) {
      setErrorMessage("Title and URL are required.");
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(trimmedUrl);
    } catch {
      setErrorMessage("Please enter a valid URL (e.g. https://example.com).");
      return;
    }

    const allowedProtocols = ["http:", "https:"];
    if (!allowedProtocols.includes(parsedUrl.protocol)) {
      setErrorMessage("Only http and https URLs are allowed.");
      return;
    }

    try {
      setIsLoading(true);
      setErrorMessage("");

      const supabase = createBrowserSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setErrorMessage("You must be signed in.");
        return;
      }

      const { data, error } = await supabase
        .from("bookmarks")
        .insert({
          title: trimmedTitle,
          url: parsedUrl.href,
          user_id: user.id,
        })
        .select("id, title, url, created_at")
        .single();

      if (error) {
        setErrorMessage(error.message);
        return;
      }

      if (data) {
        onAdded(data as Bookmark);
      }

      setTitle("");
      setUrl("");
    } catch (error) {
      console.error("Failed to add bookmark", error);
      setErrorMessage("Unable to add bookmark. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-zinc-200 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          type="text"
          placeholder="Title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400"
        />
        <input
          type="url"
          placeholder="URL"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400"
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : <span />}
        <button
          type="submit"
          disabled={isLoading}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? "Adding..." : "Add bookmark"}
        </button>
      </div>
    </form>
  );
}
