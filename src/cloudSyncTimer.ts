/**
 * Whether the plugin's cloud-sync timer should run now (J3, workspace
 * docs/SYNC_REVIEW_FIX_PLAN_2026-10-14.md). While the sync hub delivers
 * hints the timer is only a 6-hour backstop, but a due retry after a
 * retryable error must never wait for it: the hub reports remote changes,
 * not the plugin's own failures.
 */
export function timedCloudSyncDue(input: {
  hubDelivering: boolean;
  lastCompletedAt: number;
  now: number;
  backstopMs: number;
  retryableError: boolean;
}): boolean {
  if (input.retryableError) return true;
  return !(
    input.hubDelivering && input.now - input.lastCompletedAt < input.backstopMs
  );
}
