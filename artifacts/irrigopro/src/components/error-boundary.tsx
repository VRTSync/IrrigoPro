import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
  showDetails: boolean;
  copied: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    error: null,
    componentStack: null,
    showDetails: false,
    copied: false,
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[boot] React error boundary caught:", error, info?.componentStack);
    this.setState({ componentStack: info?.componentStack ?? null });
  }

  private handleReload = () => {
    try {
      window.location.reload();
    } catch {
      // ignore
    }
  };

  private toggleDetails = () => {
    this.setState((s) => ({ showDetails: !s.showDetails }));
  };

  // Task #539 — surface a "Copy diagnostics" affordance so the next field
  // tech who hits a render crash can hand us something actionable in one
  // tap. Includes the error name (helps distinguish TypeError vs.
  // ChunkLoadError vs. SecurityError at a glance), the message, the JS
  // stack (un-minified when source maps are present), the React component
  // stack, plus the URL / build / userAgent for context.
  private buildDiagnostics(): string {
    const err = this.state.error;
    const lines: string[] = [];
    lines.push(`name: ${err?.name ?? "Error"}`);
    lines.push(`message: ${err?.message ?? "Unknown error"}`);
    if (typeof window !== "undefined") {
      lines.push(`url: ${window.location.href}`);
      const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
      if (ua) lines.push(`ua: ${ua}`);
    }
    lines.push(`time: ${new Date().toISOString()}`);
    if (err?.stack) {
      lines.push("");
      lines.push("stack:");
      lines.push(err.stack);
    }
    if (this.state.componentStack) {
      lines.push("");
      lines.push("componentStack:");
      lines.push(this.state.componentStack);
    }
    return lines.join("\n");
  }

  private handleCopyDiagnostics = async () => {
    const text = this.buildDiagnostics();
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else if (typeof document !== "undefined") {
        // Safari iOS without async clipboard API: fall back to the
        // hidden-textarea + execCommand trick so techs in the field on
        // older iOS still get the copy affordance.
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); } catch { /* ignore */ }
        document.body.removeChild(ta);
      }
      this.setState({ copied: true });
      window.setTimeout(() => this.setState({ copied: false }), 2000);
    } catch (copyErr) {
      console.warn("[boot] copy diagnostics failed:", copyErr);
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const err = this.state.error;
    const errorName = err?.name ?? "Error";
    const message = err?.message ?? "Unknown error";
    const stack = err?.stack ?? "";
    const componentStack = this.state.componentStack ?? "";
    // First non-empty stack frame — when source maps are loaded this is
    // the un-minified call site, which is the single most useful piece
    // of info for triaging a "Something went wrong" report.
    const firstFrame = stack
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith(errorName) && !l.includes(message)) ?? "";

    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f9fafb",
          padding: "24px",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <div
          style={{
            maxWidth: 480,
            width: "100%",
            background: "white",
            borderRadius: 12,
            padding: 24,
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8, color: "#111827" }}>
            Something went wrong loading the app
          </h1>
          <p style={{ color: "#4b5563", marginBottom: 20, fontSize: 14 }}>
            We couldn&apos;t finish loading IrrigoPro. Check your connection and try
            again.
          </p>
          <button
            onClick={this.handleReload}
            style={{
              background: "#1E5A99",
              color: "white",
              border: "none",
              borderRadius: 8,
              padding: "10px 20px",
              fontSize: 15,
              fontWeight: 500,
              cursor: "pointer",
              minWidth: 140,
            }}
          >
            Reload
          </button>
          <div style={{ marginTop: 16 }}>
            <button
              onClick={this.toggleDetails}
              style={{
                background: "transparent",
                border: "none",
                color: "#6b7280",
                fontSize: 12,
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              {this.state.showDetails ? "Hide details" : "Show details"}
            </button>
          </div>
          {this.state.showDetails && (
            <div style={{ marginTop: 12, textAlign: "left" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 8,
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#374151",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  {errorName}
                </span>
                <button
                  onClick={this.handleCopyDiagnostics}
                  style={{
                    background: this.state.copied ? "#16a34a" : "#e5e7eb",
                    color: this.state.copied ? "white" : "#374151",
                    border: "none",
                    borderRadius: 6,
                    padding: "4px 10px",
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  {this.state.copied ? "Copied" : "Copy diagnostics"}
                </button>
              </div>
              {firstFrame && (
                <pre
                  style={{
                    margin: 0,
                    marginBottom: 8,
                    padding: 8,
                    background: "#eef2ff",
                    borderRadius: 6,
                    fontSize: 11,
                    color: "#1e3a8a",
                    overflow: "auto",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {firstFrame}
                </pre>
              )}
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  background: "#f3f4f6",
                  borderRadius: 8,
                  fontSize: 11,
                  color: "#374151",
                  overflow: "auto",
                  maxHeight: 240,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {message}
                {stack ? `\n\n${stack}` : ""}
                {componentStack ? `\n\nComponent stack:${componentStack}` : ""}
              </pre>
            </div>
          )}
        </div>
      </div>
    );
  }
}
