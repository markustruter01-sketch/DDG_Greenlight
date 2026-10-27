import { useMemo } from 'react';
import { Link, useParams } from 'wouter';
import { ArrowRight, Orbit as OrbitIcon } from 'lucide-react';
import { getGetAssessmentQueryKey, useGetAssessment } from '@workspace/api-client-react';
import { Shell } from '@/components/shell';
import { ErrorBlock, Skeleton } from '@/components/gl';
import { pc, statusMap, tally } from '@/lib/greenlight';
import { plainName } from '@/lib/standard-info';

const colorFor = (v: number) => (v < 40 ? '#FF5C6E' : v < 75 ? '#FFA62B' : '#4FD99A');

/**
 * Step 3 · What's wrong: one number, three counts, one bar per standard.
 * The detail (every requirement on the planet) is one tap away on Orbit.
 */
export default function Results() {
  const { id = '' } = useParams<{ id: string }>();
  const q = useGetAssessment(id, { query: { enabled: !!id, queryKey: getGetAssessmentQueryKey(id) } });
  const run = q.data;
  const st = useMemo(() => (run ? statusMap(run, 0) : {}), [run]);
  const counts = useMemo(() => (run ? tally(run, st) : null), [run, st]);
  const overall = run ? pc(run.readiness) : 0;
  const open = counts ? counts.failed + counts.partial : 0;
  const serious = counts?.blocking ?? 0;
  const should = Math.max(0, open - serious);
  const fixable = run ? run.waves.reduce((n, w) => n + w.fixes.reduce((m, f) => m + f.itemKeys.length, 0), 0) : 0;
  const ms = run ? Math.max(0, (run as { durationMs?: number }).durationMs ?? 0) : 0;

  const guide = { steps: ['Read the number. Red under 40, amber under 75, green at 75 and up.', 'Press Show me the plan', 'Or See each one to tap through every problem on the planet'], current: 0 };

  return (
    <Shell runId={id} guide={run ? guide : undefined} coach={run ? { id: 'results', text: 'Press See each one.', target: '[data-testid="link-orbit"]' } : null} runMeta={run ? `${run.projectName} · ${new Date(run.assessedAt).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })}` : undefined}>
      <div className="jl">
        {q.isLoading || !run || !counts ? (
          q.isError ? <ErrorBlock message="This assessment could not be loaded." onRetry={() => q.refetch()} /> : <Skeleton className="h-80 w-full" />
        ) : (
          <section className="glass jcard" data-testid="screen-results">
            <div className="jsplit">
              <div className="flex min-w-0 flex-col gap-3">
                <span className="jnote">{run.projectName} · checked by code{ms ? ` in ${Math.round(ms / 1000)} s` : ''}{run.isDemo ? ' · sample project' : ''}</span>
                <div className="flex items-baseline gap-4"><span className="jbig" style={{ color: colorFor(overall) }} data-testid="text-overall">{overall}%</span><span style={{ fontSize: 24, color: '#DCE3E8' }}>ready</span></div>
                <h1 className="jh" style={{ fontSize: 34 }} data-testid="text-verdict">{open === 0 ? 'Nothing to fix.' : <>{open} thing{open === 1 ? '' : 's'} to fix.<br />{fixable >= open ? 'All of them have a plan.' : `${fixable} can be fixed in code.`}</>}</h1>
                <div className="flex flex-wrap gap-2">
                  <span className="jpill" style={{ borderColor: 'rgba(255,92,110,.5)', background: 'rgba(255,92,110,.14)' }} data-testid="count-serious"><i style={{ background: '#FF5C6E' }} />{serious} serious</span>
                  <span className="jpill" style={{ borderColor: 'rgba(255,166,43,.5)', background: 'rgba(255,166,43,.14)' }} data-testid="count-should"><i style={{ background: '#FFA62B' }} />{should} should fix</span>
                  <span className="jpill" data-testid="count-answers"><i style={{ background: '#8A939B' }} />{counts.unanswered} need your answer</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-3">
                  <Link href={`/plan/${id}`} className="btn btn-go btn-big" data-testid="link-plan" data-tour-target="fix-button">Show me the plan <ArrowRight size={20} /></Link>
                  <Link href={`/orbit/${id}`} className="btn btn-quiet" data-testid="link-orbit"><OrbitIcon size={16} /> See each one</Link>
                </div>
              </div>
              <div className="jbars" data-testid="readiness-rings">
                <span className="jnote">Per standard · how much already passes</span>
                {run.standards.map((s) => {
                  const v = pc(s.readiness);
                  return (
                    <div key={s.id} className="jbar" data-testid={`button-standard-${s.id}`}>
                      <span className="truncate" title={s.name}>{plainName(s.id, s.short)}</span>
                      <div className="track"><i style={{ width: `${v}%`, background: colorFor(v) }} /></div>
                      <b style={{ color: colorFor(v) }}>{v}%</b>
                    </div>
                  );
                })}
                <span className="jnote">Red under 40 · amber under 75 · green at 75+</span>
              </div>
            </div>
          </section>
        )}
      </div>
    </Shell>
  );
}
