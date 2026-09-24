import {
  Link,
  redirect,
  useLoaderData,
  type ClientLoaderFunctionArgs,
  type MetaFunction,
} from "react-router";

import { AppShell } from "~/components/layout/AppShell";
import { ErrorState } from "~/components/ui/ErrorState";
import { LoadingState } from "~/components/ui/LoadingState";
import { ApiRequestError } from "~/lib/api";
import { fetchAuthSession, type AuthSession } from "~/lib/auth";

export const meta: MetaFunction = () => [
  { title: "Blood Donation Management System" },
];

type AppLayoutLoaderData =
  | { status: "ok"; session: AuthSession }
  | { status: "error"; message: string };

/**
 * Protected app shell layout.
 * Session comes from GET /auth/me (server cookie), not client-side authority.
 */
export async function clientLoader({ request }: ClientLoaderFunctionArgs) {
  try {
    const session = await fetchAuthSession();
    if (!session) {
      const url = new URL(request.url);
      const next = `${url.pathname}${url.search}`;
      throw redirect(`/login?next=${encodeURIComponent(next)}`);
    }
    return { status: "ok", session } satisfies AppLayoutLoaderData;
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }

    const message =
      error instanceof ApiRequestError
        ? error.message
        : "Unable to verify your session. Please try again.";

    return {
      status: "error",
      message,
    } satisfies AppLayoutLoaderData;
  }
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-nbts-surface">
      <LoadingState label="Checking session…" />
    </div>
  );
}

export default function AppLayout() {
  const data = useLoaderData<AppLayoutLoaderData>();

  if (data?.status === "error") {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-16">
        <ErrorState
          title="Session check failed"
          message={data.message || "Could not reach the authentication server."}
        />
        <p className="mt-4 text-center text-sm text-nbts-muted">
          <Link to="/login" className="font-medium text-nbts-teal underline">
            Return to sign in
          </Link>
        </p>
      </main>
    );
  }

  if (data?.status !== "ok" || !data.session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-nbts-surface">
        <LoadingState label="Checking session…" />
      </div>
    );
  }

  return <AppShell session={data.session} />;
}
