import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "~/lib/api";
import RegisterDonorPage, {
  clientAction,
  describeRegistrationError,
} from "./register-donor";

let actionDataMock: unknown;
const registerDonorAccountMock = vi.fn();

vi.mock("react-router", () => ({
  Form: ({ children, ...props }: import("react").FormHTMLAttributes<HTMLFormElement>) => (
    <form {...props}>{children}</form>
  ),
  Link: ({ to, children, ...props }: { to: string; children: import("react").ReactNode }) => (
    <a href={to} {...props}>{children}</a>
  ),
  data: (value: unknown, init: { status: number }) =>
    new Response(JSON.stringify(value), {
      status: init.status,
      headers: { "Content-Type": "application/json" },
    }),
  redirect: (url: string) =>
    new Response(null, { status: 302, headers: { Location: url } }),
  useActionData: () => actionDataMock,
  useNavigation: () => ({ state: "idle" }),
}));

vi.mock("~/lib/auth", () => ({
  registerDonorAccount: (input: unknown) => registerDonorAccountMock(input),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  actionDataMock = undefined;
});

describe("RegisterDonorPage", () => {
  it("starts with personal names and has no account-name field", () => {
    render(<RegisterDonorPage />);

    expect(screen.getByRole("heading", { name: "Personal information" })).toBeTruthy();
    expect(screen.getByLabelText(/First name/)).toBeTruthy();
    expect(screen.getByLabelText(/Last name/)).toBeTruthy();
    expect(screen.queryByLabelText(/Account name/i)).toBeNull();

    const firstName = screen.getByLabelText(/First name/);
    const email = screen.getByLabelText(/Email address/);
    expect(firstName.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("turns duplicate details into a sign-in action and field error", () => {
    const result = describeRegistrationError(
      new ApiRequestError("An account already exists with this email", {
        status: 409,
        code: "CONFLICT",
        details: [
          {
            path: "email",
            message: "This email is already registered. Sign in instead.",
            code: "email_already_registered",
          },
        ],
      }),
    );

    expect(result.showLoginLink).toBe(true);
    expect(result.fieldErrors?.email).toContain("already registered");
    expect(result.error).toContain("Sign in");
  });

  it("derives the account name server-side instead of submitting a name field", async () => {
    registerDonorAccountMock.mockResolvedValueOnce({});
    const formData = new FormData();
    formData.set("firstName", "Asha");
    formData.set("lastName", "Mwangi");
    formData.set("dateOfBirth", "1990-01-01");
    formData.set("sex", "FEMALE");
    formData.set("phone", "0712345678");
    formData.set("address", "Dodoma");
    formData.set("weightKg", "60");
    formData.set("bloodGroupId", "7");
    formData.set("email", "asha@example.local");
    formData.set("password", "StrongPass123!");
    formData.set("confirmPassword", "StrongPass123!");

    const request = new Request("https://web.test/register-donor", {
      method: "POST",
      body: formData,
    });

    await expect(clientAction({ request } as never)).rejects.toMatchObject({
      status: 302,
    });
    expect(registerDonorAccountMock).toHaveBeenCalledWith({
      email: "asha@example.local",
      password: "StrongPass123!",
      firstName: "Asha",
      lastName: "Mwangi",
      phone: "0712345678",
      dateOfBirth: "1990-01-01",
      sex: "FEMALE",
      address: "Dodoma",
      weightKg: 60,
      smsConsent: false,
      emailConsent: false,
      bloodGroupId: 7,
    });
  });
});
