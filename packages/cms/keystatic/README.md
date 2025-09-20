# @kit/keystatic

![Complexity: Simple](https://img.shields.io/badge/complexity-simple-green)

## Overview

The `@kit/keystatic` package provides a complete Keystatic CMS integration for Next.js applications. Keystatic is a Git-based content management system that allows you to manage content through Git repositories with a user-friendly admin interface.

## Purpose

This package offers:
- **Git-based CMS**: Content stored in Git for version control and collaboration
- **Local development**: Edit content locally during development
- **GitHub integration**: Production content management through GitHub
- **Markdoc rendering**: Rich markdown content with components
- **Admin interface**: User-friendly content editing interface
- **Next.js integration**: Seamless integration with Next.js applications

## Technology Stack

- **Keystatic Core**: Git-based content management
- **Markdoc**: Rich markdown rendering with components
- **Next.js**: Server and client-side integration
- **React**: Content rendering and admin interface
- **TypeScript**: Full type safety
- **Zod**: Schema validation

## Installation

```bash
pnpm add @kit/keystatic
```

## Configuration

### Environment Variables

```bash
# .env.local
CMS_CLIENT=keystatic

# For GitHub integration (production)
GITHUB_TOKEN=your_github_token
GITHUB_REPO_OWNER=your_username_or_org
GITHUB_REPO_NAME=your_repo_name
```

### Keystatic Configuration

The package includes a pre-configured Keystatic setup with collections for posts and documentation:

```typescript
// keystatic.config.ts
import { createKeystaticConfig } from '@kit/keystatic';

const config = createKeystaticConfig({
  storage: {
    kind: 'local', // or 'github' for production
  },
  collections: {
    posts: {
      label: 'Posts',
      slugField: 'title',
      path: 'content/posts/*',
      schema: {
        title: fields.slug({ name: { label: 'Title' } }),
        content: fields.markdoc({ label: 'Content' }),
        // ... more fields
      },
    },
  },
});

export default config;
```

## Usage

### Setting up Admin Interface

Add the Keystatic admin interface to your Next.js app:

```typescript
// app/keystatic/[[...params]]/page.tsx
import { KeystaticAdmin } from '@kit/keystatic/admin';

export default function KeystaticAdminPage() {
  return <KeystaticAdmin />;
}
```

### API Routes

Set up API routes for Keystatic:

```typescript
// app/api/keystatic/[...params]/route.ts
import { keystaticRouteHandler } from '@kit/keystatic/route-handler';

export const { GET, POST } = keystaticRouteHandler;
```

### Content Fetching

Fetch content using the Keystatic client:

```typescript
import { createKeystaticClient } from '@kit/keystatic';

export async function BlogPage() {
  const cms = createKeystaticClient();

  const result = await cms.getContentItems({
    collection: 'posts',
    limit: 10,
    status: 'published',
  });

  return (
    <div>
      <h1>Blog Posts</h1>
      {result.items.map((post) => (
        <article key={post.slug}>
          <h2>{post.title}</h2>
          <p>{post.description}</p>
        </article>
      ))}
    </div>
  );
}
```

### Content Rendering

Render Markdoc content with components:

```typescript
import { KeystaticContentRenderer } from '@kit/keystatic/renderer';

function BlogPost({ content }: { content: string }) {
  return (
    <article>
      <KeystaticContentRenderer content={content} />
    </article>
  );
}
```

### Integration with @kit/cms

Use through the unified CMS interface:

```typescript
import { createCmsClient } from '@kit/cms';

// Set CMS_CLIENT=keystatic in environment
const cms = await createCmsClient();
const posts = await cms.getContentCollection('posts');
```

## API Reference

### `createKeystaticClient()`

Creates a Keystatic CMS client implementing the `CmsClient` interface.

**Returns:** `CmsClient`

**Methods:**
- `getContentItems(options)` - Get multiple content items
- `getContentItemBySlug(params)` - Get single content item by slug
- `getCategories()` - Get all categories
- `getTags()` - Get all tags

### `KeystaticContentRenderer`

React component for rendering Markdoc content.

**Props:**
- `content: string` - Markdoc content to render

### `KeystaticAdmin`

React component for the Keystatic admin interface.

### `keystaticRouteHandler`

API route handlers for Keystatic operations.

**Exports:** `{ GET, POST }`

## Content Schema

### Posts Collection

```typescript
interface PostEntry {
  title: string;
  description?: string;
  content: MarkdocDocument;
  publishedAt?: string;
  status: 'draft' | 'published';
  categories: string[];
  tags: string[];
  image?: string;
  order?: number;
  parent?: string | null;
}
```

### Documentation Collection

```typescript
interface DocumentationEntry {
  title: string;
  label?: string;
  description?: string;
  content: MarkdocDocument;
  publishedAt?: string;
  status: 'draft' | 'published';
  categories: string[];
  tags: string[];
  image?: string;
  order?: number;
  parent?: string | null;
  collapsible?: boolean;
  collapsed?: boolean;
}
```

## Custom Components

Add custom Markdoc components:

```typescript
// custom-components.tsx
export const customComponents = {
  Callout: ({ type, children }: { type: string; children: React.ReactNode }) => (
    <div className={`callout callout-${type}`}>
      {children}
    </div>
  ),

  CodeBlock: ({ language, children }: { language: string; children: string }) => (
    <pre className={`language-${language}`}>
      <code>{children}</code>
    </pre>
  ),
};
```

## Local Development

1. **Start the development server**:
```bash
pnpm dev
```

2. **Access the admin interface**:
Navigate to `/keystatic` in your browser

3. **Create content**:
Use the admin interface to create and edit content

4. **Content is stored locally** in the `content/` directory

## Production Setup

### GitHub Integration

1. **Create a GitHub repository** for your content
2. **Set environment variables**:
```bash
GITHUB_TOKEN=your_github_token
GITHUB_REPO_OWNER=your_username
GITHUB_REPO_NAME=your_repo
```

3. **Update Keystatic config**:
```typescript
const config = createKeystaticConfig({
  storage: {
    kind: 'github',
    repo: {
      owner: process.env.GITHUB_REPO_OWNER,
      name: process.env.GITHUB_REPO_NAME,
    },
  },
  // ... rest of config
});
```

### Deployment

Content changes in production are managed through:
- GitHub's web interface
- Pull requests for content changes
- Automated builds on content updates

## Available Scripts

```bash
# Lint the package
pnpm --filter @kit/keystatic lint

# Type check
pnpm --filter @kit/keystatic typecheck

# Format code
pnpm --filter @kit/keystatic format
```

## Package Structure

```
packages/cms/keystatic/
├── src/
│   ├── keystatic-client.ts        # CMS client implementation
│   ├── keystatic.config.ts        # Keystatic configuration
│   ├── content-renderer.tsx       # Content rendering component
│   ├── keystatic-admin.tsx        # Admin interface component
│   ├── keystatic-route-handler.ts # API route handlers
│   ├── markdoc.tsx                # Markdoc utilities
│   ├── custom-components.tsx      # Custom Markdoc components
│   ├── create-reader.ts           # Content reader factory
│   └── index.ts                   # Package exports
├── package.json
├── tsconfig.json
└── README.md
```

## Dependencies

### Required Packages
- `@keystatic/core` - Keystatic core functionality
- `@keystatic/next` - Next.js integration
- `@markdoc/markdoc` - Markdown rendering
- `@kit/cms-types` - CMS type definitions
- `@kit/ui` - UI components

### Used By
- `@kit/cms` - CMS abstraction layer
- `apps/web` - Main application

## Best Practices

1. **Use consistent content structure**: Follow the defined schemas
2. **Optimize images**: Compress images before adding to content
3. **Use meaningful slugs**: Create SEO-friendly content URLs
4. **Version control content**: Leverage Git for content versioning
5. **Preview before publishing**: Use draft status for content review

## Troubleshooting

### Common Issues

**Admin interface not loading:**
- Check that API routes are set up correctly
- Verify Keystatic configuration

**Content not updating:**
- Ensure Keystatic reader is being recreated
- Check file permissions in local development

**GitHub integration issues:**
- Verify GitHub token permissions
- Check repository access rights

## Contributing

When contributing to this package:

1. **Follow Keystatic patterns**: Use established Keystatic conventions
2. **Update schema carefully**: Changes to content schema affect existing content
3. **Test both local and GitHub modes**: Verify functionality in both environments
4. **Document custom components**: Add clear examples for new Markdoc components

---

*Last updated: September 20, 2025*
