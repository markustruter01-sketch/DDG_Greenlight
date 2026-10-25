import { useEffect, useState } from 'react';
import { useListProjects } from '@workspace/api-client-react';
import { Link, useLocation, useParams } from 'wouter';
import { Shell } from '@/components/shell';
import { FixConsole } from '@/components/fix-console';
import { ErrorBlock, Skeleton } from '@/components/gl';
import type { FixRecording } from '@/lib/fix-events';

/** Loads a recording published with the app (public/demo/<name>.json). */
export function useRecording(name: string | null) {
  const [rec, setRec] = useState<FixRecording | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ok' | 'missing'>('idle');
  useEffect(() => {
    if (!name) return;
    let gone = false;
    setState('loading');
    fetch(`${import.meta.env.BASE_URL}demo/${encodeURIComponent(name)}.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: FixRecording) => { if (!gone) { setRec(j); setState('ok'); } })
      .catch(() => { if (!gone) setState('missing'); });
    return () => { gone = true; };
  }, [name]);
  return { rec, state };
}

/** Several published recordings at once (comma-separated names), in order; used for the cumulative view. */
export function useRecordings(csv: string | null) {
  const [recs, setRecs] = useState<FixRecording[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'ok' | 'missing'>('idle');
  useEffect(() => {
    const names = (csv ?? '').split(',').map((n) => n.trim()).filter(Boolean);
    if (!names.length) { setRecs([]); setState('idle'); return; }
    let gone = false;
    setState('loading');
    Promise.all(names.map((n) => fetch(`${import.meta.env.BASE_URL}demo/${encodeURIComponent(n)}.json`, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))))
      .then((list: FixRecording[]) => { if (!gone) { setRecs(list); setState('ok'); } })
      .catch(() => { if (!gone) { setRecs([]); setState('missing'); } });
    return () => { gone = true; };
  }, [csv]);
  return { recs, state };
}

/**
 * A recorded fix session played back with its real pacing. The presenter can
 * scrub, pause, change speed and skip; the badge says it is a recording.
 */
export default function Replay() {
  const { name = '' } = useParams<{ name: string }>();
  const [, navigate] = useLocation();
  const { rec, state } = useRecording(name || null);
  // The demo assessment this recording was made from: the project whose name matches, else the first.
  const projects = useListProjects();
  const slug = (rec?.project ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const demo = (projects.data ?? []).find((p) => p.name.toLowerCase().includes(slug.split('-')[0] || '§')) ?? projects.data?.[0];
  const orbitHref = demo?.latestRunId ? `/verified/${demo.latestRunId}?after=${encodeURIComponent(name)}` : null;
  return (
    <Shell runMeta={rec ? `${rec.project} · recorded fix` : undefined}>
      {state === 'loading' || state === 'idle' ? <div className="flex flex-1 items-center p-8"><Skeleton className="h-full w-full" /></div>
        : state === 'missing' || !rec ? <div className="flex flex-1 flex-col items-center justify-center gap-3"><ErrorBlock message="No recording with that name." /><Link href="/start" className="btn text-xs">Back to start</Link></div>
          : <FixConsole source={{ kind: 'replay', recording: rec }} project={rec.project} wave={rec.wave} onExit={() => navigate(orbitHref ?? '/start')} exitLabel={orbitHref ? 'See it verified on the orbit' : undefined} />}
    </Shell>
  );
}
