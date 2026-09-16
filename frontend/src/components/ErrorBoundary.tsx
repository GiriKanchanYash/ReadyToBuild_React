import { Component, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error?: Error };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-msg" style={{ whiteSpace: 'pre-wrap' }}>
          {this.state.error.stack || this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

