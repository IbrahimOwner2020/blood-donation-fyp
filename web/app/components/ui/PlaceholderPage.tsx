import type { ReactNode } from "react";

import { EmptyState } from "~/components/ui/EmptyState";
import { ErrorState } from "~/components/ui/ErrorState";
import { LoadingState } from "~/components/ui/LoadingState";
import { PageHeader } from "~/components/ui/PageHeader";

export type PlaceholderViewState = "ready" | "loading" | "empty" | "error";

type PlaceholderPageProps = {
  title: string;
  description?: string;
  /** Default ready shows empty stub until API wiring */
  state?: PlaceholderViewState;
  emptyTitle?: string;
  emptyDescription?: string;
  errorMessage?: string;
  actions?: ReactNode;
};

export function PlaceholderPage({
  title,
  description,
  state = "ready",
  emptyTitle = "No records yet",
  emptyDescription = "This screen is a presentation stub. Values will come from the API.",
  errorMessage = "Unable to load this view. The API remains the source of truth.",
  actions,
}: PlaceholderPageProps) {
  return (
    <div>
      <PageHeader title={title} description={description} actions={actions} />
      {state === "loading" ? (
        <LoadingState label={`Loading ${title.toLowerCase()}…`} />
      ) : null}
      {state === "error" ? (
        <ErrorState title="Could not load data" message={errorMessage} />
      ) : null}
      {state === "empty" || state === "ready" ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : null}
    </div>
  );
}
