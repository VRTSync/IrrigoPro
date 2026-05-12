import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { AppErrorBoundary } from "./components/error-boundary";

// Render React first. Anything that touches IndexedDB, the service worker,
// notifications, or the network must NOT run at module scope — a thrown
// error here yields a permanent white screen on field-tech phones.
function mount() {
  const root = document.getElementById("root");
  if (!root) {
    console.error("[boot] #root element missing from index.html");
    return;
  }
  try {
    createRoot(root).render(
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>,
    );
  } catch (err) {
    console.error("[boot] React mount failed:", err);
    root.innerHTML =
      '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:sans-serif;padding:24px;text-align:center;color:#111">' +
      "<div><h1 style=\"font-size:18px;margin-bottom:12px\">Something went wrong loading the app</h1>" +
      '<button onclick="window.location.reload()" style="background:#1E5A99;color:white;border:none;border-radius:8px;padding:10px 20px;font-size:15px;cursor:pointer">Reload</button></div></div>';
  }
}

mount();

// Defer all heavy / failure-prone bootstrapping until after first paint so a
// thrown IndexedDB / dynamic-import / notification error cannot strand the
// page on a blank shell. Each side-effect is independently guarded.
function deferredBoot() {
  // Offline mutation queue replay engine (Slice 4B / Task #298). Behind the
  // OFFLINE_QUEUE feature flag (VITE_OFFLINE_QUEUE, default on).
  void (async () => {
    try {
      const { getSyncEngine, isOfflineQueueEnabled } = await import(
        "./lib/offline/engine"
      );
      const { setApiHeartbeat } = await import("./lib/queryClient");
      if (!isOfflineQueueEnabled()) return;
      const engine = getSyncEngine();
      setApiHeartbeat((ok) => engine.setOnline(ok));
      await engine.start();
    } catch (err) {
      console.warn("[boot] offline sync engine failed to start:", err);
    }
  })();

  // Push-notification service registration — purely opportunistic; failures
  // here must never block app render.
  void (async () => {
    try {
      const { notificationService } = await import("./lib/notifications");
      const ok = await notificationService.initialize();
      if (ok) console.log("[boot] notification service initialized");
    } catch (err) {
      console.warn("[boot] notification service init failed:", err);
    }
  })();
}

if (typeof window !== "undefined") {
  if (document.readyState === "complete") {
    setTimeout(deferredBoot, 0);
  } else {
    window.addEventListener("load", () => setTimeout(deferredBoot, 0), {
      once: true,
    });
  }

  // Task #550 — global error / promise reporter that mirrors what the
  // React error boundary already posts. Catches errors that escape React
  // (event handlers, async work, third-party scripts) so the App Health
  // Crashes tab sees them too. Lightweight breadcrumb ring captures the
  // last few route changes so the drawer has a bit of context to show.
  try {
    const w = window as any;
    if (!w.__irrigoBreadcrumbs) {
      w.__irrigoBreadcrumbs = [];
      const push = (entry: Record<string, unknown>) => {
        try {
          w.__irrigoBreadcrumbs.push({ t: Date.now(), ...entry });
          if (w.__irrigoBreadcrumbs.length > 50) w.__irrigoBreadcrumbs.shift();
        } catch { /* ignore */ }
      };
      push({ kind: "navigation", url: window.location.pathname });
      const wrapNav = (key: "pushState" | "replaceState") => {
        const orig = history[key];
        history[key] = function (this: History, ...args: any[]) {
          const ret = orig.apply(this, args as any);
          push({ kind: "navigation", url: window.location.pathname });
          return ret;
        };
      };
      wrapNav("pushState");
      wrapNav("replaceState");
      window.addEventListener("popstate", () =>
        push({ kind: "navigation", url: window.location.pathname })
      );
    }

    const REPORTED = new WeakSet<object>();
    const sendReport = (payload: Record<string, unknown>) => {
      try {
        const body = JSON.stringify(payload);
        const url = "/api/client-errors";
        let sent = false;
        if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
          try {
            sent = navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
          } catch { /* fall through */ }
        }
        if (!sent && typeof fetch === "function") {
          void fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            keepalive: true,
            credentials: "include",
          }).catch(() => { /* ignore */ });
        }
      } catch { /* ignore */ }
    };

    const readUser = () => {
      try {
        const raw = localStorage.getItem("user");
        if (!raw) return { userId: null, role: "", companyId: null };
        const u = JSON.parse(raw) as { id?: number; role?: string; companyId?: number | null };
        return {
          userId: typeof u?.id === "number" ? u.id : null,
          role: u?.role ?? "",
          companyId: typeof u?.companyId === "number" ? u.companyId : null,
        };
      } catch {
        return { userId: null, role: "", companyId: null };
      }
    };

    const getSession = (): string | null => {
      try {
        let sid = sessionStorage.getItem("irrigopro:sessionId");
        if (!sid) {
          sid = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
          sessionStorage.setItem("irrigopro:sessionId", sid);
        }
        return sid;
      } catch { return null; }
    };

    const buildHash = (import.meta.env.VITE_BUILD_HASH as string | undefined) ?? "";

    const reportError = (err: unknown, type: "error" | "unhandled_rejection") => {
      try {
        const e = (err && typeof err === "object") ? (err as Error) : new Error(String(err));
        if (typeof e === "object" && e) {
          if (REPORTED.has(e as any)) return;
          try { REPORTED.add(e as any); } catch { /* primitive errors */ }
        }
        const { userId, role, companyId } = readUser();
        const breadcrumbs = Array.isArray(w.__irrigoBreadcrumbs) ? w.__irrigoBreadcrumbs.slice(-30) : [];
        sendReport({
          name: e.name ?? (type === "unhandled_rejection" ? "UnhandledRejection" : "Error"),
          message: e.message ?? "",
          stack: e.stack ?? "",
          componentStack: "",
          url: window.location.href,
          userAgent: navigator.userAgent,
          buildHash,
          appVersion: buildHash,
          userId,
          role,
          companyId,
          sessionId: getSession(),
          component: window.location.pathname,
          source: "web",
          type,
          severity: "error",
          breadcrumbs,
          context: { route: window.location.pathname },
        });
      } catch { /* never throw from a global handler */ }
    };

    window.addEventListener("error", (ev) => {
      reportError(ev.error ?? new Error(ev.message ?? "Error"), "error");
    });
    window.addEventListener("unhandledrejection", (ev) => {
      reportError(ev.reason ?? new Error("Unhandled rejection"), "unhandled_rejection");
    });
  } catch (err) {
    console.warn("[boot] global error reporter init failed:", err);
  }
}
