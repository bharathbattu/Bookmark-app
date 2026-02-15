# Smart Bookmark App

A bookmark manager app where users can sign in with Google, save bookmarks, delete them, and see changes in real-time across browser tabs. Built with Next.js, Supabase, and Tailwind CSS.

**Live URL**: [https://bookmark-app-sable.vercel.app](https://bookmark-app-sable.vercel.app)

---

## Features

- Sign in with Google (only sign-in method)
- Add bookmarks with a title and URL
- Delete bookmarks
- Real-time updates across tabs — if you add a bookmark in one tab it shows up in another tab automatically
- Each user can only see their own bookmarks (enforced with Row Level Security in Supabase)
- Protected routes — you can't access the dashboard without being logged in

---

## Tech Stack

- **Next.js 16** (App Router, TypeScript)
- **Supabase** — Auth (Google OAuth), PostgreSQL database, Realtime
- **Tailwind CSS 4**
- **@supabase/ssr** — for cookie-based auth sessions
- **Vercel** — deployment

---

## Project Structure

```
app/
├── page.tsx                    # Landing page with sign-in button
├── layout.tsx                  # Root layout
├── globals.css                 # Tailwind styles
├── _components/
│   └── GoogleSignInButton.tsx  # Google sign-in button
├── auth/callback/
│   └── route.ts                # Handles the OAuth callback
└── dashboard/
    ├── page.tsx                # Main dashboard (server component)
    └── _components/
        ├── BookmarkList.tsx    # Bookmark list with realtime
        ├── BookmarkForm.tsx    # Form to add bookmarks
        ├── BookmarkItem.tsx    # Single bookmark with delete
        ├── LogoutButton.tsx    # Logout button
        └── SessionGuard.tsx    # Checks if session is still valid

utils/supabase/
├── client.ts                   # Browser supabase client
├── server.ts                   # Server supabase client
└── middleware.ts               # Middleware supabase client

proxy.ts                        # Next.js 16 middleware (session refresh)
supabase/schema.sql             # Database schema
```

---

## How Auth Works

1. User clicks "Sign in with Google"
2. Supabase redirects to Google's consent screen
3. Google sends an auth code back to Supabase
4. Supabase redirects to `/auth/callback` with the code
5. The callback route exchanges the code for a session using `exchangeCodeForSession()`
6. Session cookies are set and user gets redirected to `/dashboard`

The middleware (`proxy.ts`) runs on every request to keep session cookies fresh. It also redirects unauthenticated users away from `/dashboard`.

---

## Database

There's one table called `bookmarks`:

```sql
CREATE TABLE public.bookmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Row Level Security

RLS is enabled so users can only see/add/delete their own bookmarks:

- SELECT — `auth.uid() = user_id`
- INSERT — `auth.uid() = user_id`
- DELETE — `auth.uid() = user_id`

There's no UPDATE policy because editing bookmarks is not part of the requirements.

---

## Realtime

The `BookmarkList` component subscribes to Supabase Realtime (`postgres_changes`) for INSERT and DELETE events on the bookmarks table, filtered by the user's ID.

One thing I had to figure out was that the realtime subscription needs to wait for the auth session to be ready before subscribing, otherwise the WebSocket doesn't have the right token and RLS blocks everything silently.

I also had to set `REPLICA IDENTITY FULL` on the bookmarks table so that DELETE events include all the row data (by default it only sends the primary key, which wasn't enough for the user_id filter).

---

## Setup

### Environment Variables

Create a `.env.local` file:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=sb_publishable_...
```

The app checks for the key in this order: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Use whichever one your Supabase dashboard gives you.

### Supabase Setup

1. Create a project on [supabase.com](https://supabase.com)
2. Run `supabase/schema.sql` in the SQL Editor
3. Enable Google provider in Authentication → Providers
4. Set the Site URL and Redirect URLs in Authentication → URL Configuration
5. Copy the project URL and key into `.env.local`

### Google OAuth Setup

1. Go to Google Cloud Console → APIs & Services → Credentials
2. Create an OAuth 2.0 Client ID (Web application)
3. Add `https://<your-project-ref>.supabase.co/auth/v1/callback` as a redirect URI
4. Put the Client ID and Secret into Supabase's Google provider settings

### Run Locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Deploy to Vercel

1. Push to GitHub
2. Import repo on [vercel.com/new](https://vercel.com/new)
3. Add the environment variables in Vercel settings
4. Deploy
5. Update Supabase Site URL and Redirect URLs to match your Vercel domain

---

## Challenges I Ran Into

### Supabase key naming change

Supabase renamed the "anon key" to "publishable key" recently, so the env variable name changed. I added a fallback that checks multiple names so it works either way.

### Realtime not working at all

Took me a while to figure out the bookmarks table needs to be added to the `supabase_realtime` publication. Without it, the subscription connects fine but no events come through. No errors either which made it hard to debug.

### Cross-tab sync broken (auth race condition)

The realtime subscription was connecting before the auth token was loaded from cookies. So the WebSocket only had the anon key and RLS was blocking all events. Fixed it by waiting for `onAuthStateChange` to fire before setting up the channel.

### DELETE events not coming through

Default replica identity only sends the primary key in DELETE events. The `user_id` filter needs the full row data, so I had to set `REPLICA IDENTITY FULL`.

### Next.js 16 middleware rename

Next.js 16 renamed `middleware.ts` to `proxy.ts`. I had both files at one point and the build refused to work. Deleted the old one and kept `proxy.ts`.

### Session cookies going stale

The middleware matcher was only running on `/dashboard` routes. Other pages never refreshed the session cookies so they could expire. Expanded the matcher to run on all routes (except static files).

### Auth callback errors in production

The callback could crash with an unhandled error if something went wrong during the code exchange. Added try/catch and proper error redirects.

### Dark mode input text invisible

The input fields inherited the dark mode text color but had a white background. White text on white background. Added explicit `text-zinc-900 bg-white` classes.

### ESLint 10 not compatible

ESLint 10 doesn't work with Next.js's ESLint config yet. Pinned it to v9.

### Cross-tab session issues

If you sign in as different users in different tabs, cookies get overwritten since they're shared. Added a `SessionGuard` component that checks if the session still matches when you switch back to a tab.

### Auth failing intermittently (PKCE issue)

The middleware was running on `/auth/callback` and messing with cookies before the code exchange could read the PKCE `code_verifier`. Fixed by skipping the middleware on that route. Also removed an unnecessary `signOut()` call before OAuth that was clearing cookies.

### Auth still failing for some users

Even after the above fix, some users couldn't sign in. Turned out the `cookies()` API from `next/headers` wasn't reliably exposing all cookies in the Route Handler. Rewrote the callback to read cookies directly from the raw `Cookie` header using `parseCookieHeader` from `@supabase/ssr` instead. That fixed it.

---

## What I Would Add With More Time

- Bookmark editing
- Tags/categories for bookmarks
- Auto-fetch page title from URL
- Search and filter
- Pagination for lots of bookmarks
- End-to-end tests with Playwright
- Optimistic UI updates
