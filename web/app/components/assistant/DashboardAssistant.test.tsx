import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DashboardAssistant } from "./DashboardAssistant";

let pathname = "/dashboard";

vi.mock("react-router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => <a href={to} {...props}>{children}</a>,
  useLocation: () => ({ pathname, search: "" }),
}));

afterEach(() => {
  cleanup();
  pathname = "/dashboard";
});

describe("DashboardAssistant launcher", () => {
  it("links to the full assistant workspace", () => {
    render(<DashboardAssistant />);
    expect(screen.getByRole("link", { name: "Open AI Operations Assistant" }).getAttribute("href")).toBe("/assistant");
  });

  it("does not duplicate the launcher on the assistant page", () => {
    pathname = "/assistant";
    render(<DashboardAssistant />);
    expect(screen.queryByRole("link", { name: "Open AI Operations Assistant" })).toBeNull();
  });
});
