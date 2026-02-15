import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import BookmarkList from "@/app/dashboard/_components/BookmarkList";
import LogoutButton from "@/app/dashboard/_components/LogoutButton";
import type { Bookmark } from "@/types/bookmark";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const { data: bookmarks } = await supabase
    .from("bookmarks")
    .select("id, title, url, created_at")
    .order("created_at", { ascending: false });

  const initialBookmarks: Bookmark[] = bookmarks ?? [];

  return (
    <div className="min-h-screen bg-zinc-100 p-6">
      <main className="mx-auto w-full max-w-3xl rounded-xl bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-900">Dashboard</h1>
            <p className="mt-2 text-sm text-zinc-600">Signed in as:</p>
            <p className="mt-1 break-all text-sm font-medium text-zinc-900">{user.email}</p>
          </div>

          <LogoutButton />
        </div>

        <div className="mt-8">
          <BookmarkList initialBookmarks={initialBookmarks} userId={user.id} />
        </div>
      </main>
    </div>
  );
}
