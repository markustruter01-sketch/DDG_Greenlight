import { Link } from 'wouter';
import { DEMO_WAVES } from '@/components/shell';

/**
 * On Verified and Sign-off for the sample project: pick one recorded wave,
 * or every wave applied in order ("All waves").
 */
export function WaveSwitch({ page, runId, after }: { page: 'verified' | 'signoff'; runId: string; after: string | null }) {
  if (!after || DEMO_WAVES.length < 2) return null;
  const all = DEMO_WAVES.map((w) => w.name).join(',');
  const options = [...DEMO_WAVES.map((w) => ({ label: `Wave ${w.wave}`, value: w.name })), { label: 'All waves', value: all }];
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Which waves to show" data-testid="wave-switch">
      {options.map((o) => (
        <Link key={o.value} href={`/${page}/${runId}?after=${encodeURIComponent(o.value)}`} role="tab" aria-selected={after === o.value} className={`btn !px-3 !py-1.5 text-xs ${after === o.value ? 'fc-on' : ''}`} data-testid={`button-waves-${o.label.replace(/\s+/g, '-').toLowerCase()}`}>{o.label}</Link>
      ))}
    </div>
  );
}
