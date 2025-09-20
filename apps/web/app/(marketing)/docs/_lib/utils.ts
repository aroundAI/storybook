import { Cms } from '@kit/cms';

interface HeadingNode {
  text: string;
  level: number;
  href: string;
  children: HeadingNode[];
}

/**
 * @name buildDocumentationTree
 * @description Build a tree structure for the documentation pages.
 * @param pages
 */
export function buildDocumentationTree(pages: Cms.ContentItem[]) {
  const tree: Cms.ContentItem[] = [];

  pages.forEach((page) => {
    if (page.parentId) {
      const parent = pages.find((item) => item.slug === page.parentId);

      if (!parent) {
        return;
      }

      if (!parent.children) {
        parent.children = [];
      }

      parent.children.push(page);

      // sort children by order
      parent.children.sort((a, b) => a.order - b.order);
    } else {
      tree.push(page);
    }
  });

  return tree.sort((a, b) => a.order - b.order);
}

/**
 * @name extractHeadingsFromJSX
 * @description Extract headings from JSX. This is used to generate the table of contents for the documentation pages.
 * @param jsx
 */
export function extractHeadingsFromJSX(jsx: {
  props: { children: React.ReactElement[] };
}) {
  const headings: HeadingNode[] = [];
  let currentH2: HeadingNode | null = null;

  function getTextContent(
    children: React.ReactElement[] | string | React.ReactElement,
  ): string {
    try {
      if (typeof children === 'string') {
        return children;
      }

      if (Array.isArray(children)) {
        return children.map((child) => getTextContent(child)).join('');
      }

      if (
        (
          children.props as {
            children: React.ReactElement;
          }
        ).children
      ) {
        return getTextContent(
          (children.props as { children: React.ReactElement }).children,
        );
      }

      return '';
    } catch {
      return '';
    }
  }

  try {
    jsx.props.children.forEach((node) => {
      if (!node || typeof node !== 'object' || !('type' in node)) {
        return;
      }

      const nodeType = node.type as string;

      const text = getTextContent(
        (
          node.props as {
            children: React.ReactElement[];
          }
        ).children,
      );

      if (nodeType === 'h1') {
        const slug = generateSlug(text);

        headings.push({
          text,
          level: 1,
          href: `#${slug}`,
          children: [],
        });
      } else if (nodeType === 'h2') {
        const slug = generateSlug(text);

        currentH2 = {
          text,
          level: 2,
          href: `#${slug}`,
          children: [],
        };

        if (headings.length > 0) {
          headings[headings.length - 1]!.children.push(currentH2);
        } else {
          headings.push(currentH2);
        }
      } else if (nodeType === 'h3' && currentH2) {
        const slug = generateSlug(text);

        currentH2.children.push({
          text,
          level: 3,
          href: `#${slug}`,
          children: [],
        });
      }
    });

    return headings;
  } catch {
    return [];
  }
}

function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
