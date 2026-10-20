import { describe, expect, it } from "vitest";
import { runJules } from "./helpers";

describe("jules.sh validate", () => {
  it("requires a prompt in create mode", async () => {
    const result = await runJules("validate", {
      JULES_MODE: "create",
      JULES_PROMPT: "",
    });

    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      "::error::prompt is required for create mode",
    );
  });

  it("requires session_id in delete mode", async () => {
    const result = await runJules("validate", {
      JULES_MODE: "delete",
      JULES_SESSION_ID: "",
    });

    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      "::error::session_id is required for delete mode",
    );
  });

  it("accepts a create request with a prompt", async () => {
    const result = await runJules("validate", {
      JULES_MODE: "create",
      JULES_PROMPT: "do it",
    });

    expect(result.code, result.stdout + result.stderr).toBe(0);
  });

  it("accepts a delete request with a session id", async () => {
    const result = await runJules("validate", {
      JULES_MODE: "delete",
      JULES_SESSION_ID: "123",
    });

    expect(result.code, result.stdout + result.stderr).toBe(0);
  });
});
