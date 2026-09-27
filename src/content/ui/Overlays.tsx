import { Compass } from 'lucide-react';
import type { LearningMode } from '@/types/domain';
import type { Assessment } from '@/ai/sidekick';
import type { VideoMetadata } from '@/learning/classifier';
import { setChannelRule } from '@/modes/service';
import { Button } from '@/ui/components/primitives';
import { SpaceIcon } from '@/ui/icons';
import { spaNavigate } from '../youtube/spa';

/** "This doesn't appear to match your DSA space." — a question, not a wall. */
export function OffTrackNudge({ mode, assessment, strict, channel, onStay, onWatch }: { mode: LearningMode; assessment: Assessment; strict: boolean; channel: VideoMetadata | null; onStay: () => void; onWatch: () => void }) {
  const ref = channel?.channelId || channel?.channelHandle ? { id: channel.channelId ?? '', title: channel.channelTitle ?? channel.channelHandle ?? '', handle: channel.channelHandle } : null;
  return (
    <div className="fs-nudge" role="dialog" aria-labelledby="fs-nudge-title">
      <div className="fs-row">
        <SpaceIcon name={mode.icon} size={16} />
        <span className="fs-eyebrow">You're in {mode.name}</span>
      </div>
      <h3 id="fs-nudge-title" className="fs-h3">
        {assessment.headline}
      </h3>
      <p className="fs-body-sm fs-muted">{assessment.detail}</p>
      <p className="fs-caption">{strict ? 'Paused while you decide.' : 'Continue anyway?'}</p>
      <div className="fs-row-wrap">
        <Button variant="primary" onClick={onStay}>
          Back to {mode.name}
        </Button>
        <Button variant="ghost" onClick={onWatch}>
          Watch anyway
        </Button>
      </div>
      {ref && assessment.classification.channelRule !== 'blocked' && (
        <button
          type="button"
          className="fs-link"
          style={{ alignSelf: 'flex-start' }}
          onClick={async () => {
            await setChannelRule(mode.id, ref, 'allowed');
            onWatch();
          }}
        >
          Always allow this channel in {mode.name}
        </button>
      )}
    </div>
  );
}

export function ExploreGate({ mode, onAllow }: { mode: LearningMode; onAllow: () => void }) {
  return (
    <div className="fs-gate">
      <div className="fs-card fs-gate-card fs-animate-in">
        <span className="fs-empty-icon">
          <Compass />
        </span>
        <h2 className="fs-h2">Explore is paused in {mode.name}</h2>
        <p className="fs-muted">Explore pages are designed to pull you somewhere new. You came here for {mode.name}.</p>
        <div className="fs-row-wrap" style={{ justifyContent: 'center' }}>
          <Button variant="primary" onClick={() => spaNavigate('/')}>
            Back to {mode.name}
          </Button>
          <Button variant="ghost" onClick={onAllow}>
            Open this page anyway
          </Button>
        </div>
      </div>
    </div>
  );
}
