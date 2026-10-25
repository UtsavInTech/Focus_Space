import { InstituteManage, InstituteJoinControl } from '@/content/ui/institute/InstituteControls';
import { useEffect, useState } from 'react';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import type { LearningMode } from '@/types/domain';
import type { DashboardData } from '../DashboardApp';
import { openYouTube } from '../DashboardApp';
import { navigate } from '../router';
import { addTemplateWithChannels, deleteMode, missingTemplates, selectMode, SpaceLimitError } from '@/modes/service';
import { groupByCategory } from '@/modes/categories';
import { Alert, Badge, Button, IconButton } from '@/ui/components/primitives';
import { Modal } from '@/ui/components/Modal';
import { CreateSpace } from '@/ui/components/CreateSpace';
import { TemplateCreators } from '@/ui/components/TemplateCreators';
import type { PickedChannel } from '@/ui/components/ChannelPicker';
import { SpaceIcon } from '@/ui/icons';

export const KIND_LABEL = { learning: 'Learning', media: 'Music & video', general: 'General', institute:'Institute' } as const;

export function ModesPage({ data, openCreate }: { data: DashboardData; openCreate: boolean }) {
  const { modes, settings } = data;
  const [creating, setCreating] = useState(openCreate);
  const [deleting, setDeleting] = useState<LearningMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The plan's Space allowance (server-enforced) — a product explanation, not a failure. */
  const [limit, setLimit] = useState<string | null>(null);
  /** A template the learner picked but hasn't finished personalizing yet — see TemplateCreators. */
  const [pendingTemplate, setPendingTemplate] = useState<LearningMode | null>(null);
  const [creatingSpace, setCreatingSpace] = useState(false);
  const templates = missingTemplates(modes);

  const finishTemplate = async (channels: PickedChannel[]) => {
    if (!pendingTemplate) return;
    setCreatingSpace(true);
    setLimit(null);
    try {
      await addTemplateWithChannels(pendingTemplate.id, channels.map((c) => ({ id: c.id, title: c.title, handle: c.handle ?? undefined })));
      setPendingTemplate(null);
    } catch (err) {
      if (err instanceof SpaceLimitError) setLimit(err.message);
      else throw err;
    } finally {
      setCreatingSpace(false);
    }
  };

  useEffect(() => setCreating(openCreate), [openCreate]);

  const closeCreate = () => {
    setCreating(false);
    if (openCreate) navigate('/modes');
  };

  return (
    <>
      <div className="fs-page-head">
        <div>
          <h1 className="fs-h1">Spaces</h1>
          <p>A space is what you came to YouTube for. Pick one on YouTube (home or sidebar) and FocusSpace organises everything around it.</p>
        </div>
        <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
          New space
        </Button>
      </div>

      <div className="fs-grid-cards">
        {modes.map((mode) => {
          const active = mode.id === settings.activeModeId;
          return (
            <article key={mode.id} className="fs-card fs-mode-card" data-active={active}>
              <div className="fs-row" style={{ gap: 12, alignItems: 'flex-start' }}>
                <span className="fs-mode-emoji" aria-hidden>
                  <SpaceIcon name={mode.icon} size={22} />
                </span>
                <div className="fs-grow">
                  <div className="fs-row-wrap" style={{ gap: 6 }}>
                    <h2 className="fs-h3">{mode.name}</h2>
                    {active && <Badge tone="accent">Active</Badge>}
                  </div>
                  <p>{mode.description || `${KIND_LABEL[mode.kind]} space`}</p>
                </div>
              </div>
              <p className="fs-caption" style={{ minHeight: 0 }}>
                {KIND_LABEL[mode.kind]} · {mode.topics.length} topics · {mode.allowedChannels.length} channels · discovery {mode.discovery ? 'on' : 'off'}
              </p>
              <div className="fs-mode-card-foot">
                <Button
                  size="sm"
                  variant={active ? 'soft' : 'secondary'}
                  icon={active ? <Check /> : undefined}
                  onClick={async () => {
                    await selectMode(mode.id);
                    openYouTube();
                  }}
                >
                  {active ? 'Open on YouTube' : 'Use this space'}
                </Button>
                {!mode.source&&<Button size="sm" variant="ghost" icon={<Pencil />} onClick={() => navigate(`/modes/${mode.id}`)}>
                  Edit
                </Button>}
                <span className="fs-grow" />
                {mode.source?<InstituteManage mode={mode}/>:<IconButton size="sm" label={`Delete ${mode.name}`} icon={<Trash2 />} disabled={modes.length <= 1} onClick={() => setDeleting(mode)} />}
              </div>
            </article>
          );
        })}
      </div>

      <InstituteJoinControl/>
      {limit && <Alert tone="info">{limit}</Alert>}

      {templates.length > 0 && (
        <section className="fs-stack-sm fs-add-space" aria-labelledby="add-space">
          <div>
            <h2 id="add-space" className="fs-h3">
              Add a built-in space
            </h2>
            <p className="fs-caption">Each one comes with topics and keywords already set up. Nothing is created until you pick one.</p>
          </div>
          {/* Grouped so the list reads as a range of subjects rather than sixteen unrelated buttons. */}
          {groupByCategory(templates).map(({ category, modes: group }) => (
            <div key={category.id} className="fs-template-group">
              <span className="fs-label">{category.name}</span>
              <div className="fs-row-wrap">
                {group.map((t) => (
                  <Button key={t.id} size="sm" variant="secondary" icon={<SpaceIcon name={t.icon} size={14} />} onClick={() => setPendingTemplate(t)}>
                    {t.name}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      <Modal open={creating} onClose={closeCreate} title="New space" width={580}>
        <CreateSpace
          modes={modes}
          onCancel={closeCreate}
          onCreated={(mode) => {
            setCreating(false);
            navigate(`/modes/${mode.id}`);
          }}
        />
      </Modal>

      <Modal
        open={!!pendingTemplate}
        onClose={() => setPendingTemplate(null)}
        title={pendingTemplate ? `Creators for ${pendingTemplate.name}` : 'Creators'}
        subtitle="Optional. You can skip this and change it later."
        width={580}
      >
        {pendingTemplate && (
          <TemplateCreators template={pendingTemplate} busy={creatingSpace} onSkip={() => void finishTemplate([])} onContinue={(channels) => void finishTemplate(channels)} />
        )}
      </Modal>

      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        subtitle="Its topics, channels and playlists will be removed from FocusSpace."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              icon={<Trash2 />}
              onClick={async () => {
                try {
                  if (deleting) await deleteMode(deleting.id);
                  setDeleting(null);
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Could not delete space.');
                }
              }}
            >
              Delete space
            </Button>
          </>
        }
      >
        {error ? <Alert tone="danger">{error}</Alert> : <p className="fs-muted">If this is your active space, FocusSpace switches to your default space.</p>}
      </Modal>
    </>
  );
}
