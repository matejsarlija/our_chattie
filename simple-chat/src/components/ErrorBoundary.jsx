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
        <div className="p-6 my-4 bg-red-50 border border-red-200 rounded-lg text-center">
          <h2 className="text-lg font-semibold text-red-800 mb-2">Ups! Nešto je pošlo po zlu.</h2>
          <p className="text-red-600 mb-4">Došlo je do greške prilikom prikaza ovog dijela aplikacije.</p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
          >
            Pokušaj ponovno
          </button>
          {(import.meta.env?.MODE === 'development' || (typeof process !== 'undefined' && process.env.NODE_ENV === 'development')) && (
            <details className="mt-4 text-left">
              <summary className="text-xs text-red-400 cursor-pointer">Detalji greške</summary>
              <pre className="mt-2 text-xs text-red-500 overflow-auto max-h-40 p-2 bg-white rounded">
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
