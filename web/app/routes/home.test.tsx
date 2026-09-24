import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "~/lib/api";
import HomePage from "./home";

const apiFetchMock = vi.fn();

vi.mock("~/lib/api", async () => {
  const actual = await vi.importActual<typeof import("~/lib/api")>("~/lib/api");
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  };
});

vi.mock("react-router", () => ({
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string;
    children: import("react").ReactNode;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("HomePage donation chat", () => {
  it("omits language for Auto and includes recent turns", async () => {
    apiFetchMock.mockResolvedValueOnce({
      answer: "Male donors wait three calendar months.",
      disclaimer: "This is not medical clearance. Staff screening is required before donation.",
      source: "assistant",
    }).mockResolvedValueOnce({
      answer: "Female donors wait four calendar months.",
      disclaimer: "This is not medical clearance. Staff screening is required before donation.",
      source: "assistant",
    });

    render(<HomePage />);

    fireEvent.change(screen.getByPlaceholderText("Ask about donating blood…"), {
      target: { value: "When can I donate again?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await screen.findByText(/Male donors wait three calendar months/i);
    expect(screen.getByText(/not medical clearance/i)).toBeTruthy();

    expect(apiFetchMock).toHaveBeenCalledWith("/public/chat", {
      method: "POST",
      json: {
        message: "When can I donate again?",
        turns: [],
      },
    });

    fireEvent.change(screen.getByPlaceholderText("Ask about donating blood…"), {
      target: { value: "What about women?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenNthCalledWith(2, "/public/chat", {
        method: "POST",
        json: {
          message: "What about women?",
          turns: [
            { role: "user", content: "When can I donate again?" },
            { role: "assistant", content: "Male donors wait three calendar months." },
          ],
        },
      });
    });
  });

  it("sends English when English is selected", async () => {
    apiFetchMock.mockResolvedValueOnce({
      answer: "Donors are generally 18 to 65 years old.",
      disclaimer: "This is not medical clearance. Staff screening is required before donation.",
    });

    render(<HomePage />);
    fireEvent.change(screen.getByLabelText("Language"), {
      target: { value: "en" },
    });
    fireEvent.change(screen.getByPlaceholderText("Ask about donating blood…"), {
      target: { value: "What is the age limit?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith("/public/chat", {
        method: "POST",
        json: {
          message: "What is the age limit?",
          language: "en",
          turns: [],
        },
      });
    });
  });

  it("shows a stable unavailable message on PUBLIC_CHAT_UNAVAILABLE", async () => {
    apiFetchMock.mockRejectedValueOnce(
      new ApiRequestError("The donation assistant is temporarily unavailable.", {
        status: 503,
        code: "PUBLIC_CHAT_UNAVAILABLE",
      }),
    );

    render(<HomePage />);
    fireEvent.change(screen.getByPlaceholderText("Ask about donating blood…"), {
      target: { value: "Is donation safe?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await screen.findByText(
      "The donation assistant is temporarily unavailable. Please try again shortly.",
    );
    expect(screen.queryByText(/approved-guidance/i)).toBeNull();
    expect(screen.queryByText(/I can explain age and weight/i)).toBeNull();
  });
});
