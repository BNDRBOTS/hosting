import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-8 sm:px-10">
      <header className="flex items-center justify-between">
        <Link className="text-lg font-semibold tracking-tight text-slate-900" href="/">ProofLoop</Link>
        <Link className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-white" href="/status">View status</Link>
      </header>
      <section className="my-auto grid gap-12 py-24 md:grid-cols-[1.2fr_0.8fr] md:items-center">
        <div>
          <p className="mb-5 text-sm font-semibold uppercase tracking-[0.18em] text-indigo-700">Build with confidence</p>
          <h1 className="max-w-2xl text-5xl font-semibold leading-[1.08] tracking-tight text-slate-950 sm:text-6xl">Tell us what to change. See proof before it ships.</h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">ProofLoop checks each change against real user flows and independent evidence. If a check fails, the change stays put.</p>
        </div>
        <aside className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm sm:p-9">
          <p className="text-sm font-semibold text-slate-900">Every change must pass</p>
          <ol className="mt-6 space-y-5">
            <li className="flex gap-4"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-indigo-50 text-sm font-semibold text-indigo-700">1</span><span><strong className="block text-sm text-slate-900">A clear request</strong><span className="mt-1 block text-sm leading-6 text-slate-600">Your words become checks with clear outcomes.</span></span></li>
            <li className="flex gap-4"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-indigo-50 text-sm font-semibold text-indigo-700">2</span><span><strong className="block text-sm text-slate-900">Real evidence</strong><span className="mt-1 block text-sm leading-6 text-slate-600">The app is tested, and the results are saved.</span></span></li>
            <li className="flex gap-4"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-indigo-50 text-sm font-semibold text-indigo-700">3</span><span><strong className="block text-sm text-slate-900">A separate review</strong><span className="mt-1 block text-sm leading-6 text-slate-600">Another check must agree before a change goes live.</span></span></li>
          </ol>
        </aside>
      </section>
      <footer className="border-t border-slate-200 py-5 text-sm text-slate-500">A change ships only when the evidence says it is ready.</footer>
    </main>
  );
}
