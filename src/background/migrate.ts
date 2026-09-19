import { getItems, hasItem, setItem, setItems } from '@/storage/storage';
import { SCHEMA_VERSION } from '@/storage/schema';
import { pruneUnusedTemplates } from '@/modes/service';
import { DEFAULT_MODES } from '@/modes/templates';

/**
 * One-time upgrades of stored data. Runs when the worker starts (an update can wake it before
 * `onInstalled` fires) and again from `onInstalled`; both share one run, and a finished run records
 * the schema version so it never repeats.
 */
let running: Promise<void> | null = null;
export function migrate(): Promise<void> {
  running ??= run();
  return running;
}

async function run(): Promise<void> {
  if (!(await hasItem('schemaVersion'))) {
    // A fresh install: nothing stored, nothing to upgrade.
    await setItem('schemaVersion', SCHEMA_VERSION);
    return;
  }
  const { schemaVersion } = await getItems(['schemaVersion']);
  if (schemaVersion < 5) await toSchema5();
  await setItem('schemaVersion', SCHEMA_VERSION);
}

/**
 * Schema 5 stopped seeding every template as a Space, and gave local data an owner.
 *
 * An install from before it that never edited its Spaces has no `modes` key at all — its seven Spaces
 * came from the old default — so that default is rebuilt first and pruned like any other, rather than
 * letting the Spaces the learner was using vanish.
 */
async function toSchema5(): Promise<void> {
  const { settings, topicPlaylists, auth } = await getItems(['settings', 'topicPlaylists', 'auth']);
  const modes = (await hasItem('modes')) ? (await getItems(['modes'])).modes : structuredClone(DEFAULT_MODES);
  // Pre-5 settings defaulted to DSA without writing it; read it back the same way so DSA is not mistaken for unused.
  const storedSettings = (await hasItem('settings')) ? settings : { ...settings, activeModeId: 'dsa', defaultModeId: 'dsa' };
  const kept = pruneUnusedTemplates(modes, storedSettings, topicPlaylists);
  await setItems({ modes: kept, settings: storedSettings });

  // Data from before ownership existed was made in this browser by whoever is signed in to it now (or by a
  // guest, if nobody is). It is theirs as it stands — nobody else is ever offered it.
  if (!(await hasItem('ownership'))) await setItems({ ownership: { owner: auth.user?.id ?? 'guest', epoch: 0 } });
}
