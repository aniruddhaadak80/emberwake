/**
 * Page header used by every non-landing route.
 *
 * Keeps the vertical rhythm consistent and gives each route a one-line statement
 * of what it is for, rather than leaving the visitor to guess.
 */
export function PageHeader({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-b border-brass-500/15 bg-tide-900/30">
      <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4 px-4 py-8 sm:px-6">
        {/*
          `min-w-0` is load-bearing. A flex item's base size is its max-content
          width, so without it this paragraph keeps its `max-w-2xl` intrinsic
          width and overflows a 390px phone instead of wrapping.
        */}
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold sm:text-3xl">{title}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fog-200">{blurb}</p>
        </div>
        {children}
      </div>
    </div>
  );
}