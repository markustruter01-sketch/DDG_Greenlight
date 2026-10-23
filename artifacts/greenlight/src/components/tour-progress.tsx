import { useEffect, useRef } from 'react';

/**
 * The guided tour's timer: a full-width bar along the bottom of the screen.
 * The bright fill shows how far through the current slide we are; the
 * segments behind it show every slide, so the viewer also sees how many
 * remain. Driven by requestAnimationFrame against the slide's deadline, so
 * it stops exactly when the tour is paused.
 */
export function TourProgress({
  steps,
  index,
  playing,
  remainingMs,
  deadline,
}: {
  /** Seconds per slide. */
  steps: number[];
  index: number;
  playing: boolean;
  /** Time left on the current slide when it was last paused or started. */
  remainingMs: number;
  /** performance.now() at which the current slide ends, while playing. */
  deadline: { current: number };
}) {
  const fill = useRef<HTMLDivElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const total = (steps[index] ?? 1) * 1000;

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const left = playing ? Math.max(0, deadline.current - performance.now()) : remainingMs;
      const done = Math.min(1, Math.max(0, 1 - left / total));
      if (fill.current) fill.current.style.transform = `scaleX(${done})`;
      if (clock.current) clock.current.textContent = `${Math.ceil(left / 1000)} s`;
      if (playing) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [playing, remainingMs, total, index, deadline]);

  return (
    <div className="tour-progress" role="progressbar" aria-label={`Tour slide ${index + 1} of ${steps.length}`} aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={index + 1} data-testid="tour-progress">
      <div className="tour-progress-meta">
        <span className="lbl">Slide {index + 1} of {steps.length}</span>
        <span className="lbl" ref={clock} />
      </div>
      <div className="tour-progress-track">
        {steps.map((s, i) => (
          <div key={i} className={`tour-progress-seg ${i < index ? 'is-done' : i === index ? 'is-now' : ''}`} style={{ flexGrow: s }}>
            {i === index && <div className="tour-progress-fill" ref={fill} />}
          </div>
        ))}
      </div>
    </div>
  );
}
