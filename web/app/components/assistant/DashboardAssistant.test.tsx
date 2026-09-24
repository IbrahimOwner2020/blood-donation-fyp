import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DashboardAssistant } from "./DashboardAssistant";

const navigateMock = vi.fn();
const revalidateMock = vi.fn();
let locationMock = {
  pathname: "/dashboard",
  search: "?bloodGroup=O%2B",
};

vi.mock("react-router", () => ({
  useLocation: () => locationMock,
  useNavigate: () => navigateMock,
  useRevalidator: () => ({ revalidate: revalidateMock }),
}));

const sendAssistantMessageMock = vi.fn();
const confirmAssistantActionMock = vi.fn();

vi.mock("~/lib/assistant", () => ({
  sendAssistantMessage: (input: unknown) => sendAssistantMessageMock(input),
  confirmAssistantAction: (id: string) => confirmAssistantActionMock(id),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  locationMock = {
    pathname: "/dashboard",
    search: "?bloodGroup=O%2B",
  };
});

describe("DashboardAssistant", () => {
  it("renders permission-denied assistant messages inline", async () => {
    sendAssistantMessageMock.mockResolvedValueOnce({
      type: "permission_denied",
      requiredPermission: "alerts:update",
      message: "Your account does not include alerts:update.",
    });

    render(<DashboardAssistant />);

    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    fireEvent.change(screen.getByPlaceholderText("Ask or request an action..."), {
      target: { value: "resolve alert 4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await screen.findByText("Your account does not include alerts:update.");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("confirms proposed actions and refreshes route data", async () => {
    sendAssistantMessageMock.mockResolvedValueOnce({
      type: "action_proposal",
      message: "I can update that alert after you confirm.",
      proposal: {
        id: "act_123456789abc",
        action: "alert.status",
        title: "Set alert #4 to RESOLVED",
        description: "Change shortage alert #4 status to RESOLVED.",
        requiredPermission: "alerts:update",
        payload: { alertId: 4, status: "RESOLVED" },
        effect: "Updates the alert lifecycle and records an audit event.",
      },
    });
    confirmAssistantActionMock.mockResolvedValueOnce({
      type: "action_result",
      action: "alert.status",
      message: "Alert #4 is now RESOLVED.",
    });

    render(<DashboardAssistant />);

    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    fireEvent.change(screen.getByPlaceholderText("Ask or request an action..."), {
      target: { value: "resolve alert 4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await screen.findByText("Set alert #4 to RESOLVED");
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await screen.findByText("Alert #4 is now RESOLVED.");
    await waitFor(() => {
      expect(confirmAssistantActionMock).toHaveBeenCalledWith("act_123456789abc");
      expect(revalidateMock).toHaveBeenCalled();
    });
  });

  it("sends the current route context with each message", async () => {
    locationMock = {
      pathname: "/donations",
      search: "?donorId=12",
    };
    sendAssistantMessageMock.mockResolvedValueOnce({
      type: "answer",
      message: "I need a more specific question for /donations to access the right NBTS data.",
    });

    render(<DashboardAssistant />);

    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    fireEvent.change(screen.getByPlaceholderText("Ask or request an action..."), {
      target: { value: "can you help me?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await screen.findByText("I need a more specific question for /donations to access the right NBTS data.");
    expect(sendAssistantMessageMock).toHaveBeenCalledWith({
      message: "can you help me?",
      context: {
        pathname: "/donations",
        search: "?donorId=12",
        filters: {
          donorId: "12",
        },
      },
      history: [],
    });
  });

  it("does not render raw JSON-looking assistant messages", async () => {
    sendAssistantMessageMock.mockResolvedValueOnce({
      type: "answer",
      message: '{"items":[{"id":1,"bloodGroup":"O+"}],"total":1}',
    });

    render(<DashboardAssistant />);

    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    fireEvent.change(screen.getByPlaceholderText("Ask or request an action..."), {
      target: { value: "show inventory" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await screen.findByText(
      "I found operational data for that request, but it was not formatted for chat. Please ask for the specific summary or record fields you want.",
    );
    expect(screen.queryByText(/"items"/)).toBeNull();
  });
});
