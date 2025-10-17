import React from "react";

/** Catches render errors and renders nothing instead of crashing the route. */
export default class SoftBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch() { /* no-op: fail soft */ }
  render() {
    if (this.state.hasError) return null;
    return this.props.children as any;
  }
}
