"use client";
import { apiFetch } from "@/app/apiFetch";

/** Feature 081: what a write answered — the body on success, or the server's refusal with its details. */
export type Sent<T = unknown> =
  | { ok: true; data: T }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
      details?: Record<string, unknown>;
    };

/**
 * One path for every write on the payments page, so each caller can turn a refusal — a check number already
 * used, a second payment to the same performer — into the choice the page offers (research R3, R5).
 */
export async function send<T = unknown>(
  url: string,
  method: string,
  body?: unknown,
): Promise<Sent<T>> {
  let res: Response;
  try {
    res = await apiFetch(url, {
      method,
      ...(body !== undefined
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        : {}),
    });
  } catch {
    return { ok: false, status: 0, code: "UNREACHABLE", message: "Could not reach the server." };
  }
  const payload = await res.json().catch(() => null);
  if (res.ok) return { ok: true, data: payload as T };
  if (res.status === 403) {
    return {
      ok: false,
      status: 403,
      code: "UNAUTHORIZED",
      message: "Only the Financial Secretary or Treasurer for this series may record payments.",
    };
  }
  const error = payload?.error ?? {};
  return {
    ok: false,
    status: res.status,
    code: error.code ?? "UNKNOWN",
    message: error.message ?? `The server refused it (${res.status}).`,
    ...(error.details ? { details: error.details } : {}),
  };
}

export const money = (dollars: number) => `$${dollars.toFixed(2)}`;

export const ROLE_LABEL: Record<string, string> = {
  caller: "caller",
  lead_musician: "lead musician",
  musician: "musician",
  sound_tech: "sound tech",
  instructor: "instructor",
  open_band_musician: "open-band musician",
};
