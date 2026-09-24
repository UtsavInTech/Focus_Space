import { useState } from 'react';
import type { LearningMode } from '@/types/domain';
import { ChannelPicker, type PickedChannel } from './ChannelPicker';
import { Button } from './primitives';

/**
 * Optional creator-preference step shown right after a template (default mode) is picked.
 *
 * Reuses exactly the mechanism the custom "New space" flow already has (CreateSpace.tsx's
 * `ChannelPicker`, seeded with a `suggestQuery`) rather than inventing a second one — a template-created
 * Space gets the same "who do you like learning from, or let FocusSpace discover creators for you" choice
 * a custom one already offers. Always skippable: FocusSpace's behavioral channel affinity
 * (src/learning/discovery.ts's `ChannelAffinity`) picks up unsubscribed-but-watched creators over time
 * regardless of anything chosen here.
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
    <div className="fs-stack">
      <p className="fs-body-sm fs-muted-line">
        Who do you like learning {template.name} from? FocusSpace discovers great channels either way — this just gives your subscriptions a head
        start.
      </p>
      <ChannelPicker selected={channels} onChange={setChannels} suggestQuery={template.searchHint || template.name} />
      <div className="fs-row" style={{ justifyContent: 'space-between' }}>
        <Button variant="ghost" disabled={busy} onClick={onSkip}>
          Skip — let FocusSpace discover creators
        </Button>
        <Button variant="primary" loading={busy} onClick={() => onContinue(channels)}>
          {channels.length ? `Add ${channels.length} and continue` : 'Continue'}
        </Button>
      </div>
    </div>
  );
}
