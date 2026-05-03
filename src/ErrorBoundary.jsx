import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full shadow-lg text-center">
            <h2 className="text-xl font-bold text-red-600 mb-2">出错了</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-4">应用遇到意外错误，请刷新页面重试。</p>
            <pre className="text-left text-xs bg-gray-100 dark:bg-gray-700 p-3 rounded overflow-auto max-h-40 mb-4">
              {this.state.error?.message}
            </pre>
            <button onClick={() => window.location.reload()}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
              刷新页面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
