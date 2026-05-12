import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  showDetails: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, showDetails: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[boot] React error boundary caught:", error, info?.componentStack);
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

  render() {
    if (!this.state.hasError) return this.props.children;

    const message = this.state.error?.message ?? "Unknown error";
    const stack = this.state.error?.stack ?? "";

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
            <pre
              style={{
                marginTop: 12,
                padding: 12,
                background: "#f3f4f6",
                borderRadius: 8,
                fontSize: 11,
                color: "#374151",
                textAlign: "left",
                overflow: "auto",
                maxHeight: 240,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {message}
              {stack ? `\n\n${stack}` : ""}
            </pre>
          )}
        </div>
      </div>
    );
  }
}
