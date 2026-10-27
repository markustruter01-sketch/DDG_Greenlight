import { useEffect, useState } from 'react';
import { useGetGreenlightConfig } from '@workspace/api-client-react';
import { Modal } from '@/components/gl';

/**
 * On a demonstration deployment the link to this site can be passed on to
 * anyone, so nothing here may open the real repositories. Every click on a
 * GitHub link is caught before it navigates and answered with a notice.
 * The API says when links are allowed (GREENLIGHT_EXTERNAL_LINKS=1).
 */
const BLOCKED = /(^|\.)github\.com$|(^|\.)githubusercontent\.com$/i;

export function isBlockedHref(href: string, allowed: boolean): boolean {
  if (allowed) return false;
  try { return BLOCKED.test(new URL(href, window.location.href).hostname); } catch { return false; }
}

export function LinkGuard() {
  const cfg = useGetGreenlightConfig();
  const allowed = !!(cfg.data as { externalLinks?: boolean } | undefined)?.externalLinks;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || !isBlockedHref(a.href, allowed)) return;
      e.preventDefault(); e.stopPropagation();
      setOpen(true);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [allowed]);
  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Demonstration only" z={120}>
      <p className="text-sm leading-relaxed" style={{ color: '#EAF3F8' }} data-testid="text-link-blocked">
        This product is for demonstration purposes only. Links to GitHub are not permitted at this time.
      </p>
      <p className="mt-3 text-xs leading-relaxed" style={{ color: '#B9C3CC' }}>
        On a live deployment this opens the pull request on the team's own repository, where their reviewers merge it. Nothing is ever merged by Greenlight.
      </p>
    </Modal>
  );
}
