// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";

// Feature 022 (B41): apiFetch — a 401 navigates to /login?next=<current path> and returns a promise that
// never settles; 403/2xx pass through. jsdom cannot really navigate, so window.location is replaced with a
// mock whose `href` setter records assignments; the module-level `redirecting` guard is reset by loading a
// fresh module per test (vi.resetModules + dynamic import).

type MockLoc = { href: string; sets: number };

function mockLocation(pathname: string, search = ""): MockLoc {
  const rec: MockLoc = { href: "", sets: 0 };
  const loc = {
    pathname,
    search,
    get href() {
      return rec.href;
    },
    set href(v: string) {
      rec.href = v;
      rec.sets++;
    },
  };
  Object.defineProperty(window, "location", { value: loc, configurable: true });
  return rec;
}

function stubStatus(status: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      status,
      ok: status < 400,
      json: async () => ({ error: { code: "X" } }),
    })),
  );
}

async function loadApiFetch() {
  vi.resetModules();
  return (await import("@/app/apiFetch")).apiFetch;
}

const realLocation = window.location;
afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, "location", { value: realLocation, configurable: true });
});

describe("apiFetch (B41)", () => {
  it("401 → navigates to /login?next=<current path> and never settles", async () => {
    const loc = mockLocation("/checkin", "?q=alex");
    stubStatus(401);
    const apiFetch = await loadApiFetch();

    const p = apiFetch("/api/attendance/search?q=alex");
    await Promise.resolve();
    await Promise.resolve();

    expect(loc.href).toBe(`/login?next=${encodeURIComponent("/checkin?q=alex")}`);
    expect(loc.sets).toBe(1);

    const outcome = await Promise.race([
      p.then(
        () => "settled",
        () => "rejected",
      ),
      new Promise((r) => setTimeout(() => r("pending"), 20)),
    ]);
    expect(outcome).toBe("pending");
  });

  it("concurrent 401s → a single navigation", async () => {
    const loc = mockLocation("/gate");
    stubStatus(401);
    const apiFetch = await loadApiFetch();

    void apiFetch("/api/a");
    void apiFetch("/api/b");
    void apiFetch("/api/c");
    await Promise.resolve();
    await Promise.resolve();

    expect(loc.sets).toBe(1);
  });

  it("401 while already on /login → no navigation (no loop)", async () => {
    const loc = mockLocation("/login");
    stubStatus(401);
    const apiFetch = await loadApiFetch();

    void apiFetch("/api/x");
    await Promise.resolve();
    await Promise.resolve();

    expect(loc.sets).toBe(0);
  });

  it("403 → returns the response unchanged, no navigation", async () => {
    const loc = mockLocation("/gate");
    stubStatus(403);
    const apiFetch = await loadApiFetch();

    const res = await apiFetch("/api/x");
    expect(res.status).toBe(403);
    expect(loc.sets).toBe(0);
  });

  it("2xx → passes through", async () => {
    const loc = mockLocation("/checkin");
    stubStatus(200);
    const apiFetch = await loadApiFetch();

    const res = await apiFetch("/api/x");
    expect(res.status).toBe(200);
    expect(loc.sets).toBe(0);
  });

  it("emits no unhandled rejection on 401", async () => {
    const loc = mockLocation("/checkin");
    stubStatus(401);
    const onRej = vi.fn();
    window.addEventListener("unhandledrejection", onRej);
    const apiFetch = await loadApiFetch();

    void apiFetch("/api/x");
    await new Promise((r) => setTimeout(r, 20));
    window.removeEventListener("unhandledrejection", onRej);

    expect(onRej).not.toHaveBeenCalled();
    expect(loc.sets).toBe(1);
  });
});

/**
 * Dev tunnel (ngrok): a free ngrok address answers a browser's request with a warning page unless the
 * request carries `ngrok-skip-browser-warning`. The app's own background requests carry it in development,
 * so a phone testing through the tunnel never receives that page where it expected data. Page loads are the
 * browser's own requests and cannot carry it; ngrok shows its warning once per browser for those.
 */
describe("apiFetch — the dev tunnel", () => {
  afterEach(() => vi.unstubAllEnvs());

  function stubCapture() {
    const seen: Headers[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        seen.push(new Headers(init?.headers));
        return { status: 200, ok: true, json: async () => ({}) };
      }),
    );
    return seen;
  }

  it("asks ngrok to skip its warning page in development, keeping the caller's own headers", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const seen = stubCapture();
    const apiFetch = await loadApiFetch();

    await apiFetch("/api/series", { headers: { "Content-Type": "application/json" } });

    expect(seen[0]!.get("ngrok-skip-browser-warning")).toBe("1");
    expect(seen[0]!.get("Content-Type")).toBe("application/json");
  });

  it("sends nothing extra outside development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const seen = stubCapture();
    const apiFetch = await loadApiFetch();

    await apiFetch("/api/series");

    expect(seen[0]!.has("ngrok-skip-browser-warning")).toBe(false);
  });
});
