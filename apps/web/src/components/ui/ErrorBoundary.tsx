import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-c-bg p-6 text-c-text">
          <div className="max-w-2xl w-full border border-red-800/40 bg-red-950/10 rounded-2xl p-6 space-y-4 shadow-2xl backdrop-blur-md">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-red-500/20 text-red-400 flex items-center justify-center text-lg font-bold">⚠️</span>
              <h2 className="text-base font-semibold text-red-400">
                Something went wrong
              </h2>
            </div>
            <p className="text-xs text-c-muted leading-relaxed">
              An unexpected error occurred while rendering this page. You can try reloading or navigating back to safety.
            </p>
            {this.state.error && (
              <div className="rounded-xl bg-black/50 border border-c-border p-4 font-mono text-[11px] text-red-300 overflow-auto max-h-[300px] space-y-1">
                <div className="font-bold text-red-400">Error: {this.state.error.message}</div>
                {this.state.error.stack && (
                  <pre className="text-[10px] text-c-dim whitespace-pre-wrap leading-normal pt-2 border-t border-c-border/40 mt-2">
                    {this.state.error.stack}
                  </pre>
                )}
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => window.location.reload()}
                className="btn-primary text-xs px-4 py-2"
              >
                Reload Page
              </button>
              <button
                onClick={() => window.location.href = '/storyboard'}
                className="btn-secondary text-xs px-4 py-2"
              >
                Go to Storyboard Projects
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
