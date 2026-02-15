# Smart Bookmark App

A real-time bookmark manager with Google OAuth, per-user data isolation, and cross-tab synchronization. Built as a full-stack screening challenge submission.

---

## Project Overview

Smart Bookmark App allows authenticated users to save and delete bookmarks (URL + title). Each user's data is private and enforced at the database level via Row Level Security. Changes propagate in real time across all open browser tabs for the same user.

### Core Capabilities

- Google OAuth sign-in (only auth method)
- Add bookmarks (title + URL)
- Delete bookmarks
- Real-time sync across tabs (INSERT + DELETE)
- Per-user data isolation (RLS enforced)
- Route protection via middleware

### What Is Intentionally Not Included

- No bookmark editing/UPDATE
- No optimistic UI
- No external state management library
- No service-role key usage in application code

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript) |
| Auth | Supabase Auth (Google OAuth, PKCE flow) |
| Database | Supabase PostgreSQL |
| Realtime | Supabase Realtime (postgres_changes) |
| Styling | Tailwind CSS 4 |
| SSR Auth | @supabase/ssr (cookie-based sessions) |
| Deployment | Vercel |

---

## Architecture Overview

```
app/
├── layout.tsx                 # Root layout (Server Component)
├── page.tsx                   # Landing page with Google sign-in
├── globals.css                # Tailwind + theme
├── _components/
│   └── GoogleSignInButton.tsx # Client Component — triggers OAuth
├── auth/
│   └── callback/
│       └── route.ts           # Route Handler — exchanges code for session
└── dashboard/
    ├── page.tsx               # Server Component — auth check + initial data
    └── _components/
        ├── BookmarkList.tsx   # Client Component — state + realtime subscription
        ├── BookmarkForm.tsx   # Client Component — add bookmark form
        ├── BookmarkItem.tsx   # Client Component — single row + delete
        ├── LogoutButton.tsx   # Client Component — sign out
        └── SessionGuard.tsx   # Client Component — cross-tab session integrity

utils/supabase/
├── client.ts                  # Browser client (createBrowserClient)
├── server.ts                  # Server Component client (createServerClient + cookies)
└── middleware.ts              # Middleware client (session refresh + auth check)

proxy.ts                       # Next.js 16 middleware — session refresh + route guard
supabase/schema.sql            # Full database schema (table, RLS, realtime)
```

### Server vs Client Component Split

| Component | Type | Reason |
|---|---|---|
| `layout.tsx` | Server | Static shell, no interactivity |
| `page.tsx` (landing) | Server | Renders sign-in button via Client child |
| `dashboard/page.tsx` | Server | SSR auth check + initial data fetch |
| `BookmarkList.tsx` | Client | Manages state + realtime subscription |
| `BookmarkForm.tsx` | Client | Form input + submit handler |
| `BookmarkItem.tsx` | Client | Delete button handler |
| `LogoutButton.tsx` | Client | Sign-out action |
| `SessionGuard.tsx` | Client | Detects cross-tab session mismatches |
| `GoogleSignInButton.tsx` | Client | OAuth trigger |

---

## Authentication Flow

```
User clicks "Sign in with Google"
  → supabase.auth.signInWithOAuth({ provider: 'google' })
  → Supabase redirects to Google consent screen
  → Google returns auth code to Supabase
  → Supabase redirects to /auth/callback?code=...
  → Route Handler exchanges code for session via exchangeCodeForSession()
  → Session cookies are set
  → User is redirected to /dashboard
```

### Session Management

- Cookie-based sessions via `@supabase/ssr`.
- Three isolated Supabase client utilities (browser, server, middleware) each handle cookies in their respective context.
- Proxy (Next.js 16 middleware) runs on **every request** (excluding static assets and `/auth/callback`), calls `supabase.auth.getUser()` (server-validated, not JWT-only), keeps session cookies fresh, and redirects to `/` if an unauthenticated user tries to access `/dashboard`.
- **`/auth/callback` is explicitly skipped** by the proxy to prevent `updateSession()` from corrupting the PKCE `code_verifier` cookie before `exchangeCodeForSession()` reads it (see Challenge #11).
- Dashboard page performs a redundant server-side `getUser()` check before rendering (defense in depth).
- **`SessionGuard`** (invisible client component) runs on the dashboard and detects cross-tab session mismatches via `visibilitychange`, `focus`, and `onAuthStateChange` events. On mismatch it triggers a data refresh; on session loss it redirects to `/` (see Challenge #10).

### OAuth Callback Safety

- Missing `code` parameter → redirects to `/?error=missing_code`.
- Failed session exchange → checks if a valid session already exists (handles browser retries where the code was already used). If no session, redirects to `/?error=auth_callback_failed`.
- Unexpected exception → redirects to `/?error=auth_callback_unexpected`.
- Origin resolution has fallback for edge environments (checks `VERCEL_PROJECT_PRODUCTION_URL`).
- Exchange errors are logged with message/code/status for diagnostics.

---

## Database & RLS Design

### Table: `bookmarks`

```sql
CREATE TABLE public.bookmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bookmarks_user_id ON public.bookmarks(user_id);
```

### Row Level Security

```sql
ALTER TABLE public.bookmarks ENABLE ROW LEVEL SECURITY;

-- SELECT: users see only their own bookmarks
CREATE POLICY "Users can view own bookmarks"
  ON public.bookmarks FOR SELECT
  USING ((select auth.uid()) = user_id);

-- INSERT: users can only create bookmarks for themselves
CREATE POLICY "Users can insert own bookmarks"
  ON public.bookmarks FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

-- DELETE: users can only delete their own bookmarks
CREATE POLICY "Users can delete own bookmarks"
  ON public.bookmarks FOR DELETE
  USING ((select auth.uid()) = user_id);
```

### Design Decisions

| Decision | Rationale |
|---|---|
| No UPDATE policy | Editing is out of scope. Absence of policy = no update possible. |
| `ON DELETE CASCADE` on FK | User account deletion auto-cleans bookmarks. |
| `(select auth.uid()) = user_id` on all policies | Every operation scoped to authenticated user. No cross-user data leakage. |
| No service-role key in app code | Client always uses publishable/anon key. RLS is the security boundary. |

---

## Realtime Design

### Subscription Setup

`BookmarkList.tsx` subscribes to `postgres_changes` on the `bookmarks` table, filtered by the current user's ID. The subscription is **deferred until the auth session is confirmed** via `onAuthStateChange` to avoid the race condition where the WebSocket connects before the JWT is loaded (see Challenge #3):

```
// Wait for auth session before subscribing
supabase.auth.onAuthStateChange((_event, session) => {
  if (session) {
    channel = supabase
      .channel(`bookmarks-realtime-${userId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'bookmarks',
        filter: `user_id=eq.${userId}`
      }, handleInsert)
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'bookmarks',
        filter: `user_id=eq.${userId}`
      }, handleDelete)
      .subscribe()
  }
})
```

### Safety Measures

- **Auth-aware subscription**: Channel is created only after `INITIAL_SESSION` event fires, ensuring the WebSocket carries a valid JWT for RLS evaluation.
- **Duplicate prevention**: INSERT handler checks if bookmark ID already exists in local state before appending.
- **Safe removal**: DELETE handler removes by ID from `payload.old.id` (available because replica identity is FULL).
- **Cleanup**: `useEffect` cleanup unsubscribes the auth listener, then calls `supabase.removeChannel(channel)`.
- **Cancellation guard**: An `isCancelled` flag prevents channel setup if the component unmounts during the async auth check.
- **No re-subscription**: `useEffect` dependency is `[userId]` only; no spurious re-renders cause new subscriptions.

### Strategy: Server-Fetch + Immediate Local Update + Realtime Sync

1. Initial load: server-side fetch in `dashboard/page.tsx`, passed as props.
2. Add: INSERT into Supabase → on success, local state updated immediately → Realtime INSERT event fires → deduplicated (already in state).
3. Delete: DELETE from Supabase → on success, local state updated immediately → Realtime DELETE event fires → no-op (already removed).
4. Cross-tab: only the Realtime event arrives (no local update from another tab), so the handler adds/removes the bookmark.

### Realtime Publication (Required)

```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'bookmarks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bookmarks;
  END IF;
END
$$;
```

> Without this step, realtime subscriptions connect silently but emit no events.

---

## Environment Variables Setup

Create `.env.local` in the project root:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=sb_publishable_...
```

The app supports three env variable names for the key (checked in order):
1. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
2. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`
3. `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Use whichever name your Supabase dashboard provides. No server-side secret keys are required.

---

## Supabase Configuration Steps

1. Create a Supabase project at [supabase.com](https://supabase.com).
2. Go to **SQL Editor** and run the full contents of `supabase/schema.sql`.
3. Go to **Authentication → Providers** and enable **Google**.
4. Enter your Google OAuth Client ID and Client Secret (from Google Cloud Console).
5. Go to **Authentication → URL Configuration**:
   - **Site URL**: `http://localhost:3000` (local) or `https://your-app.vercel.app` (production)
   - **Redirect URLs**: add `http://localhost:3000/auth/callback` and `https://your-app.vercel.app/auth/callback`
6. Copy the project URL and publishable/anon key into `.env.local`.

---

## Google OAuth Configuration Steps

1. Go to [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials).
2. Create an **OAuth 2.0 Client ID** (Web application type).
3. Add **Authorized redirect URI**:
   ```
   https://<your-project-ref>.supabase.co/auth/v1/callback
   ```
4. Copy the Client ID and Client Secret into Supabase → Authentication → Google provider settings.

> The redirect URI must match exactly. No trailing slash. No http/https mismatch.

---

## Local Development

```bash
# Install dependencies
npm install

# Run database schema (in Supabase SQL Editor)
# Paste contents of supabase/schema.sql

# Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Vercel Deployment Steps

1. Push project to a GitHub repository.
2. Import the repo at [vercel.com/new](https://vercel.com/new).
3. Add environment variables in Vercel → Settings → Environment Variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` (or whichever key name you use)
4. Deploy.
5. After deployment, update:
   - Supabase → Authentication → URL Configuration → **Site URL** to `https://your-app.vercel.app`
   - Supabase → Authentication → URL Configuration → **Redirect URLs** to include `https://your-app.vercel.app/auth/callback`

---

## Production Smoke-Test Checklist

### Authentication
- [ ] App loads at production URL
- [ ] Google sign-in redirects to consent screen
- [ ] After consent, redirected to `/dashboard`
- [ ] Session persists after page refresh
- [ ] Sign out redirects to `/`
- [ ] Accessing `/dashboard` when unauthenticated redirects to `/`

### CRUD  
- [ ] Can add a bookmark (title + URL)
- [ ] Bookmark appears in list
- [ ] Can delete a bookmark
- [ ] Empty title/URL submission is blocked

### Realtime
- [ ] Open two browser tabs (same user)
- [ ] Add bookmark in Tab A → appears in Tab B
- [ ] Delete bookmark in Tab B → disappears from Tab A

### Security
- [ ] User A's bookmarks are not visible to User B
- [ ] No console errors during normal operation

---

## Challenges Faced & Solutions

### 1. Supabase Publishable Key Migration

**Problem**: Supabase recently renamed the public API key from "anon key" to "publishable key", changing the environment variable naming convention. The `.env.local` used `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`, but the original code expected `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

**Solution**: Implemented a three-tier fallback in all Supabase client utilities (`PUBLISHABLE_KEY` → `PUBLISHABLE_DEFAULT_KEY` → `ANON_KEY`), ensuring compatibility regardless of which naming convention is used.

### 2. Realtime Subscriptions Silently Failing (Publication Missing)

**Problem**: The `bookmarks` table was not added to the `supabase_realtime` publication. Realtime channels connected successfully but never emitted events — no errors, no warnings.

**Solution**: Added an idempotent `DO $$ ... END $$` block to `schema.sql` that checks `pg_publication_tables` before running `ALTER PUBLICATION`, making the script safe to execute repeatedly.

### 3. Real-Time Cross-Tab Sync Not Working (Auth Race Condition)

**Problem**: This was the hardest bug to diagnose. Real-time sync between two browser tabs (e.g., standard + incognito) was completely broken — adding a bookmark in Tab A never appeared in Tab B, and deleting in Tab B never removed from Tab A.

**Root cause**: `createBrowserClient` from `@supabase/ssr` loads the user's JWT from cookies **asynchronously** (in a microtask during internal `_initialize()`). The original code subscribed to the Realtime channel **synchronously** inside `useEffect`, before the JWT was available:

```ts
// BROKEN — subscribes before auth token is loaded
useEffect(() => {
  const supabase = createBrowserSupabaseClient();
  const channel = supabase.channel(...).on(...).subscribe(); // fires immediately
}, [userId]);
```

The WebSocket connected with only the anonymous key. Supabase Realtime evaluates RLS policies server-side using the client's JWT — with an anonymous token, `auth.uid()` returns `NULL`, so the SELECT policy (`auth.uid() = user_id`) rejected every event. The subscription appeared healthy but silently received nothing.

**Solution**: Deferred the channel subscription until `onAuthStateChange` fires the `INITIAL_SESSION` event, which guarantees the JWT is loaded. Crucially, Supabase's internal auth listener (registered in the constructor) calls `realtime.setAuth(token)` **before** external listeners fire, so by the time `setupChannel()` runs the WebSocket already carries the authenticated token:

```ts
// FIXED — waits for auth before subscribing
useEffect(() => {
  const supabase = createBrowserSupabaseClient();
  let channel = null;

  function setupChannel() {
    if (channel) return;
    channel = supabase.channel(...).on(...).subscribe();
  }

  const { data: { subscription } } = supabase.auth.onAuthStateChange(
    (_event, session) => { if (session) setupChannel(); }
  );

  return () => { subscription.unsubscribe(); /* cleanup channel */ };
}, [userId]);
```

### 4. DELETE Events Missing Old-Row Data

**Problem**: Supabase Realtime `postgres_changes` DELETE events only include the columns covered by the table's replica identity. The default replica identity is `DEFAULT` (primary key only), which means `payload.old` contains only `{ id }` — the `user_id` field needed for the subscription filter (`user_id=eq.${userId}`) was missing, so DELETE events were silently dropped by the filter.

**Solution**: Set the replica identity to `FULL` via a Supabase migration:

```sql
ALTER TABLE public.bookmarks REPLICA IDENTITY FULL;
```

With `FULL`, every DELETE event includes all column values in `payload.old`, allowing both the user-scoped filter and the client-side removal logic to work correctly.

### 5. Next.js 16 Renamed `middleware.ts` to `proxy.ts`

**Problem**: Next.js 16 introduced a breaking change — the middleware entry point was renamed from `middleware.ts` to `proxy.ts`, and the exported function from `middleware` to `proxy`. The project initially had the file named `proxy.ts` with the correct export, but during a fix attempt we created a `middleware.ts` alongside it. Next.js 16 detected both files and refused to build:

```
Error: Both middleware file "./middleware.ts" and proxy file "./proxy.ts"
are detected. Please use "./proxy.ts" only.
```

**Solution**: Deleted `middleware.ts` and kept `proxy.ts` as the single entry point, using the Next.js 16 convention (`export async function proxy(...)`).

### 6. Proxy Matcher Too Narrow — Stale Session Cookies

**Problem**: The original `proxy.ts` only matched `/dashboard/:path*`:

```ts
export const config = { matcher: ["/dashboard/:path*"] };
```

This meant session cookies were only refreshed when visiting dashboard routes. On other routes (`/`, `/auth/callback`), Supabase never called `getUser()` to refresh the access token. Over time, the browser-side JWT could expire without being renewed, causing auth failures and broken Realtime connections.

**Solution**: Expanded the matcher to cover all routes except static assets, matching the [official Supabase SSR pattern](https://supabase.com/docs/guides/auth/server-side/nextjs):

```ts
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

Dashboard route protection (redirect to `/` if unauthenticated) is handled inside the proxy function itself, not by the matcher.

### 7. OAuth Callback Edge Cases in Production

**Problem**: If the callback route received a malformed request or an unexpected error occurred during session exchange, it could result in an unhandled exception or a confusing blank page.

**Solution**: Wrapped the entire callback handler in a try/catch with safe fallback origin resolution. All error paths redirect to `/?error=<code>` instead of throwing.

### 8. Input Text Invisible in Dark Mode

**Problem**: The Title and URL input fields in the bookmark form had no explicit text color. They inherited `color: var(--foreground)` from the body's global CSS. When the user's OS preferred dark mode, `--foreground` resolved to `#ededed` (near-white) — but the input background remained the browser default white. Result: white text on white background, making typed text invisible.

**Solution**: Added explicit Tailwind classes to pin the input styling regardless of color scheme:

```diff
- className="... text-sm"
+ className="... text-sm text-zinc-900 bg-white placeholder:text-zinc-400"
```

### 9. ESLint 10 Incompatibility

**Problem**: Upgrading to ESLint 10 broke linting because `eslint-config-next` and `eslint-plugin-react` do not yet support ESLint 10's API changes.

**Solution**: Pinned ESLint to the latest compatible v9 release (`^9.39.2`) until the Next.js ESLint ecosystem catches up.

### 10. Cross-Tab Session Bleed (Cookie Sharing)

**Problem**: In a single browser, cookies are shared across all tabs. If a user signs in as Account A in one tab and Account B in another (or signs out in one tab), the session cookies are overwritten globally. Any stale tab continues to show the old user's data and Realtime subscription — meaning User A could momentarily see User B's bookmark changes arrive via the still-connected WebSocket, or continue operating on a session that no longer exists.

**Solution**: Created a `SessionGuard` client component that runs invisibly on the dashboard. It:
1. Accepts the `serverUserId` (from the SSR auth check) as a prop.
2. On `visibilitychange` and `focus` events (i.e., when the user switches back to a tab), calls `supabase.auth.getUser()` and compares the result to `serverUserId`.
3. Listens to `onAuthStateChange` for `SIGNED_OUT` / `TOKEN_REFRESHED` / `SIGNED_IN` events.
4. If the user ID has changed → calls `router.refresh()` to re-run the server component (which re-validates auth and re-fetches data).
5. If the session is gone → redirects to `/`.

Additionally, `BookmarkList.tsx` was hardened: its `onAuthStateChange` handler verifies `session.user.id === userId` before setting up the Realtime channel, and tears down the channel if the user ID no longer matches.

### 11. Intermittent "Authentication Failed During Sign-In" (PKCE Cookie Corruption)

**Problem**: Users intermittently saw "Authentication failed during sign-in" after the Google consent screen, despite valid credentials. The error was non-deterministic — the same user could retry and succeed.

**Root cause** (three compounding issues):
1. **Proxy middleware running on `/auth/callback`**: The proxy called `updateSession()` → `getUser()` on every route, including `/auth/callback`. This could read/modify session cookies **before** the callback route handler ran `exchangeCodeForSession()`, corrupting the PKCE `code_verifier` cookie that the exchange needs.
2. **No fallback for already-used auth codes**: If the browser retried the callback request (e.g., due to a network hiccup) or the code was already exchanged by the proxy's `getUser()` call, `exchangeCodeForSession()` would fail — even though a valid session already existed in cookies.
3. **Unnecessary `signOut({ scope: "local" })` before OAuth**: The sign-in button called `signOut()` before `signInWithOAuth()` to "clean up" stale sessions. This deleted local cookies including the PKCE `code_verifier`, so if the sign-out cleared state that the in-flight OAuth redirect depended on, the exchange would fail.

**Solution** (three targeted fixes):
1. **`proxy.ts`**: Added early return for `/auth/callback` path before `updateSession()` runs — the callback route handles its own session establishment.
2. **`app/auth/callback/route.ts`**: When `exchangeCodeForSession()` fails, now falls back to `getUser()` to check if a valid session already exists. If so, proceeds normally to `/dashboard`. Added `console.error` logging for failed exchanges.
3. **`GoogleSignInButton.tsx`**: Removed the `signOut({ scope: "local" })` call. The `prompt: "select_account"` query param already forces Google to show the account picker, making the sign-out redundant.

---

## Security Decisions

| Decision | Rationale |
|---|---|
| `getUser()` over `getSession()` in server contexts | `getUser()` validates the token against Supabase's auth server. `getSession()` only reads the JWT locally without verification. |
| No service-role key in application | All client operations use the publishable/anon key. RLS is the real security gate. |
| RLS on every operation | SELECT, INSERT, DELETE all scoped to `auth.uid() = user_id`. No policy = no access. |
| No UPDATE policy | Intentionally omitted. Without a policy, PostgreSQL RLS blocks all update attempts. |
| Middleware route protection | `/dashboard` is guarded server-side before rendering. No flash of unauthenticated content. |
| Double auth check | Middleware checks auth, and the dashboard page checks again. Defense in depth. |
| Proxy skips `/auth/callback` | Prevents PKCE cookie corruption during OAuth code exchange. |
| SessionGuard cross-tab monitor | Detects session mismatches from cookie sharing across tabs; refreshes or redirects. |
| Realtime user-id verification | `BookmarkList` verifies `session.user.id === userId` before channel setup; tears down on mismatch. |

---

## If I Had More Time

- **Bookmark editing** — Add an UPDATE flow with an inline edit UI and corresponding RLS policy.
- **Bookmark categories/tags** — Allow users to organize bookmarks into groups.
- **URL metadata auto-fetch** — Scrape page title and favicon on bookmark creation.
- **Optimistic UI** — Show immediate local state changes with rollback on failure, reducing perceived latency.
- **Search/filter** — Full-text search across titles and URLs.
- **Pagination** — Cursor-based pagination for users with many bookmarks.
- **E2E tests** — Playwright tests covering auth flow, CRUD, and realtime scenarios.
- **Rate limiting** — Protect insert/delete endpoints from abuse.
- **PWA support** — Offline reading list with service worker caching.
