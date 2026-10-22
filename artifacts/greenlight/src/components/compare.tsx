import { useState } from 'react';
import { getCompareProjectQueryKey, useCompareProject } from '@workspace/api-client-react';
import { Dot, ErrorBlock, Modal, Skeleton, StatusPill } from '@/components/gl';
import { pc, tone } from '@/lib/greenlight';

export function CompareModal({ projectId, open, onClose }: { projectId: string | null; open: boolean; onClose: () => void }) {
  const id = projectId ?? '';
  const q = useCompareProject(id, { query: { enabled: open && !!id, queryKey: getCompareProjectQueryKey(id) } });
  const [changed, setChanged] = useState(true);
  const items = (q.data?.items ?? []).filter((i) => !changed || i.baseline !== i.actual || i.baseline !== i.projected);
  return (
    <Modal open={open} onClose={onClose} wide title="Compare runs">
      {q.isLoading ? (
        <Skeleton className="h-48" />
      ) : q.isError || !q.data ? (
        <ErrorBlock message="Comparison unavailable." onRetry={() => q.refetch()} />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {q.data.runs.map((r) => {
              const t = tone(r.counts as { failed: number; blocking: number; partial: number; unanswered: number });
              return (
                <div key={r.id} className="tile p-4" data-testid={`card-run-${r.id}`}>
                  <div className="lbl">{new Date(r.assessedAt).toLocaleString()}</div>
                  <div className="mt-2 font-head text-2xl">{pc(r.readiness)}%</div>
                  <div className="mt-1 text-sm"><Dot color={t.color} word={r.verdict} /></div>
                  <div className="lbl mt-2">{r.counts.failed} failing · {r.counts.partial} partial · {r.counts.blocking} must-fix</div>
                </div>
              );
            })}
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="lbl">Requirement by requirement. Projected is a forecast, not a result.</span>
              <label className="lbl flex items-center gap-2">
                <input type="checkbox" checked={changed} onChange={(e) => setChanged(e.target.checked)} data-testid="checkbox-changed-only" /> Changed only
              </label>
            </div>
            <div className="overflow-auto rounded-xl border" style={{ borderColor: 'rgba(124,201,232,.2)', maxHeight: '45dvh' }}>
              <table className="w-full text-left text-sm">
                <thead className="lbl sticky top-0" style={{ background: 'rgba(8,24,33,.95)' }}>
                  <tr><th className="p-3">Requirement</th><th className="p-3">Baseline</th><th className="p-3">Projected</th><th className="p-3">Actual</th></tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.key} className="border-t" style={{ borderColor: 'rgba(124,201,232,.12)' }}>
                      <td className="p-3">{i.title}</td>
                      <td className="p-3"><StatusPill status={i.baseline} small /></td>
                      <td className="p-3 opacity-80"><StatusPill status={i.projected} small /></td>
                      <td className="p-3"><StatusPill status={i.actual} small /></td>
                    </tr>
                  ))}
                  {!items.length && <tr><td colSpan={4} className="p-6 text-center" style={{ color: '#CFE3EE' }}>Nothing differs between these runs.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
