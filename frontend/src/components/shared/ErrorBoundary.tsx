import { Component, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/** Keeps one broken page from blanking the whole app. Reset by changing `key` (e.g. on navigation). */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto max-w-md py-24 text-center">
        <h1 className="text-lg font-semibold">This page hit a problem</h1>
        <p className="mt-1.5 text-sm text-text-secondary">{this.state.error.message || "Something went wrong while showing this page."}</p>
        <button className="btn btn-primary mt-5" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}
