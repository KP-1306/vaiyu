// web/src/components/HardErrorBoundary.tsx
import React from "react";

type State = { error: any };

export default class HardErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: any) {
    return { error };
  }

  componentDidCatch(error: any, info: any) {
    // Log full error; shows module/line in devtools
    // eslint-disable-next-line no-console
    console.error("Route error boundary caught:", error, info);
  }

  render() {
    if (this.state.error) {
      const msg =
        (this.state.error && (this.state.error.message || this.state.error.toString())) ||
        "Unknown error";
      return (
        <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", fontFamily: "system-ui" }}>
          <div style={{ textAlign: "center" }}>
            <h1 style={{ fontSize: 24, fontWeight: 700 }}>This route crashed</h1>
            <p style={{ marginTop: 8, color: "#555" }}>{msg}</p>
            {this.state.error?.stack ? (
              <pre
                style={{
                  marginTop: 12,
                  textAlign: "left",
                  background: "#f6f6f6",
                  padding: 12,
                  borderRadius: 8,
                  maxWidth: 800,
                  overflow: "auto",
                }}
              >
                {String(this.state.error.stack)}
              </pre>
            ) : null}
            <button onClick={() => location.reload()} style={{ marginTop: 12 }}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
