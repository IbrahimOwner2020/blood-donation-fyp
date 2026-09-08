/**
 * Presentation-only UI gate helper.
 * Hiding controls is not authorization — the API must reject unauthorized actions.
 */

import type { ReactNode } from "react";

import type { AuthSession } from "~/lib/auth";
import { hasUiGate } from "~/lib/auth";

type ProtectedUiProps = {
  session: AuthSession | null | undefined;
  /** Display-only gate code (e.g. users:manage); not authoritative */
  gate?: string;
  children: ReactNode;
  fallback?: ReactNode;
};

export function ProtectedUi({
  session,
  gate = "authenticated",
  children,
  fallback = null,
}: ProtectedUiProps) {
  if (!hasUiGate(session, gate)) {
    return <>{fallback}</>;
  }
  return <>{children}</>;
}
