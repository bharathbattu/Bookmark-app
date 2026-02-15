import GoogleSignInButton from "@/app/_components/GoogleSignInButton";

const ERROR_MESSAGES: Record<string, string> = {
  auth_provider_error: "Google sign-in was denied or cancelled. Please try again.",
  auth_callback_failed: "Authentication failed during sign-in. Please try again.",
  auth_callback_unexpected: "An unexpected error occurred during sign-in. Please try again.",
  missing_code: "Authentication response was incomplete. Please try again.",
};

type HomeProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const errorCode = typeof params.error === "string" ? params.error : undefined;
  const errorMessage = errorCode ? (ERROR_MESSAGES[errorCode] ?? "Sign-in failed. Please try again.") : undefined;

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-6">
      <main className="w-full max-w-md rounded-xl bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-zinc-900">Smart Bookmark App</h1>
        <p className="mt-2 text-sm text-zinc-600">Sign in with Google to continue.</p>

        {errorMessage && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-700">{errorMessage}</p>
          </div>
        )}

        <div className="mt-6">
          <GoogleSignInButton />
        </div>
      </main>
    </div>
  );
}
