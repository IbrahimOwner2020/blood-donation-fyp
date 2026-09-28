import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConversation: vi.fn(),
  navigate: vi.fn(),
}));

const conversation = {
  id: "conversation-1",
  title: "Supply report",
  preferredLanguage: "en" as const,
  lastMessageAt: "2026-09-28T07:00:00.000Z",
  expiresAt: "2026-12-27T07:00:00.000Z",
  createdAt: "2026-09-28T07:00:00.000Z",
  updatedAt: "2026-09-28T07:00:00.000Z",
};

vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useLoaderData: () => ({ status: "ok", session: {}, conversations: [conversation] }),
    useLocation: () => ({ pathname: "/assistant", search: "?conversation=conversation-1" }),
    useNavigate: () => mocks.navigate,
  };
});

vi.mock("~/lib/assistant", async () => {
  const actual = await vi.importActual<typeof import("~/lib/assistant")>("~/lib/assistant");
  return {
    ...actual,
    getAssistantConversation: mocks.getConversation,
  };
});

import AssistantPage, { shouldRevalidate } from "./assistant";

afterEach(() => {
  cleanup();
  mocks.getConversation.mockReset();
  mocks.navigate.mockReset();
  vi.restoreAllMocks();
});

describe("AI Operations Assistant lifecycle", () => {
  it("does not treat the auto-scroll result as an effect cleanup function", async () => {
    mocks.getConversation.mockResolvedValue({ conversation, messages: [] });
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation((() => ({ scrolled: true })) as never);

    const view = render(<AssistantPage />);
    await waitFor(() => expect(mocks.getConversation).toHaveBeenCalledTimes(1));

    expect(() => view.unmount()).not.toThrow();
  });

  it("does not navigate again when the selected conversation is already in the URL", async () => {
    mocks.getConversation.mockResolvedValue({ conversation, messages: [] });
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => undefined);

    render(<AssistantPage />);
    await waitFor(() => expect(mocks.getConversation).toHaveBeenCalledTimes(1));

    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("does not re-run the route loader when only the conversation selection changes", () => {
    const currentUrl = new URL("http://localhost/assistant?conversation=one");
    const nextUrl = new URL("http://localhost/assistant?conversation=two");

    expect(shouldRevalidate({ currentUrl, nextUrl, defaultShouldRevalidate: true } as never)).toBe(false);
  });
});
