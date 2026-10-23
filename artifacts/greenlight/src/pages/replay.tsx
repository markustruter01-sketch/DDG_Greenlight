import { useEffect, useState } from 'react';
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

/**
 * A recorded fix session played back with its real pacing. The presenter can
 * scrub, pause, change speed and skip; the badge says it is a recording.
 */
export default function Replay() {
  const { name = '' } = useParams<{ name: string }>();
  const [, navigate] = useLocation();
  const { rec, state } = useRecording(name || null);
  return (
    <Shell runMeta={rec ? `${rec.project} · recorded fix` : undefined}>
      {state === 'loading' || state === 'idle' ? <div className="flex flex-1 items-center p-8"><Skeleton className="h-full w-full" /></div>
        : state === 'missing' || !rec ? <div className="flex flex-1 flex-col items-center justify-center gap-3"><ErrorBlock message="No recording with that name." /><Link href="/start" className="btn text-xs">Back to start</Link></div>
          : <FixConsole source={{ kind: 'replay', recording: rec }} project={rec.project} wave={rec.wave} onExit={() => navigate('/start')} />}
    </Shell>
  );
}
