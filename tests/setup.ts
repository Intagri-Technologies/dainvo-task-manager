import { vi } from "vitest";

vi.stubGlobal("activeWindow", {
  atob,
  btoa,
  crypto,
});
