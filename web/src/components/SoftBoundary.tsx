import React from "react";

/** Catches render-time errors and renders nothing instead of crashing the route. */
export default class SoftBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch() { /* swallow */ }
  render() { return this.state.hasError ? null : (this.props.children as any); }
}
