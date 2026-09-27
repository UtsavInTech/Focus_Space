import { useState } from 'react';
import type { LearningMode } from '@/types/domain';
import { ChannelPicker, type PickedChannel } from './ChannelPicker';
import { Button } from './primitives';

/**
 * The optional creator step, right after a Space is picked.
 *
 * It is optional on purpose, and the wording has to make that obvious: someone who has just said "I want
 * to learn DSA" should not now have to evaluate a recommendation system. Skipping is a real answer, not
 * a lesser one — FocusSpace's behavioral channel affinity (learning/discovery.ts) picks up the creators
 * they actually watch either way. Picking someone here only gives that a head start.
 */
export function TemplateCreators({
  template,
  busy,
  onSkip,
  onContinue,
}: {
  template: LearningMode;
  busy?: boolean;
  onSkip: () => void;
  onContinue: (channels: PickedChannel[]) => void;
}) {
  const [channels, setChannels] = useState<PickedChannel[]>([]);
  return (
    <div className="fs-stack fs-creators">
      <p className="fs-body-sm fs-muted-line">
        Already have someone you learn {template.name} from? Add them and they’ll come first. If not, skip this and FocusSpace finds good
        creators for this space on its own.
      </p>
      <ChannelPicker selected={channels} onChange={setChannels} suggestQuery={template.searchHint || template.name} mode={template} />
      <div className="fs-creators-foot">
        <Button variant="ghost" disabled={busy} onClick={onSkip}>
          Skip for now
        </Button>
        <Button variant="primary" loading={busy} onClick={() => onContinue(channels)}>
          {channels.length ? `Add ${channels.length} and continue` : 'Continue'}
        </Button>
      </div>
    </div>
  );
}
