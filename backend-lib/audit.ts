import { eventHash } from "./core";

export type AuditEvent = {
  id: string;
  account_id: string;
  event_type: string;
  surface: string;
  locale: string;
  notice: string;
  policy_version: string;
  content_sha256: string | null;
  client_reported_at: string | null;
  received_at: string;
  prev_hash: string;
  event_hash: string;
};

export function verifyAuditEvents(events: AuditEvent[]) {
  let previous = "GENESIS";
  for (const event of events) {
    if (event.prev_hash !== previous) return false;
    const { event_hash, ...payload } = event;
    if (eventHash(payload) !== event_hash) return false;
    previous = event_hash;
  }
  return true;
}
