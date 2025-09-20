'use client';

import Link from 'next/link';

interface NavItem {
  text: string;
  level: number;
  href: string;
  children: NavItem[];
}

export function DocsTableOfContents(props: { data: NavItem[] }) {
  const navData = props.data;

  return (
    <div className="bg-background sticky inset-y-0 hidden h-svh max-h-full min-w-[14em] border-l p-4 lg:block">
      <ol
        role="list"
        className="relative text-sm text-gray-600 dark:text-gray-400"
      >
        {navData.map((item) => (
          <li key={item.href} className="group/item relative mt-3 first:mt-0">
            <a
              href={item.href}
              className="block transition-colors **:[font:inherit] hover:text-gray-950 dark:hover:text-white"
            >
              {item.text}
            </a>
            {item.children && (
              <ol role="list" className="relative mt-3 pl-4">
                {item.children.map((child) => (
                  <li
                    key={child.href}
                    className="group/subitem relative mt-3 first:mt-0"
                  >
                    <Link
                      href={child.href}
                      className="block transition-colors **:[font:inherit] hover:text-gray-950 dark:hover:text-white"
                    >
                      {child.text}
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
