# @kit/cms

![Complexity: Simple](https://img.shields.io/badge/complexity-simple-green)

## Overview

The `@kit/cms` package provides a provider-agnostic abstraction layer for Content Management Systems in the Makerkit framework. It offers a unified interface for working with different CMS providers like WordPress and Keystatic, allowing you to switch between providers without changing your application code.

## Purpose

This package serves as the core CMS abstraction layer, providing:
- **Provider-agnostic interface**: Use any CMS provider with a consistent API
- **Dynamic client creation**: Automatically select CMS provider based on configuration
- **Content rendering**: Unified content rendering across different CMS providers
- **Type safety**: Full TypeScript support for all CMS operations
- **Lazy loading**: CMS clients are loaded on-demand for better performance

## Technology Stack

- **TypeScript**: Full type safety and interfaces
- **React**: Content rendering components
- **Registry pattern**: Dynamic provider registration and loading

## Installation

```bash
pnpm add @kit/cms
```

## Configuration

Set your CMS provider via environment variable:

```bash
# .env.local
CMS_CLIENT=keystatic
# or
CMS_CLIENT=wordpress
```

Supported providers:
- `keystatic` - Git-based CMS with local and GitHub integration
- `wordpress` - WordPress CMS via REST API

## Usage

### Creating a CMS Client

Create a CMS client that automatically selects the provider:

```typescript
import { createCmsClient } from '@kit/cms';

// Uses CMS_CLIENT environment variable
const cms = await createCmsClient();

// Or specify provider explicitly
const keystatic = await createCmsClient('keystatic');
const wordpress = await createCmsClient('wordpress');

// Fetch content
const posts = await cms.getContentCollection('posts');
const post = await cms.getContentItem('posts', 'my-post-slug');
```

### Content Rendering

Render content from any CMS provider:

```typescript
import { ContentRenderer } from '@kit/cms';

function BlogPost({ content }: { content: unknown }) {
  return (
    <article>
      <ContentRenderer content={content} />
    </article>
  );
}

// With specific provider
function BlogPostWithProvider({ content }: { content: unknown }) {
  return (
    <article>
      <ContentRenderer content={content} type="keystatic" />
    </article>
  );
}
```

### Example: Blog Implementation

```typescript
import { createCmsClient } from '@kit/cms';
import { ContentRenderer } from '@kit/cms';

export async function BlogPage() {
  const cms = await createCmsClient();
  const posts = await cms.getContentCollection('posts');

  return (
    <div>
      <h1>Blog Posts</h1>
      {posts.map((post) => (
        <article key={post.slug}>
          <h2>{post.title}</h2>
          <ContentRenderer content={post.content} />
        </article>
      ))}
    </div>
  );
}

export async function BlogPostPage({ slug }: { slug: string }) {
  const cms = await createCmsClient();
  const post = await cms.getContentItem('posts', slug);

  if (!post) {
    return <div>Post not found</div>;
  }

  return (
    <article>
      <h1>{post.title}</h1>
      <ContentRenderer content={post.content} />
    </article>
  );
}
```

## API Reference

### `createCmsClient(type?)`

Creates a CMS client instance for the specified provider.

**Parameters:**
- `type?: CmsType` - CMS provider type (defaults to `CMS_CLIENT` environment variable)

**Returns:** `Promise<CmsClient>`

**Supported Types:**
- `'keystatic'` - Keystatic CMS client
- `'wordpress'` - WordPress CMS client

**Example:**
```typescript
// Use environment variable CMS_CLIENT
const cms = await createCmsClient();

// Explicit provider
const keystatic = await createCmsClient('keystatic');
const wordpress = await createCmsClient('wordpress');
```

### `ContentRenderer`

React component for rendering content from any CMS provider.

**Props:**
- `content: unknown` - Content to render (format depends on CMS provider)
- `type?: CmsType` - CMS provider type (defaults to `CMS_CLIENT` environment variable)

**Example:**
```typescript
<ContentRenderer
  content={post.content}
  type="keystatic"
/>
```

## CMS Client Interface

All CMS providers implement the `CmsClient` interface from `@kit/cms-types`:

```typescript
interface CmsClient {
  // Get a collection of content items
  getContentCollection<T = ContentItem>(
    collection: string,
    options?: GetCollectionOptions
  ): Promise<T[]>;

  // Get a single content item
  getContentItem<T = ContentItem>(
    collection: string,
    slug: string,
    options?: GetItemOptions
  ): Promise<T | null>;

  // Get content collections schema
  getCollections(): Promise<Collection[]>;

  // Search content across collections
  searchContent<T = ContentItem>(
    query: string,
    options?: SearchOptions
  ): Promise<T[]>;
}
```

## Adding New CMS Providers

To add a new CMS provider:

1. **Create the provider package** following the interface:

```typescript
// packages/cms/my-provider/src/client.ts
import { CmsClient } from '@kit/cms-types';

export function createMyProviderClient(): CmsClient {
  return {
    async getContentCollection(collection, options) {
      // Implementation
    },

    async getContentItem(collection, slug, options) {
      // Implementation
    },

    async getCollections() {
      // Implementation
    },

    async searchContent(query, options) {
      // Implementation
    },
  };
}
```

2. **Register the provider** in `create-cms-client.ts`:

```typescript
// Register the new provider
cmsRegistry.register('my-provider', async () => {
  const { createMyProviderClient } = await import('@kit/my-provider');
  return createMyProviderClient();
});
```

3. **Add content renderer** in `content-renderer.tsx`:

```typescript
case 'my-provider': {
  const { MyProviderContentRenderer } = await import(
    '@kit/my-provider/renderer'
  );

  return MyProviderContentRenderer;
}
```

## Environment Variables

```bash
# Required: Specify the CMS provider
CMS_CLIENT=keystatic

# Provider-specific configuration
# (See individual provider documentation)
```

## Available Scripts

### Development

```bash
# Lint the package
pnpm --filter @kit/cms lint

# Type check
pnpm --filter @kit/cms typecheck

# Format code
pnpm --filter @kit/cms format
```

## Package Structure

```
packages/cms/core/
├── src/
│   ├── create-cms-client.ts    # CMS client factory
│   ├── content-renderer.tsx    # Content rendering component
│   └── index.ts               # Package exports
├── package.json               # Package configuration
├── tsconfig.json              # TypeScript configuration
└── README.md                  # This documentation
```

## Dependencies

### Required Packages
- `@kit/cms-types` - Type definitions for CMS interface
- `@kit/shared` - Registry utilities
- `@kit/keystatic` - Keystatic CMS implementation
- `@kit/wordpress` - WordPress CMS implementation

### Used By
- `apps/web` - Main application
- Any package requiring CMS functionality

## Provider-Specific Features

### Keystatic
- **Git-based**: Content stored in Git repository
- **Local editing**: Edit content locally during development
- **GitHub integration**: Production content management through GitHub
- **Markdown support**: Rich markdown content with frontmatter

### WordPress
- **REST API**: Access WordPress content via REST API
- **Rich content**: Support for WordPress blocks and media
- **User management**: WordPress user authentication and roles
- **Plugin ecosystem**: Access to WordPress plugins and themes

## Best Practices

1. **Use environment variables**: Configure CMS provider through environment variables
2. **Type your content**: Create interfaces for your content types
3. **Handle errors gracefully**: CMS operations can fail, handle errors appropriately
4. **Cache content**: Consider caching strategies for better performance
5. **Validate content**: Validate content structure before rendering

## Error Handling

```typescript
import { createCmsClient } from '@kit/cms';

try {
  const cms = await createCmsClient();
  const posts = await cms.getContentCollection('posts');
} catch (error) {
  console.error('Failed to load content:', error);
  // Handle error appropriately
}
```

## Contributing

When contributing to this package:

1. **Maintain interface compatibility**: Don't break the `CmsClient` interface
2. **Add tests**: Test new providers and features thoroughly
3. **Update documentation**: Document new providers and features
4. **Follow patterns**: Use the registry pattern for new providers
5. **Consider performance**: Lazy load providers and cache when possible

## Migration Guide

### From Custom CMS to @kit/cms

1. **Install the package**: `pnpm add @kit/cms`
2. **Set environment variable**: `CMS_CLIENT=your-provider`
3. **Replace client creation**: Use `createCmsClient()` instead of custom clients
4. **Update rendering**: Use `ContentRenderer` component
5. **Update imports**: Import from `@kit/cms` instead of provider packages

---

*Last updated: September 20, 2025*
