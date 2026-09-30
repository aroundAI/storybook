import Link from 'next/link';

interface AssetsBreadcrumbProps {
  account: string;
  projectSlug: string | null;
  projectName: string;
}

/**
 * Written out instead of composed from `@kit/ui/breadcrumb`: with that module
 * on this page a tab switch (`?tab=character`) intermittently took five
 * seconds to commit in a production build, and the FILM-204 performance budget
 * caught it. The markup and attributes are the ones the component renders.
 */
export function AssetsBreadcrumb({
  account,
  projectSlug,
  projectName,
}: AssetsBreadcrumbProps) {
  const link = 'transition-colors hover:text-foreground';

  return (
    <nav
      aria-label="breadcrumb"
      className="px-6 pt-6"
      data-test="assets-breadcrumb"
    >
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        <li className="inline-flex items-center gap-1.5">
          <Link prefetch={false} href={`/home/${account}`} className={link}>
            Home
          </Link>
        </li>
        <li aria-hidden="true">/</li>
        <li className="inline-flex items-center gap-1.5">
          <Link
            prefetch={false}
            href={`/home/${account}/studio`}
            className={link}
          >
            Studio
          </Link>
        </li>
        <li aria-hidden="true">/</li>
        <li className="inline-flex items-center gap-1.5">
          <Link
            prefetch={false}
            href={`/home/${account}/studio/${projectSlug}`}
            className={link}
          >
            {projectName}
          </Link>
        </li>
        <li aria-hidden="true">/</li>
        <li className="inline-flex items-center gap-1.5">
          <span
            role="link"
            aria-disabled="true"
            aria-current="page"
            className="font-normal text-foreground"
          >
            Assets
          </span>
        </li>
      </ol>
    </nav>
  );
}
