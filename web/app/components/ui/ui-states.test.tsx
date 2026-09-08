import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ErrorState } from "~/components/ui/ErrorState";
import { ForbiddenState } from "~/components/ui/ForbiddenState";
import { LoadingState } from "~/components/ui/LoadingState";

afterEach(() => {
  cleanup();
});

describe("UI state components (error / forbidden / loading)", () => {
  it("renders ErrorState with role=alert", () => {
    render(
      <ErrorState
        title="Could not load dashboard"
        message="API unavailable"
        detail="NETWORK_ERROR (0)"
      />,
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Could not load dashboard")).toBeTruthy();
    expect(screen.getByText("API unavailable")).toBeTruthy();
    expect(screen.getByText("NETWORK_ERROR (0)")).toBeTruthy();
  });

  it("renders ForbiddenState for permission UI", () => {
    render(
      <ForbiddenState
        title="Create access restricted"
        message="donors:create required"
        detail="UI gate only"
      />,
    );

    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText("Create access restricted")).toBeTruthy();
    expect(screen.getByText("donors:create required")).toBeTruthy();
  });

  it("renders LoadingState for dashboard/list loading", () => {
    render(<LoadingState label="Loading dashboard…" />);

    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText("Loading dashboard…")).toBeTruthy();
  });
});
