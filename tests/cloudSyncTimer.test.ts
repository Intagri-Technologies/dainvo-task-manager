import { describe, expect, it } from "vitest";

import { timedCloudSyncDue } from "../src/cloudSyncTimer";

const backstopMs = 6 * 60 * 60_000;
const now = 1_760_000_000_000;

describe("timed cloud sync under the hub backstop", () => {
  it("a healthy idle vault waits for the backstop while the hub delivers", () => {
    expect(
      timedCloudSyncDue({
        hubDelivering: true,
        lastCompletedAt: now - 60_000,
        now,
        backstopMs,
        retryableError: false,
      }),
    ).toBe(false);
    expect(
      timedCloudSyncDue({
        hubDelivering: true,
        lastCompletedAt: now - backstopMs,
        now,
        backstopMs,
        retryableError: false,
      }),
    ).toBe(true);
  });

  it("a retryable error is never held back by the hub guard", () => {
    expect(
      timedCloudSyncDue({
        hubDelivering: true,
        lastCompletedAt: now - 1_000,
        now,
        backstopMs,
        retryableError: true,
      }),
    ).toBe(true);
  });

  it("without the hub the timer runs as before", () => {
    expect(
      timedCloudSyncDue({
        hubDelivering: false,
        lastCompletedAt: now - 1_000,
        now,
        backstopMs,
        retryableError: false,
      }),
    ).toBe(true);
  });
});
