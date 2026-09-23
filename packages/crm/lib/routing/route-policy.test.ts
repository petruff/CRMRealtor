import { describe, expect, it } from "vitest";
import {
  isApprovedInternalPath,
  isPublicPagePath,
  isSessionPublicPath,
  safeInternalPath,
} from "./route-policy";

describe("route policy", () => {
  it("keeps public pages exact and session-public endpoints segment bounded", () => {
    expect(isPublicPagePath("/welcome")).toBe(true);
    expect(isPublicPagePath("/login")).toBe(true);
    expect(isPublicPagePath("/offline")).toBe(true);
    expect(isPublicPagePath("/welcome-more")).toBe(false);
    expect(isSessionPublicPath("/manifest.webmanifest")).toBe(true);
    expect(isSessionPublicPath("/sw.js")).toBe(true);
    expect(isSessionPublicPath("/portal/abc")).toBe(true);
    expect(isSessionPublicPath("/portals")).toBe(false);
    expect(isSessionPublicPath("/auth/callback")).toBe(true);
    expect(isSessionPublicPath("/api/health")).toBe(true);
    expect(isSessionPublicPath("/api/readiness")).toBe(true);
    expect(isSessionPublicPath("/api/health/private")).toBe(true);
    expect(isSessionPublicPath("/api/intake/contacts")).toBe(true);
    expect(isSessionPublicPath("/api/v1/status")).toBe(true);
    expect(isSessionPublicPath("/api/v1/contacts/contact-a")).toBe(true);
    expect(isSessionPublicPath("/api/v10/status")).toBe(false);
    expect(isSessionPublicPath("/api/internal/connectors/drain")).toBe(true);
    expect(isSessionPublicPath("/api/connectors/google/gmail/push/key")).toBe(true);
    expect(isSessionPublicPath("/api/connectors/mailchimp/webhook/key")).toBe(true);
    expect(isSessionPublicPath("/api/connectors/meta/webhook/key")).toBe(true);
    expect(isSessionPublicPath("/api/connectors/twilio/key/status")).toBe(true);
    expect(isSessionPublicPath("/api/connectors/google/connect")).toBe(false);
    expect(isSessionPublicPath("/api/connectors/mailchimp/connect")).toBe(false);
    expect(isSessionPublicPath("/authentication")).toBe(false);
  });

  it("accepts owned destinations and their deep links", () => {
    expect(isApprovedInternalPath("/")).toBe(true);
    expect(isApprovedInternalPath("/contacts/c-monroe/edit")).toBe(true);
    expect(isApprovedInternalPath("/activities")).toBe(true);
    expect(safeInternalPath("/activities?status=open")).toBe(
      "/activities?status=open",
    );
    expect(safeInternalPath("/contacts/c-monroe?tab=notes")).toBe(
      "/contacts/c-monroe?tab=notes",
    );
    expect(safeInternalPath("/pipeline#active")).toBe("/pipeline#active");
    expect(safeInternalPath("/contacts?return=%2Fcontacts")).toBe(
      "/contacts?return=%2Fcontacts",
    );
  });

  it.each([
    "https://attacker.example/path",
    "//attacker.example/path",
    "/\\attacker.example",
    "/%2fattacker.example",
    "/contacts%2fc-monroe",
    "/unknown",
    "contacts",
    " /contacts",
    "/contacts\n",
    "javascript:alert(1)",
  ])("rejects unsafe redirect %s", (value) => {
    expect(safeInternalPath(value)).toBe("/");
  });

  it("uses only an approved fallback", () => {
    expect(safeInternalPath("/unknown", "/contacts")).toBe("/contacts");
    expect(safeInternalPath("/unknown", "https://attacker.example")).toBe("/");
  });
});
