import {
  redirect,
  type ActionFunctionArgs,
  type ClientActionFunctionArgs,
  type ClientLoaderFunctionArgs,
} from "react-router";

import { LoadingState } from "~/components/ui/LoadingState";
import {
  clearLegacyMockSessionCookie,
  logoutFromApi,
} from "~/lib/auth";

/**
 * Clear leftover web-shell mock cookie on the web origin (HttpOnly).
 * Real session cookie is cleared by the server logout endpoint.
 */
export async function action(_args: ActionFunctionArgs) {
  return redirect("/login", {
    headers: {
      "Set-Cookie": clearLegacyMockSessionCookie(),
    },
  });
}

export async function clientAction({
  serverAction,
}: ClientActionFunctionArgs) {
  await logoutFromApi();
  return serverAction();
}

/**
 * GET /logout — revoke server session in the browser, then land on login.
 * (server cookie is host-scoped to the server origin; only a client fetch can send it.)
 */
export async function clientLoader(_args: ClientLoaderFunctionArgs) {
  await logoutFromApi();
  throw redirect("/login");
}

clientLoader.hydrate = true as const;

export function loader() {
  return redirect("/login", {
    headers: {
      "Set-Cookie": clearLegacyMockSessionCookie(),
    },
  });
}

export function HydrateFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-nbts-surface">
      <LoadingState label="Signing out…" />
    </div>
  );
}

export default function LogoutPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-nbts-surface">
      <LoadingState label="Signing out…" />
    </div>
  );
}
