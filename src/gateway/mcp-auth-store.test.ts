import { describe, expect, it } from "vitest";
import {
  bindConnectionToSession,
  clearDelegatedJwtForConnection,
  getDelegatedJwtForSession,
  setDelegatedJwtForConnection,
} from "./mcp-auth-store.js";

describe("mcp auth store", () => {
  it("binds delegated JWTs to sessions", () => {
    setDelegatedJwtForConnection("conn-a", "jwt-a");
    bindConnectionToSession("conn-a", "main");
    expect(getDelegatedJwtForSession("main")).toBe("jwt-a");
  });

  it("clears delegated JWTs when the connection is cleared", () => {
    setDelegatedJwtForConnection("conn-b", "jwt-b");
    bindConnectionToSession("conn-b", "agent:main:main");
    expect(getDelegatedJwtForSession("agent:main:main")).toBe("jwt-b");
    clearDelegatedJwtForConnection("conn-b");
    expect(getDelegatedJwtForSession("agent:main:main")).toBeUndefined();
  });
});
