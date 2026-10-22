import { useEffect, useRef, useState } from 'react';
import { Download, Eye, Minus, Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { getListReportsQueryKey, useListReports, type Report } from '@workspace/api-client-react';
import { Modal, Skeleton, ErrorBlock } from '@/components/gl';
import { download, reportUrl } from '@/lib/greenlight';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

function PdfViewer({ report, onClose }: { report: Report | null; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1.2);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!report) return;
    let dead = false;
    let loaded: pdfjs.PDFDocumentProxy | null = null;
    setDoc(null);
    setErr(null);
    setPage(1);
    (async () => {
      try {
        const r = await fetch(reportUrl(report.url, 'pdf'), { credentials: 'include' });
        if (!r.ok) throw new Error(`Report returned ${r.status}`);
        const data = new Uint8Array(await r.arrayBuffer());
        loaded = await pdfjs.getDocument({ data }).promise;
        if (!dead) setDoc(loaded);
      } catch (e) {
        if (!dead) setErr(e instanceof Error ? e.message : 'Could not open PDF');
      }
    })();
    return () => {
      dead = true;
      void (loaded as unknown as { destroy?: () => void } | null)?.destroy?.();
    };
  }, [report]);

  useEffect(() => {
    if (!doc || !canvas.current) return;
    let task: pdfjs.RenderTask | null = null;
    let dead = false;
    setBusy(true);
    doc.getPage(page).then((p) => {
      if (dead || !canvas.current) return;
      const dpr = window.devicePixelRatio || 1;
      const vp = p.getViewport({ scale: zoom * dpr });
      const c = canvas.current;
      c.width = vp.width;
      c.height = vp.height;
      c.style.width = `${vp.width / dpr}px`;
      c.style.height = `${vp.height / dpr}px`;
      task = p.render({ canvasContext: c.getContext('2d')!, viewport: vp, canvas: c });
      task.promise.then(() => !dead && setBusy(false)).catch(() => undefined);
    });
    return () => {
      dead = true;
      task?.cancel();
    };
  }, [doc, page, zoom]);

  return (
    <Modal open={!!report} onClose={onClose} wide z={70} title={report?.title ?? 'Report'}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button className="btn !p-2" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page" data-testid="button-pdf-prev"><ChevronLeft size={16} /></button>
        <span className="lbl" data-testid="text-pdf-page">Page {page} / {doc?.numPages ?? '-'}</span>
        <button className="btn !p-2" disabled={!doc || page >= doc.numPages} onClick={() => setPage(page + 1)} aria-label="Next page" data-testid="button-pdf-next"><ChevronRight size={16} /></button>
        <span className="mx-2 h-5 w-px bg-[rgba(124,201,232,.3)]" />
        <button className="btn !p-2" onClick={() => setZoom(Math.max(0.5, zoom - 0.2))} aria-label="Zoom out" data-testid="button-pdf-zoom-out"><Minus size={16} /></button>
        <span className="lbl">{Math.round(zoom * 100)}%</span>
        <button className="btn !p-2" onClick={() => setZoom(Math.min(3, zoom + 0.2))} aria-label="Zoom in" data-testid="button-pdf-zoom-in"><Plus size={16} /></button>
        {report && (
          <button className="btn btn-primary ml-auto" onClick={() => download(reportUrl(report.url, 'pdf'))} data-testid="button-pdf-download">
            <Download size={16} /> Download PDF
          </button>
        )}
      </div>
      {err ? (
        <ErrorBlock message={err} />
      ) : (
        <div className="relative overflow-auto rounded-xl bg-[#0a1a23] p-3" style={{ maxHeight: '65dvh' }}>
          {!doc && <Skeleton className="mx-auto h-[60dvh] w-full max-w-xl" />}
          <canvas ref={canvas} className="mx-auto block" style={{ opacity: busy ? 0.6 : 1, transition: 'opacity .2s' }} />
        </div>
      )}
    </Modal>
  );
}

export function ReportsModal({ runId, open, onClose }: { runId: string; open: boolean; onClose: () => void }) {
  const q = useListReports(runId, { query: { enabled: open && !!runId, queryKey: getListReportsQueryKey(runId) } });
  const [view, setView] = useState<Report | null>(null);
  return (
    <>
      <Modal open={open} onClose={onClose} title="Reports">
        {q.isLoading ? (
          <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : q.isError ? (
          <ErrorBlock message="Reports could not be listed." onRetry={() => q.refetch()} />
        ) : !q.data?.length ? (
          <p className="text-sm" style={{ color: '#CFE3EE' }}>No reports generated for this run yet.</p>
        ) : (
          <ul className="space-y-3">
            {q.data.map((r) => (
              <li key={r.kind} className="tile flex flex-wrap items-center justify-between gap-3 p-4" data-testid={`row-report-${r.kind}`}>
                <div>
                  <div className="font-head font-medium">{r.title}</div>
                  <div className="lbl mt-1">{r.kind} · {new Date(r.generatedAt).toLocaleString()}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {r.formats.includes('pdf') && (
                    <button className="btn" onClick={() => setView(r)} data-testid={`button-view-${r.kind}`}><Eye size={15} /> View</button>
                  )}
                  {r.formats.map((f) => (
                    <button key={f} className="btn" onClick={() => download(reportUrl(r.url, f))} data-testid={`button-download-${r.kind}-${f}`}>
                      <Download size={14} /> <span className="lbl !text-[#F7FBFF]">{f}</span>
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>
      <PdfViewer report={view} onClose={() => setView(null)} />
    </>
  );
}
