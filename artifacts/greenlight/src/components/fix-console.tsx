import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Pause, Play, SkipForward, X, Check, Circle, Loader2 } from 'lucide-react';
import { applyEvent, emptyView, fmtClock, progressOf, type FixEvent, type FixRecording, type FixView, type FixStage } from '@/lib/fix-events';

/**
 * The live fix screen. One component, two sources:
 *  - live: follows the API's event stream for a running fix;
 *  - replay: plays a recorded run with its real pacing, with a scrubber,
 *    play/pause, speed and skip, and a "recorded session" badge.
 * Everything on screen is derived from the events seen so far, so replay and
 * live render identically.
 */
export type ConsoleSource =
  | { kind: 'live'; fixId: string }
  | { kind: 'replay'; recording: FixRecording };

const STAGES: { id: FixStage; label: string }[] = [
  { id: 'preparing', label: 'Prepare' },
  { id: 'fixing', label: 'Fix' },
  { id: 'verifying', label: 'Verify' },
  { id: 'review', label: 'Review' },
];
const STAGE_ORDER: FixStage[] = ['preparing', 'fixing', 'verifying', 'review', 'done', 'failed'];
const BANNER_MS = 4200;

/** Incremental reducer: appends when the prefix grows, rebuilds when it shrinks (seek back). */
function useView(events: FixEvent[], count: number): FixView {
  const ref = useRef<{ idx: number; view: FixView; src: FixEvent[] }>({ idx: 0, view: emptyView(), src: events });
  return useMemo(() => {
    let { idx, view } = ref.current;
    if (ref.current.src !== events || count < idx) { idx = 0; view = emptyView(); }
    for (; idx < count && idx < events.length; idx++) view = applyEvent(view, events[idx]);
    ref.current = { idx, view, src: events };
    return view;
  }, [events, count]);
}

function useLiveEvents(fixId: string) {
  const [events, setEvents] = useState<FixEvent[]>([]);
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!fixId) return;
    const es = new EventSource(`${import.meta.env.BASE_URL}api/greenlight/fixes/${fixId}/events`);
    const buf: FixEvent[] = [];
    let flush: number | undefined;
    es.addEventListener('fix', (m) => {
      buf.push(JSON.parse((m as MessageEvent).data) as FixEvent);
      if (!flush) flush = window.setTimeout(() => { flush = undefined; const batch = buf.splice(0); setEvents((prev) => [...prev, ...batch]); }, 80);
    });
    es.addEventListener('end', () => { setEnded(true); es.close(); });
    es.onerror = () => { if (es.readyState === EventSource.CLOSED) setError(true); };
    return () => { es.close(); if (flush) clearTimeout(flush); };
  }, [fixId]);
  return { events, ended, error };
}

/** A replay clock in timeline milliseconds; advances with rAF while playing. */
function useReplayClock(total: number) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const tRef = useRef(0);
  useEffect(() => { tRef.current = t; }, [t]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const next = Math.min(total, tRef.current + (now - last) * speed);
      last = now; tRef.current = next; setT(next);
      if (next >= total) { setPlaying(false); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, total]);
  const seek = useCallback((ms: number) => { const v = Math.max(0, Math.min(total, ms)); tRef.current = v; setT(v); }, [total]);
  return { t, playing, setPlaying, speed, setSpeed, seek };
}

const TONE: Record<string, string> = { ok: '#4FD99A', bad: '#FF5C6E', warn: '#F5C451', dim: '#7CC9E8' };

function HunkView({ hunk }: { hunk: string }) {
  return (
    <pre className="fc-hunk">
      {hunk.split('\n').map((l, i) => (
        <div key={i} className={l.startsWith('+') ? 'fc-add' : l.startsWith('-') ? 'fc-del' : l.startsWith('@@') ? 'fc-at' : undefined}>{l || ' '}</div>
      ))}
    </pre>
  );
}

function StandardChips({ items }: { items: { standard: string; id: string; blocking: boolean }[] }) {
  const byStd = useMemo(() => {
    const m = new Map<string, { ids: string[]; blocking: number }>();
    for (const i of items) { const e = m.get(i.standard) ?? { ids: [], blocking: 0 }; e.ids.push(i.id); if (i.blocking) e.blocking++; m.set(i.standard, e); }
    return [...m.entries()];
  }, [items]);
  return (
    <div className="fc-chips">
      {byStd.map(([std, e]) => (
        <span key={std} className="fc-chip" title={e.ids.join(', ')}>
          <b>{std}</b> {e.ids.slice(0, 3).join(' · ')}{e.ids.length > 3 ? ` +${e.ids.length - 3}` : ''}{e.blocking ? <i> · {e.blocking} must-fix</i> : null}
        </span>
      ))}
    </div>
  );
}

export function FixConsole({ source, project, wave, onExit }: { source: ConsoleSource; project: string; wave: number; onExit?: () => void }) {
  const replay = source.kind === 'replay' ? source.recording : null;
  const live = useLiveEvents(source.kind === 'live' ? source.fixId : '');
  const events = replay ? replay.events : live.events;
  const total = replay ? replay.durationMs : 0;
  const clock = useReplayClock(total);

  // Live time is wall-clock since the first event arrived; replay time is the scrubber.
  const [liveNow, setLiveNow] = useState(0);
  const liveStart = useRef<number | null>(null);
  useEffect(() => {
    if (replay) return;
    if (events.length && liveStart.current == null) liveStart.current = Date.now() - events[events.length - 1].at;
    const id = window.setInterval(() => { if (liveStart.current != null) setLiveNow(Date.now() - liveStart.current); }, 250);
    return () => clearInterval(id);
  }, [replay, events]);
  const now = replay ? clock.t : liveNow;

  const count = replay ? events.filter((e) => e.at <= now).length : events.length;
  const view = useView(events, count);
  const progress = progressOf(view, now, replay ? total : undefined);
  const pct = Math.round(progress * 100);
  const remaining = replay ? total - now : view.done ? 0 : Math.max(0, (now / Math.max(progress, 0.02)) - now);
  const outcome = !!replay && !!view.done && now >= total;
  const banner = !outcome && view.banner && now - view.banner.at < BANNER_MS ? view.banner : null;
  const finished = !!view.done || view.stage === 'failed';

  // Console autoscroll, paused while the viewer hovers over it.
  const termRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  useEffect(() => { if (!hover && termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight; }, [view.lines.length, hover]);

  // Scrubber: click or drag anywhere on the big bar (replay only).
  const barRef = useRef<HTMLDivElement>(null);
  const scrub = (e: RPointerEvent) => {
    if (!replay || !barRef.current) return;
    const r = barRef.current.getBoundingClientRect();
    clock.seek(((e.clientX - r.left) / r.width) * total);
  };
  const onBarDown = (e: RPointerEvent) => { if (!replay) return; (e.target as Element).setPointerCapture?.(e.pointerId); scrub(e); };
  const onBarMove = (e: RPointerEvent) => { if (replay && e.buttons & 1) scrub(e); };

  // Keyboard for the presenter: space play/pause, ←/→ seek 10 s, End skip.
  useEffect(() => {
    if (!replay) return;
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); clock.setPlaying((p) => !p); }
      else if (e.code === 'ArrowRight') clock.seek(clock.t + 10_000);
      else if (e.code === 'ArrowLeft') clock.seek(clock.t - 10_000);
      else if (e.code === 'End') clock.seek(total);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [replay, clock, total]);

  const active = view.active >= 0 ? view.packages[view.active] : null;
  const nextIdx = view.packageState.findIndex((s, i) => s === 'queued' && i !== view.active);
  const next = nextIdx >= 0 ? view.packages[nextIdx] : null;
  const doneCount = view.packageState.filter((s) => s === 'done').length;
  const touched = Object.entries(view.files);
  const affected = useMemo(() => {
    // Documents (standards and clauses) this run has reached so far: every started or finished package.
    const items = view.packages.flatMap((p, i) => (view.packageState[i] !== 'queued' ? p.items : []));
    return items;
  }, [view.packages, view.packageState]);
  const stageIdx = STAGE_ORDER.indexOf(view.stage);
  const recordedOn = replay ? new Date(replay.recordedAt).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

  return (
    <div className="fc" data-testid="fix-console">
      <header className="fc-top glass">
        <div className="fc-brand">
          <img src={`${import.meta.env.BASE_URL}ddg-mark.png`} alt="" width={28} height={28} />
          <div>
            <div className="lbl">Fix it with Claude</div>
            <div className="font-head text-sm">{project} · Wave {wave}</div>
          </div>
        </div>
        <ol className="fc-stages" aria-label="Stages">
          {STAGES.map((s, i) => {
            const idx = STAGE_ORDER.indexOf(s.id);
            const state = view.stage === 'failed' ? (idx < stageIdx ? 'done' : 'off') : idx < stageIdx ? 'done' : idx === stageIdx ? 'on' : 'off';
            return <li key={s.id} className={`fc-stage fc-stage-${state}`}><span>{i + 1}</span>{s.label}</li>;
          })}
        </ol>
        <div className="fc-meta">
          {replay ? <span className="fc-badge fc-badge-rec" data-testid="badge-recorded">● Recorded session · {recordedOn}</span> : <span className="fc-badge fc-badge-live">● Live</span>}
          <span className="fc-clock font-mono">{fmtClock(now)}<small> / {replay ? fmtClock(total) : finished ? fmtClock(now) : `~${fmtClock(now + remaining)}`}</small></span>
          {onExit && <button className="btn !px-2 !py-1.5 text-xs" onClick={onExit} aria-label="Close console"><X size={14} /></button>}
        </div>
      </header>

      <div className="fc-body">
        <aside className="fc-plan glass">
          <div className="fc-head"><span className="lbl">The plan</span><span className="lbl !text-[#00E5FF]">{doneCount} of {view.packages.length || '—'} fixed</span></div>
          <ol className="fc-list">
            {view.packages.map((p, i) => {
              const st = view.packageState[i];
              return (
                <li key={p.key} className={`fc-pkg fc-pkg-${st}`} data-testid={`pkg-${i}`}>
                  <span className="fc-pkg-ic">{st === 'done' ? <Check size={13} /> : st === 'active' ? <Loader2 size={13} className="fc-spin" /> : <Circle size={9} />}</span>
                  <div className="min-w-0">
                    <div className="fc-pkg-title">{p.title}</div>
                    <div className="fc-pkg-sub">{st === 'active' ? 'Now' : st === 'done' ? 'Fixed' : i === nextIdx ? 'Up next' : 'Queued'} · closes {p.items.length} requirement{p.items.length === 1 ? '' : 's'} in {[...new Set(p.items.map((x) => x.standard))].join(', ')}</div>
                    {st === 'active' && (
                      <div className="fc-pkg-detail">
                        {p.found && <p><span className="lbl">Found</span> {p.found}</p>}
                        <p><span className="lbl">Done when</span> {p.acceptance}</p>
                        {p.where.length > 0 && <p className="font-mono text-[10px]" style={{ color: '#7CC9E8' }}>{p.where.slice(0, 4).join('  ')}</p>}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
            {!view.packages.length && <li className="fc-pkg fc-pkg-queued"><span className="fc-pkg-ic"><Loader2 size={13} className="fc-spin" /></span><div className="fc-pkg-title">Reading the plan…</div></li>}
          </ol>
        </aside>

        <section className="fc-term glass" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
          <div className="fc-head"><span className="lbl">Console</span><span className="lbl !text-[9px]">{hover ? 'paused · move away to follow' : 'following'}</span></div>
          <div className="fc-lines" ref={termRef} data-testid="console-lines">
            {view.lines.map((l, i) => (
              <div key={i} className={`fc-line fc-line-${l.kind}`} style={{ color: l.tone ? TONE[l.tone] : undefined }}>
                <span className="fc-ts">{fmtClock(l.at)}</span>
                <span className="fc-txt">{l.text}</span>
                {l.hunk && <HunkView hunk={l.hunk} />}
              </div>
            ))}
            {!finished && <div className="fc-line fc-cursor"><span className="fc-ts">{fmtClock(now)}</span><span className="fc-txt">▍</span></div>}
          </div>
        </section>

        <aside className="fc-impact glass">
          <div className="fc-head"><span className="lbl">Now</span></div>
          {active ? (
            <div className="fc-now">
              <div className="font-head text-base leading-tight">{active.title}</div>
              <div className="lbl mt-1 !text-[9px]">Affects</div>
              <StandardChips items={active.items} />
            </div>
          ) : view.done ? <div className="fc-now"><div className="font-head text-base">All packages proposed</div><p className="text-xs" style={{ color: '#CFE3EE' }}>Nothing is applied until every changed file is approved.</p></div>
            : <div className="fc-now"><div className="text-sm" style={{ color: '#CFE3EE' }}>{view.stageLabel}</div></div>}
          {next && <div className="fc-next"><span className="lbl !text-[9px]">Up next</span><div className="text-xs">{next.title}</div></div>}

          <div className="fc-head mt-3"><span className="lbl">Documents reached</span><span className="lbl !text-[9px]">{new Set(affected.map((a) => a.standard)).size} standard{new Set(affected.map((a) => a.standard)).size === 1 ? '' : 's'} · {affected.length} clause{affected.length === 1 ? '' : 's'}</span></div>
          {affected.length ? <StandardChips items={affected} /> : <p className="text-xs" style={{ color: '#7CC9E8' }}>Clauses light up here as each package is reached.</p>}

          <div className="fc-head mt-3"><span className="lbl">Files touched</span><span className="lbl !text-[9px]">{touched.length}</span></div>
          <ul className="fc-files">
            {touched.map(([f, s]) => <li key={f}><span className="font-mono">{f}</span><span><b style={{ color: '#4FD99A' }}>+{s.added}</b> <b style={{ color: '#FF5C6E' }}>−{s.removed}</b></span></li>)}
            {!touched.length && <li style={{ color: '#7CC9E8' }}>No edits yet</li>}
          </ul>

          <div className="fc-stats">
            <div><b>{view.reads}</b><span>files read</span></div>
            <div><b>{view.edits}</b><span>edits</span></div>
            <div><b>{view.tests.pass + view.tests.fail ? `${view.tests.pass}/${view.tests.pass + view.tests.fail}` : '—'}</b><span>tests pass</span></div>
            <div><b>{view.cost ? `$${view.cost.usd.toFixed(2)}` : '—'}</b><span>{view.cost ? `${view.cost.turns} turns` : 'cost'}</span></div>
          </div>
        </aside>
      </div>

      <footer className="fc-bar glass">
        <div className="fc-pct font-head" data-testid="progress-pct">{pct}<small>%</small></div>
        <div className="fc-bar-main">
          <div className="fc-bar-line">
            <span className="fc-bar-now">{view.stage === 'failed' ? 'Stopped; no changes applied' : view.done ? view.done.summary : active ? `Fixing ${view.active + 1} of ${view.packages.length}: ${active.title}` : view.stageLabel}</span>
            <span className="lbl !text-[9px] !normal-case !tracking-normal">{view.lastNote}</span>
          </div>
          <div ref={barRef} className={`fc-track${replay ? ' fc-track-scrub' : ''}`} role={replay ? 'slider' : 'progressbar'} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} onPointerDown={onBarDown} onPointerMove={onBarMove} data-testid="progress-track">
            <div className="fc-fill" style={{ width: `${progress * 100}%` }} />
            {replay && view.packages.length > 0 && events.filter((e) => e.type === 'package' && e.status === 'start').map((e) => <i key={e.at} className="fc-tick" style={{ left: `${(e.at / total) * 100}%` }} title={(e as { title: string }).title} />)}
            {replay && <div className="fc-thumb" style={{ left: `${progress * 100}%` }} />}
          </div>
        </div>
        {replay && (
          <div className="fc-ctrl">
            <button className="btn !px-2.5 !py-2" onClick={() => clock.setPlaying((p) => !p)} aria-label={clock.playing ? 'Pause' : 'Play'} data-testid="button-play">{clock.playing ? <Pause size={15} /> : <Play size={15} />}</button>
            {[1, 2, 4, 8].map((s) => <button key={s} className={`btn !px-2 !py-2 text-xs${clock.speed === s ? ' fc-on' : ''}`} onClick={() => clock.setSpeed(s)} data-testid={`button-speed-${s}`}>{s}×</button>)}
            <button className="btn !px-2.5 !py-2" onClick={() => clock.seek(total)} aria-label="Skip to end" data-testid="button-skip"><SkipForward size={15} /></button>
          </div>
        )}
        {!replay && live.error && !finished && <span className="lbl !text-[#F5C451]">Stream lost · retrying</span>}
      </footer>

      {banner && (
        <div key={banner.at} className={`fc-banner fc-banner-${banner.kind}`} aria-live="polite">
          <div className="fc-banner-k lbl">{banner.sub ?? (banner.kind === 'stage' ? 'Stage' : '')}</div>
          <div className="fc-banner-t font-head">{banner.title}</div>
          {banner.kind === 'start' && banner.index != null && view.packages[banner.index] && <StandardChips items={view.packages[banner.index].items} />}
        </div>
      )}

      {outcome && replay && view.done && (
        <div className="fc-outcome glass" data-testid="outcome">
          <div className="lbl">Re-checked by the same rules · before → after</div>
          <div className="fc-outcome-grid">
            {Object.keys(replay.outcome.after).map((std) => {
              const b = Math.round(replay.outcome.before[std] ?? 0), a = Math.round(replay.outcome.after[std] ?? 0);
              return <div key={std}><div className="font-head text-sm">{std}</div><div className="fc-outcome-nums font-mono"><span>{b}%</span><span>→</span><b>{a}%</b></div><div className="fc-outcome-bar"><i style={{ width: `${b}%` }} /><b style={{ width: `${a}%` }} /></div></div>;
            })}
          </div>
          <div className="lbl mt-2 !normal-case !tracking-normal">{replay.outcome.verdictBefore} → <b style={{ color: '#4FD99A' }}>{replay.outcome.verdictAfter}</b> · {view.done.filesChanged} files changed · {fmtClock(total)} · checked by rules, fixed by Claude, re-checked by rules</div>
          <div className="mt-3 flex gap-2"><button className="btn text-xs" onClick={() => { clock.seek(0); clock.setPlaying(true); }}>Replay</button>{onExit && <button className="btn btn-primary text-xs" onClick={onExit}>Review the changes</button>}</div>
        </div>
      )}
    </div>
  );
}
