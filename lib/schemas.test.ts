import { describe, expect, it } from "vitest";
import { ForgotPasswordInputSchema, ResetPasswordInputSchema } from "./schemas";

describe("ForgotPasswordInputSchema", () => {
  it("accepts and trims a valid email", () => {
    const r = ForgotPasswordInputSchema.parse({ email: "  a@b.co " });
    expect(r.email).toBe("a@b.co");
  });
  it("rejects a malformed email", () => {
    expect(ForgotPasswordInputSchema.safeParse({ email: "nope" }).success).toBe(false);
  });
});

describe("ResetPasswordInputSchema", () => {
  it("accepts matching passwords", () => {
    expect(
      ResetPasswordInputSchema.safeParse({ password: "secret1", confirm: "secret1" }).success
    ).toBe(true);
  });
  it("rejects mismatch and short passwords", () => {
    expect(
      ResetPasswordInputSchema.safeParse({ password: "secret1", confirm: "secret2" }).success
    ).toBe(false);
    expect(
      ResetPasswordInputSchema.safeParse({ password: "abc", confirm: "abc" }).success
    ).toBe(false);
  });
});
