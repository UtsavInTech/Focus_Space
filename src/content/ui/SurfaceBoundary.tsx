import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { updateItem } from '@/storage/storage';
import type { FilterFlag } from '../youtube/filters/css-rules';
import { FAIL_OPEN_EVENT, recordIssues, type LayoutFeature } from '../youtube/health';

/**
 * Each FocusSpace surface on youtube.com sits in its own boundary, so one failing — usually because
 * YouTube changed something it relies on — never takes the others, or YouTube, down with it.
 *
 * A surface that replaces part of YouTube (the home, the suggestions beside a video) gives YouTube's own
 * version straight back (fail open) and says so; the rest simply step aside. Either way it is recorded
 * as a layout issue (youtube/health.ts), so Settings shows it and the people building FocusSpace learn
 * about it.
 */
export class SurfaceBoundary extends Component<{ feature: LayoutFeature; failOpen?: FilterFlag; children: ReactNode; quiet?: boolean }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[FocusSpace] ${this.props.feature} failed`, error, info.componentStack);
    void updateItem('health', (h) => recordIssues(h, [this.props.feature])).catch(() => undefined);
    if (this.props.failOpen) window.dispatchEvent(new CustomEvent(FAIL_OPEN_EVENT, { detail: this.props.failOpen }));
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.quiet) return null;
    return (
      <div className="fs-surface-failed" role="status">
        <b>FocusSpace hit a problem here, so YouTube’s own version is showing.</b>
        <span>This usually means YouTube changed its page. Everything else keeps working.</span>
        <button type="button" className="fs-link" onClick={() => this.setState({ failed: false })}>
          <RefreshCw size={13} aria-hidden /> Try again
        </button>
      </div>
    );
  }
}
