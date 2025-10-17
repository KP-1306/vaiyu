import React from "react";

/** Catches errors from React.lazy module loading (rejected dynamic imports). */
export default class LazyBoundary extends React.Component<
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
