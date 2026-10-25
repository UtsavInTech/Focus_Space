import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowUpRight, Check, Copy, Download, MessageCircle, Phone, Search, Send } from 'lucide-react';
import { CountUp, DailyBars, TalentMap } from './charts';
import { count, percent, placeHash, type Place, type StudentFilter } from './model';
import { hiddenTalent, needsHelp, quiet, topper, type Action, type DayCount, type Member, type Request, type Week } from './insights';
import { ago, hoursAndMinutes } from './report';

const rise = { hidden: { opacity: 0, y: 24 }, shown: { opacity: 1, y: 0 } };
const stagger = { hidden: {}, shown: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } } };

export const telLink = (phone: string) => `tel:${phone}`;
export const whatsappLink = (phone: string, text?: string) => `https://wa.me/${phone.replace(/\D/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
export const phoneText = (phone: string) => {
  const m = /^\+91(\d{5})(\d{5})$/.exec(phone);
  return m ? `+91 ${m[1]} ${m[2]}` : phone;
};
export const initials = (name: string) => name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

/* ─── Overview: the morning edition ─────────────────────────────────────── */

export function Overview({ orgName, story, actions, series, week: w, members, open, go, now }: {
  orgName: string;
  story: string;
  actions: Action[];
  series: DayCount[];
  week: Week;
  members: Member[];
  open: number;
  go: (p: Place) => void;
  now: number;
}) {
  const sharing = members.filter((m) => m.sharing).length;
  const delta = (v: number | null) => (v === null ? null : <em className={v >= 0 ? 'is-up' : 'is-down'}>{v >= 0 ? '↑' : '↓'} {percent(Math.abs(v))}</em>);
  const finishedChange = w.previousFinished ? w.finished / w.previousFinished - 1 : null;
  return (
    <motion.div variants={stagger} initial="hidden" animate="shown">
      <motion.header variants={rise} className="fss-edition">
        <p className="fss-eyebrow">{new Date(now).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {orgName}</p>
        <h1 className="fss-story">{story}</h1>
      </motion.header>

      <motion.section variants={rise} className="fss-section is-tight">
        <div className="fss-section-head is-row">
          <div>
            <p className="fss-eyebrow">Act on today</p>
            <h2>{actions.length ? `${actions.length} thing${actions.length === 1 ? '' : 's'}, most urgent first.` : 'Nothing needs you today.'}</h2>
          </div>
        </div>
        <ol className="fss-acts">
          {actions.map((a, i) => (
            <li key={a.title}>
              <a href={placeHash(a.place)} onClick={(e) => { e.preventDefault(); go(a.place); }}>
                <span className="fss-act-no">{i + 1}</span>
                <span className="fss-act-body">
                  <span className={`fss-act-area is-${a.priority}`}><i /> {a.area}</span>
                  <b>{a.title}</b>
                  <span>{a.detail}</span>
                </span>
                <ArrowUpRight size={16} aria-hidden="true" className="fss-act-go" />
              </a>
            </li>
          ))}
        </ol>
      </motion.section>

      <motion.section variants={rise} className="fss-split">
        <div className="fss-panel">
          <div className="fss-panel-head">
            <p className="fss-eyebrow">The last four weeks</p>
            <h2>{w.change === null ? `${count(w.plays)} lectures begun this week` : `${count(w.plays)} lectures begun this week, ${w.change >= 0 ? 'up' : 'down'} ${percent(Math.abs(w.change))} on last week`}</h2>
            <p>Lectures begun each day across all courses. <i className="fss-key is-soft" /> begun <i className="fss-key is-done" /> finished. Point at a day for its numbers.</p>
          </div>
          <DailyBars days={series} />
        </div>
        <aside className="fss-glance">
          <p className="fss-eyebrow">At a glance</p>
          <div><span>Students</span><strong><CountUp value={members.length} /></strong><small>{count(sharing)} share progress ({percent(members.length ? sharing / members.length : 0)})</small></div>
          <div><span>Lectures begun, 7 days</span><strong><CountUp value={w.plays} /> {delta(w.change)}</strong><small>{count(w.previousPlays)} the week before</small></div>
          <div><span>Lectures finished, 7 days</span><strong><CountUp value={w.finished} /> {delta(finishedChange)}</strong><small>{count(w.previousFinished)} the week before</small></div>
          <a href={placeHash({ room: 'requests' })} onClick={(e) => { e.preventDefault(); go({ room: 'requests' }); }} className={open ? 'is-alert' : undefined}>
            <span>Waiting for a call</span><strong><CountUp value={open} /></strong><small>{open ? 'Open the requests' : 'All caught up'}</small>
          </a>
        </aside>
      </motion.section>
    </motion.div>
  );
}

/* ─── Students: everyone enrolled ─────────────────────────────────────────── */

const FILTER_LABEL: Record<StudentFilter, string> = {
  all: 'Everyone',
  priority: 'Asked to talk',
  sharing: 'Share progress',
  toppers: 'Toppers',
  talent: 'Hidden talent',
  help: 'Needs help',
  quiet: 'Went quiet',
  private: 'Progress private',
};

export function matches(filter: StudentFilter, m: Member, now: number): boolean {
  switch (filter) {
    case 'priority': return m.wantsContact || m.openRequest;
    case 'sharing': return m.sharing;
    case 'toppers': return topper(m);
    case 'talent': return hiddenTalent(m);
    case 'help': return needsHelp(m);
    case 'quiet': return quiet(m, now);
    case 'private': return !m.sharing;
    default: return true;
  }
}

export function StudentsPage({ members, filter, go, onExport, now }: {
  members: Member[];
  filter: StudentFilter;
  go: (p: Place) => void;
  onExport: (priorityOnly: boolean) => Promise<string | null>;
  now: number;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'priority' | 'quiz' | 'completion' | 'recent' | 'name'>('priority');
  const [shown, setShown] = useState(80);
  const [exporting, setExporting] = useState(false);
  const counts = useMemo(() => Object.fromEntries((Object.keys(FILTER_LABEL) as StudentFilter[]).map((f) => [f, members.filter((m) => matches(f, m, now)).length])), [members, now]);
  const list = members
    .filter((m) => matches(filter, m, now))
    .filter((m) => !query || m.name.toLowerCase().includes(query.toLowerCase()) || m.phone.includes(query.replace(/\s/g, '')))
    .sort((a, b) => {
      if (sort === 'quiz') return (b.quiz ?? -1) - (a.quiz ?? -1);
      if (sort === 'completion') return (b.completion ?? -1) - (a.completion ?? -1);
      if (sort === 'recent') return (b.lastActive ?? 0) - (a.lastActive ?? 0);
      if (sort === 'name') return a.name.localeCompare(b.name);
      return Number(b.openRequest) - Number(a.openRequest) || Number(b.wantsContact) - Number(a.wantsContact) || (b.quiz ?? -1) - (a.quiz ?? -1);
    });
  const mapped = list.filter((m) => m.sharing && m.completion !== null);
  const download = async (priority: boolean) => {
    setExporting(true);
    try { await onExport(priority); } finally { setExporting(false); }
  };

  return (
    <motion.div variants={stagger} initial="hidden" animate="shown">
      <motion.header variants={rise} className="fss-hero is-room is-compact">
        <p className="fss-eyebrow">Students</p>
        <h1><CountUp value={members.length} /> students <span>· {count(counts.priority)} asked to talk</span></h1>
        <p className="fss-lede">Every student shared their name and verified number when they joined. Progress, quiz scores and study time appear for the {count(counts.sharing)} who chose to share them.</p>
      </motion.header>

      <motion.div variants={rise} className="fss-toolbar">
        <div className="fss-filters" role="group" aria-label="Show">
          {(Object.keys(FILTER_LABEL) as StudentFilter[]).map((f) => (
            <a key={f} href={placeHash({ room: 'students', filter: f })} aria-current={filter === f ? 'true' : undefined}
              onClick={(e) => { e.preventDefault(); go({ room: 'students', filter: f }); }}>
              {FILTER_LABEL[f]} <small>{counts[f]}</small>
            </a>
          ))}
        </div>
        <div className="fss-toolbar-row">
          <label className="fss-search"><Search size={15} aria-hidden="true" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or number" aria-label="Search students" /></label>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
            <option value="priority">Asked to talk first</option>
            <option value="quiz">Highest quiz score</option>
            <option value="completion">Most lectures watched</option>
            <option value="recent">Recently active</option>
            <option value="name">Name</option>
          </select>
          <button type="button" className="fss-ghost" disabled={exporting} onClick={() => void download(filter === 'priority')}>
            <Download size={15} aria-hidden="true" /> {filter === 'priority' ? 'Download call list' : 'Download all (CSV)'}
          </button>
        </div>
      </motion.div>

      {mapped.length >= 8 && ['all', 'sharing', 'toppers', 'talent', 'help'].includes(filter) && (
        <motion.section variants={rise} className="fss-panel">
          <div className="fss-panel-head">
            <h2>Where each student stands</h2>
            <p>One dot per student sharing progress: lectures watched across, average quiz score up. Pick a group to list only them.</p>
          </div>
          <TalentMap students={mapped} selected={null} onSelect={(id) => go({ room: 'student', id })}
            group={filter === 'toppers' ? 'toppers' : filter === 'talent' ? 'talent' : filter === 'help' ? 'help' : null}
            onGroup={(g) => go({ room: 'students', filter: g === 'toppers' ? 'toppers' : g === 'talent' ? 'talent' : g === 'help' ? 'help' : 'all' })} />
        </motion.section>
      )}

      <motion.section variants={rise} className="fss-panel is-flush">
        <div className="fss-table" role="table" aria-label="Students">
          <div className="fss-tr is-head" role="row">
            <span role="columnheader">Student</span><span role="columnheader">Number</span><span role="columnheader">Lectures</span><span role="columnheader">Quiz</span><span role="columnheader">Time</span><span role="columnheader">Last active</span>
          </div>
          {list.slice(0, shown).map((m) => (
            <a key={m.id} role="row" className="fss-tr" href={placeHash({ room: 'student', id: m.id })} onClick={(e) => { e.preventDefault(); go({ room: 'student', id: m.id }); }}>
              <span role="cell" className="fss-who">
                <span className="fss-avatar" aria-hidden="true">{initials(m.name)}</span>
                <span><b>{m.name}</b>{(m.openRequest || m.wantsContact) && <em className="fss-badge is-priority">{m.openRequest ? 'Waiting for a call' : 'Asked to talk'}</em>}</span>
              </span>
              <span role="cell" className="fss-mono">{phoneText(m.phone)}</span>
              <span role="cell">{m.sharing ? <span className="fss-mini"><span className="fss-meter"><i style={{ width: `${m.completion ?? 0}%` }} /></span>{m.completion ?? 0}%</span> : <em className="fss-private">Private</em>}</span>
              <span role="cell">{m.sharing && m.quiz !== null ? `${m.quiz}%` : '—'}</span>
              <span role="cell">{m.sharing && m.watchSeconds ? hoursAndMinutes(m.watchSeconds) : '—'}</span>
              <span role="cell">{m.sharing ? ago(m.lastActive, now) : '—'}</span>
            </a>
          ))}
          {!list.length && <p className="fss-empty">No students match.</p>}
        </div>
        {list.length > shown && <button type="button" className="fss-more" onClick={() => setShown((n) => n + 80)}>Show {Math.min(80, list.length - shown)} more of {list.length}</button>}
      </motion.section>
    </motion.div>
  );
}

/* ─── Requests: students who asked to be called ─────────────────────────── */

const SOURCE: Record<Request['source'], string> = {
  join: 'Said “contact me” when joining',
  sharing: 'Turned on “contact me”',
  button: 'Pressed “Talk to your faculty”',
};

export function RequestsPage({ requests, members, onHandled, go, now }: {
  requests: Request[];
  members: Member[];
  onHandled: (id: string) => void;
  go: (p: Place) => void;
  now: number;
}) {
  const [tab, setTab] = useState<'open' | 'done'>('open');
  const open = requests.filter((r) => r.handledAt === null);
  const done = requests.filter((r) => r.handledAt !== null);
  const list = tab === 'open' ? open : done;
  const byId = new Map(members.map((m) => [m.id, m]));

  return (
    <motion.div variants={stagger} initial="hidden" animate="shown">
      <motion.header variants={rise} className="fss-hero is-room is-compact">
        <p className="fss-eyebrow">Requests</p>
        <h1><CountUp value={open.length} /> waiting <span>for a call.</span></h1>
        <p className="fss-lede">Students who asked your institute to get in touch. They come first: call them while the interest is fresh, then mark each one done.</p>
      </motion.header>
      <motion.div variants={rise} className="fss-segment is-wide" role="group" aria-label="Requests">
        <button type="button" aria-pressed={tab === 'open'} onClick={() => setTab('open')}>Waiting ({open.length})</button>
        <button type="button" aria-pressed={tab === 'done'} onClick={() => setTab('done')}>Done ({done.length})</button>
      </motion.div>
      <motion.ul variants={rise} className="fss-requests">
        {list.map((r) => {
          const m = byId.get(r.userId);
          return (
            <li key={r.id} className={r.handledAt ? 'is-done' : undefined}>
              <span className="fss-avatar is-large" aria-hidden="true">{initials(r.name)}</span>
              <div className="fss-request-body">
                <div className="fss-request-top">
                  <b>{r.name}</b>
                  <span className="fss-mono">{phoneText(r.phone)}</span>
                  <small>{SOURCE[r.source]} · {ago(r.createdAt, now)}{r.courseTitle ? ` · ${r.courseTitle}` : ''}</small>
                </div>
                {r.note && <p className="fss-note">“{r.note}”</p>}
                {m?.sharing && (
                  <p className="fss-request-facts">
                    {m.completion ?? 0}% of lectures · quiz {m.quiz === null ? '—' : `${m.quiz}%`} · last active {ago(m.lastActive, now)}
                  </p>
                )}
                <div className="fss-request-actions">
                  <a className="fss-cta is-small" href={telLink(r.phone)}><Phone size={15} aria-hidden="true" /> Call</a>
                  <a className="fss-ghost" href={whatsappLink(r.phone, `Hello ${r.name.split(' ')[0]}, this is your institute. You asked us to get in touch.`)} target="_blank" rel="noreferrer"><MessageCircle size={15} aria-hidden="true" /> WhatsApp</a>
                  <a className="fss-ghost" href={placeHash({ room: 'student', id: r.userId })} onClick={(e) => { e.preventDefault(); go({ room: 'student', id: r.userId }); }}>Open report</a>
                  {!r.handledAt && <button type="button" className="fss-ghost" onClick={() => onHandled(r.id)}><Check size={15} aria-hidden="true" /> Mark done</button>}
                  {r.handledAt && <small>Done {ago(r.handledAt, now)}</small>}
                </div>
              </div>
            </li>
          );
        })}
        {!list.length && <li className="fss-empty">{tab === 'open' ? 'Nobody is waiting. New requests appear here the moment a student asks.' : 'Nothing done yet.'}</li>}
      </motion.ul>
    </motion.div>
  );
}

/* ─── Morning brief ─────────────────────────────────────────────────────── */

export function BriefPage({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the text stays selectable on the page */
    }
  };
  return (
    <motion.div variants={stagger} initial="hidden" animate="shown">
      <motion.header variants={rise} className="fss-hero is-room is-compact">
        <p className="fss-eyebrow">Morning brief</p>
        <h1>Today, <span>in one message.</span></h1>
        <p className="fss-lede">Yesterday’s numbers, the three things to act on, and who went quiet. Share it with your faculty group on WhatsApp in one tap.</p>
      </motion.header>
      <motion.section variants={rise} className="fss-brief">
        <pre>{text}</pre>
        <div className="fss-request-actions">
          <a className="fss-cta" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"><Send size={16} aria-hidden="true" /> Share on WhatsApp</a>
          <button type="button" className="fss-ghost" onClick={() => void copy()}>{copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />} {copied ? 'Copied' : 'Copy text'}</button>
        </div>
      </motion.section>
    </motion.div>
  );
}
