"use client";
import { apiFetch } from "@/app/apiFetch";

/** Feature 082: what a write answered — the body on success, or the server's refusal in words. */
export type Sent<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

/**
 * One path for every write on the gate page and its dialogs, as `/payments` has (081), so each caller shows
 * the server's own reason where the action was taken (FR-001).
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
  const payload = res.status === 204 ? null : await res.json().catch(() => null);
  if (res.ok) return { ok: true, data: payload as T };
  const error = payload?.error ?? {};
  if (res.status === 403 && error.code !== "NOT_YOUR_ENTRY") {
    return {
      ok: false,
      status: 403,
      code: "UNAUTHORIZED",
      message: "Only the Financial Secretary or Treasurer for this series may record gate money.",
    };
  }
  return {
    ok: false,
    status: res.status,
    code: error.code ?? "UNKNOWN",
    message: error.message ?? `The server refused it (${res.status}).`,
  };
}

/** Dollars as Mary reads them; a shortfall is "−$15.00", never "$-15.00". */
export const money = (dollars: number) =>
  `${dollars < 0 ? "−" : ""}$${Math.abs(dollars).toFixed(2)}`;

/** A typed figure, or nothing when the box is empty or not a number. */
export const toNumber = (typed: string) => Number(typed) || 0;
