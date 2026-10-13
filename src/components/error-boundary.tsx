'use client';

import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error Boundary to catch render errors in chat components.
 * Prevents entire chat from crashing on a single component error.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log to console for dev; in prod this could send to error tracking service
    console.error('[ErrorBoundary] caught error:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default fallback UI
      return (
        <div className="flex flex-col items-center justify-center p-8 gap-4 text-center">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="size-8" />
          </div>
          <div className="space-y-2 max-w-md">
            <h3 className="text-lg font-semibold">เกิดข้อผิดพลาด</h3>
            <p className="text-sm text-muted-foreground">
              ส่วนประกอบนี้โหลดไม่สำเร็จ ลองโหลดใหม่อีกครั้ง
            </p>
            {this.state.error && (
              <details className="text-left text-xs text-muted-foreground">
                <summary className="cursor-pointer select-none">รายละเอียดข้อผิดพลาด</summary>
                <pre className="mt-2 p-2 rounded bg-muted/50 overflow-x-auto whitespace-pre-wrap">
                  {this.state.error.message}
                  {this.state.error.stack && `\n\n${this.state.error.stack}`}
                </pre>
              </details>
            )}
          </div>
          <Button onClick={this.handleRetry} className="gap-2">
            <RefreshCw className="size-4" />
            ลองใหม่
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Specialized error boundary for chat view with contextual fallback.
 */
export function ChatErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={
        <div className="flex flex-col items-center justify-center min-h-[300px] p-8 gap-4">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="size-8" />
          </div>
          <div className="text-center space-y-2">
            <h3 className="text-lg font-semibold">แชทโหลดไม่สำเร็จ</h3>
            <p className="text-sm text-muted-foreground">
              เกิดข้อผิดพลาดขณะโหลดหน้าแชท กรุณาลองใหม่
            </p>
          </div>
          <Button onClick={() => window.location.reload()} className="gap-2">
            <RefreshCw className="size-4" />
            รีเฟรชหน้า
          </Button>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}