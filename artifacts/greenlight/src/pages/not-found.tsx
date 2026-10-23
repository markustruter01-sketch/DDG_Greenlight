import { Link } from 'wouter';
import { Shell } from '@/components/shell';

export default function NotFound() {
  return (
    <Shell>
      <div className="flex flex-1 items-center justify-center p-6">
        <section className="glass w-full max-w-md p-7 text-center" data-testid="page-not-found">
          <div className="lbl !text-[#F5C451]">404 · No such page</div>
          <h1 className="font-head mt-2 text-3xl font-semibold">Nothing lights up here</h1>
          <p className="mt-3 text-sm" style={{ color: '#CFE3EE' }}>The address may be old or mistyped. The navigation below takes you back to the start, the latest results or the recorded fix.</p>
          <Link href="/start" className="btn btn-primary mt-5 !px-5 !py-2.5">Back to start</Link>
        </section>
      </div>
    </Shell>
  );
}
