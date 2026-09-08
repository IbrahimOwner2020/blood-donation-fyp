import {
  data,
  Form,
  redirect,
  useActionData,
  useSearchParams,
  type ClientActionFunctionArgs,
  type ClientLoaderFunctionArgs,
  type MetaFunction,
} from "react-router";

import { LoadingState } from "~/components/ui/LoadingState";
import { ApiRequestError } from "~/lib/api";
import { fetchAuthSession, loginWithCredentials } from "~/lib/auth";

export const meta: MetaFunction = () => [
  { title: "Sign in · NBTS Blood AI" },
  {
    name: "description",
    content: "Sign in to the NBTS blood supply prediction console.",
  },
];

type LoginActionData = {
  error?: string;
};

function safeNextPath(raw: string | null | undefined): string {
  const value = (raw || "").trim();
  if (!value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }
  return value;
}

/**
 * Cookie session lives on the API origin — check via /auth/me in the browser.
 */
export async function clientLoader(_args: ClientLoaderFunctionArgs) {
  try {
    const session = await fetchAuthSession();
    if (session) {
      throw redirect("/dashboard");
    }
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    // Network/CORS failures: still show the login form so the user can retry.
  }
  return null;
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-nbts-surface">
      <LoadingState label="Loading sign-in…" />
    </div>
  );
}

export async function clientAction({ request }: ClientActionFunctionArgs) {
  const formData = await request.formData();
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const next = safeNextPath(String(formData.get("next") || "/dashboard"));

  if (!email || !password) {
    return data<LoginActionData>(
      { error: "Email and password are required." },
      { status: 400 },
    );
  }

  try {
    await loginWithCredentials(email, password);
  } catch (error) {
    const message =
      error instanceof ApiRequestError
        ? error.message || "Sign-in failed."
        : "Sign-in failed. Please try again.";
    return data<LoginActionData>({ error: message }, { status: 400 });
  }

  throw redirect(next);
}

export default function LoginPage() {
  const actionData = useActionData<LoginActionData>();
  const [searchParams] = useSearchParams();
  const error = actionData?.error;
  const next = safeNextPath(searchParams.get("next"));

  return (
    <div className="flex min-h-screen items-center justify-center bg-nbts-surface px-4">
      <div className="w-full max-w-md rounded-xl border border-nbts-border bg-nbts-panel p-8 shadow-sm">
        <div className="mb-6">
          <div className="mb-4 flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded bg-nbts-blood text-sm font-bold text-white">
              N
            </span>
            <span className="text-lg font-semibold text-nbts-ink">
              NBTS Blood AI
            </span>
          </div>
          <h1 className="text-xl font-semibold text-nbts-ink">Sign in</h1>
          <p className="mt-1 text-sm text-nbts-muted">
            Use your NBTS account. Sessions are issued by the API.
          </p>
        </div>

        {error ? (
          <p
            className="mb-4 rounded border border-nbts-blood/20 bg-nbts-blood-soft px-3 py-2 text-sm text-nbts-blood-dark"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <Form method="post" className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next} />
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">Email</span>
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              placeholder="you@nbts.example"
              className="rounded border border-nbts-border bg-white px-3 py-2 text-nbts-ink outline-none focus:border-nbts-teal"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">Password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
              className="rounded border border-nbts-border bg-white px-3 py-2 text-nbts-ink outline-none focus:border-nbts-teal"
            />
          </label>
          <button
            type="submit"
            className="mt-2 rounded bg-nbts-blood px-4 py-2.5 text-sm font-semibold text-white hover:bg-nbts-blood-dark"
          >
            Continue
          </button>
        </Form>
      </div>
    </div>
  );
}
