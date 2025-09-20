# @kit/cms-types

![Complexity: Simple](https://img.shields.io/badge/complexity-simple-green)

## Overview

The `@kit/cms-types` package provides TypeScript type definitions for the CMS abstraction layer. It defines the interfaces and types that all CMS providers must implement, ensuring type safety and consistency across different content management systems.

## Purpose

This package serves as the foundation for CMS type safety, providing:
- **Common interfaces**: Standardized CMS client interface
- **Content types**: Unified content item and collection types
- **Provider types**: CMS provider identification and configuration
- **Query types**: Standardized query and filter interfaces
- **Response types**: Consistent response formats across providers

## Technology Stack

- **TypeScript**: Pure TypeScript definitions
- **No runtime dependencies**: Types-only package

## Installation

```bash
pnpm add @kit/cms-types
```

## Core Types

### CmsClient Interface

The main interface that all CMS providers must implement:

```typescript
interface CmsClient {
  getContentItems(options: GetContentItemsOptions): Promise<{
    items: ContentItem[];
    total: number;
  }>;

  getContentItemBySlug(params: {
    slug: string;
    collection: string;
    status?: ContentItemStatus;
  }): Promise<ContentItem | undefined>;

  getCategories(): Promise<Category[]>;
  getTags(): Promise<Tag[]>;
  getTagBySlug(slug: string): Promise<Tag | undefined>;
  getCategoryBySlug(slug: string): Promise<Category | undefined>;
}
```

### Content Types

#### ContentItem

```typescript
interface ContentItem {
  id: string;
  title: string;
  label?: string;
  url: string;
  slug: string;
  description?: string;
  publishedAt: string;
  content: string;
  image?: string;
  status: ContentItemStatus;
  categories: Category[];
  tags: Tag[];
  parentId?: string;
  order?: number;
  children: ContentItem[];
  collapsible?: boolean;
  collapsed?: boolean;
}
```

#### Category and Tag

```typescript
interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string;
}

interface Tag {
  id: string;
  name: string;
  slug: string;
  description?: string;
}
```

### Query Options

#### GetContentItemsOptions

```typescript
interface GetContentItemsOptions {
  collection: string;
  limit?: number;
  offset?: number;
  status?: ContentItemStatus;
  categories?: string[];
  tags?: string[];
  language?: string;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  content?: boolean;
}
```

### Provider Types

#### CmsType

```typescript
type CmsType = 'keystatic' | 'wordpress';
```

#### ContentItemStatus

```typescript
type ContentItemStatus = 'draft' | 'published';
```

## Usage

### Implementing a CMS Provider

```typescript
import { CmsClient, ContentItem, GetContentItemsOptions } from '@kit/cms-types';

export class MyCmsClient implements CmsClient {
  async getContentItems(options: GetContentItemsOptions) {
    // Implementation
    return {
      items: [] as ContentItem[],
      total: 0,
    };
  }

  async getContentItemBySlug(params: {
    slug: string;
    collection: string;
    status?: ContentItemStatus;
  }) {
    // Implementation
    return undefined;
  }

  // ... implement other methods
}
```

### Using Types in Applications

```typescript
import { ContentItem, Category, Tag } from '@kit/cms-types';

function BlogPost({ post }: { post: ContentItem }) {
  return (
    <article>
      <h1>{post.title}</h1>
      <p>{post.description}</p>
      <div>
        {post.categories.map((category: Category) => (
          <span key={category.id}>{category.name}</span>
        ))}
      </div>
    </article>
  );
}
```

### Type Guards

```typescript
import { ContentItemStatus } from '@kit/cms-types';

function isPublished(status: ContentItemStatus): boolean {
  return status === 'published';
}

function isDraft(status: ContentItemStatus): boolean {
  return status === 'draft';
}
```

## Type Extensions

### Extending ContentItem

For provider-specific fields:

```typescript
import { ContentItem } from '@kit/cms-types';

interface MyCustomContentItem extends ContentItem {
  customField: string;
  providerSpecificData: unknown;
}
```

### Provider-Specific Options

```typescript
import { GetContentItemsOptions } from '@kit/cms-types';

interface WordpressOptions extends GetContentItemsOptions {
  authorId?: number;
  sticky?: boolean;
}

interface KeystaticOptions extends GetContentItemsOptions {
  branch?: string;
  includeContent?: boolean;
}
```

## Namespace Organization

Types are organized under the `Cms` namespace:

```typescript
namespace Cms {
  export interface ContentItem { /* ... */ }
  export interface Category { /* ... */ }
  export interface Tag { /* ... */ }
  export type ContentItemStatus = 'draft' | 'published';
  // ... other types
}
```

Usage:

```typescript
import { Cms } from '@kit/cms-types';

function processContent(item: Cms.ContentItem) {
  // Process content
}
```

## Available Scripts

```bash
# Lint the package
pnpm --filter @kit/cms-types lint

# Type check
pnpm --filter @kit/cms-types typecheck

# Format code
pnpm --filter @kit/cms-types format
```

## Package Structure

```
packages/cms/types/
├── src/
│   ├── cms.types.ts      # Core CMS interfaces
│   ├── content.types.ts  # Content-related types
│   └── index.ts         # Package exports
├── package.json
├── tsconfig.json
└── README.md
```

## Dependencies

### Runtime Dependencies
- **None** - Pure TypeScript definitions

### Used By
- `@kit/cms` - Core CMS abstraction
- `@kit/keystatic` - Keystatic CMS provider
- `@kit/wordpress` - WordPress CMS provider
- Any custom CMS providers

## Versioning

This package follows semantic versioning with special attention to:
- **Major versions**: Breaking changes to core interfaces
- **Minor versions**: New optional properties or methods
- **Patch versions**: Documentation and non-breaking improvements

## Best Practices

1. **Extend, don't modify**: Extend base types for provider-specific needs
2. **Use strict types**: Avoid `any` or overly broad types
3. **Document extensions**: Clear JSDoc for custom type extensions
4. **Maintain compatibility**: Consider backward compatibility for interface changes
5. **Test with providers**: Verify types work with actual CMS implementations

## Contributing

When contributing to this package:

1. **Maintain interface stability**: Breaking changes require major version bump
2. **Add comprehensive JSDoc**: Document all interfaces and types
3. **Consider all providers**: Ensure types work across different CMS systems
4. **Test type safety**: Verify types catch expected errors
5. **Update dependents**: Test changes with packages that depend on these types

---

*Last updated: September 20, 2025*
