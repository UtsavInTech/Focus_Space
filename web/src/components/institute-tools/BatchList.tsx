import type { FormEvent } from 'react';
import { onLinkClick } from '../../router';
import type { Batch } from '../../institute-api';
import { formFields, type Act, type Call } from './shared';

/** Each batch's join link and code, code rotation, and today's class. */
export function BatchList({ batches, prefix, busy, act, call, reload, notify }: { batches: Batch[]; prefix: string; busy: boolean; act: Act; call: Call; reload: () => Promise<void>; notify: (message: string) => void }) {
  return (
    <section>
      <h2>Batches</h2>
      <ul className="fsw-tool-list">
        {batches.map((batch) => (
          <BatchRow key={batch.id} batch={batch} prefix={prefix} busy={busy} act={act} call={call} reload={reload} notify={notify} />
        ))}
      </ul>
    </section>
  );
}

function BatchRow({ batch, prefix, busy, act, call, reload, notify }: { batch: Batch; prefix: string; busy: boolean; act: Act; call: Call; reload: () => Promise<void>; notify: (message: string) => void }) {
  // Rotating issues a new code and the old one stops working at once.
  const rotate = () =>
    void act(async () => {
      await call(`${prefix}/batches/${batch.id}/rotate`, {});
      await reload();
    });

  const setToday = (e: FormEvent<HTMLFormElement>) => {
    const f = formFields(e);
    void act(async () => {
      await call(`${prefix}/batches/${batch.id}/assignments`, { itemRef: f.get('video'), kind: 'today', note: f.get('note') || undefined });
      notify('Today’s class saved.');
    });
  };

  return (
    <li>
      <strong>{batch.name}</strong>
      <span>{batch.seats} seats</span>
      <a href={`/join/${batch.join_code}`} onClick={onLinkClick(`/join/${batch.join_code}`)}>
        Join link
      </a>
      <code>{batch.join_code}</code>
      <button disabled={busy} onClick={rotate}>
        Rotate code
      </button>
      <form onSubmit={setToday}>
        <label>
          Today’s video id
          <input name="video" required />
        </label>
        <label>
          Class note
          <input name="note" />
        </label>
        <button disabled={busy}>Set today’s class</button>
      </form>
    </li>
  );
}
