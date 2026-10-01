import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function EngineFailure({ message }: { message: string }) {
  return (
    <div className="engine-error" role="alert">
      <p>{message}</p>
      <Link className="btn ghost" to="/">
        홈으로
      </Link>
    </div>
  );
}

/** 편집기를 내려받거나 그리다 실패해도 화면 전체가 하얗게 되지 않게 감싼다. */
export default class EngineBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('편집기 오류', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return <EngineFailure message="편집기를 불러오지 못했어요. 새로고침하거나 잠시 뒤에 다시 시도해 주세요." />;
    }
    return this.props.children;
  }
}
