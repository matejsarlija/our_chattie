import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="my-4 rounded-lg border border-line bg-danger-surface p-6 text-center">
          <h2 className="mb-2 text-lg font-semibold text-danger">Ups! Nešto je pošlo po zlu.</h2>
          <p className="mb-4 text-ink-muted">Došlo je do greške prilikom prikaza ovog dijela aplikacije.</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false })}
            className="rounded-md bg-danger px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Pokušaj ponovno
          </button>
          {(import.meta.env?.MODE === 'development' || (typeof process !== 'undefined' && process.env.NODE_ENV === 'development')) && (
            <details className="mt-4 text-left">
              <summary className="cursor-pointer text-xs text-danger">Detalji greške</summary>
              <pre className="mt-2 max-h-40 overflow-auto rounded bg-surface p-2 font-mono text-xs text-danger">
                {this.state.error?.toString()}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
