# @kit/wordpress

![Complexity: Simple](https://img.shields.io/badge/complexity-simple-green)

## Overview

The `@kit/wordpress` package provides a WordPress CMS integration for Next.js applications. It implements the `@kit/cms-types` interface to deliver headless WordPress functionality through the WordPress REST API.

## Purpose

This package offers:
- **WordPress REST API integration**: Access WordPress content programmatically
- **Headless WordPress**: Use WordPress as a content backend for Next.js
- **Content rendering**: Rich content rendering with WordPress blocks
- **Media management**: WordPress media library integration
- **User authentication**: WordPress user management integration
- **SEO optimization**: WordPress SEO data integration

## Technology Stack

- **WordPress REST API**: Content management backend
- **React**: Content rendering components
- **TypeScript**: Full type safety
- **Next.js**: Server and client-side integration

## Installation

```bash
pnpm add @kit/wordpress
```

## Configuration

### Environment Variables

```bash
# .env.local
CMS_CLIENT=wordpress
WORDPRESS_API_URL=https://your-wordpress-site.com/wp-json/wp/v2
WORDPRESS_AUTH_USER=your_username
WORDPRESS_AUTH_PASSWORD=your_app_password
```

## Usage

### Creating WordPress Client

```typescript
import { createWordpressClient } from '@kit/wordpress';

const cms = createWordpressClient();

// Fetch posts
const posts = await cms.getContentCollection('posts');
const post = await cms.getContentItem('posts', 'post-slug');
```

### Content Rendering

```typescript
import { WordpressContentRenderer } from '@kit/wordpress/renderer';

function BlogPost({ content }: { content: string }) {
  return (
    <article>
      <WordpressContentRenderer content={content} />
    </article>
  );
}
```

### Integration with @kit/cms

```typescript
import { createCmsClient } from '@kit/cms';

// Set CMS_CLIENT=wordpress
const cms = await createCmsClient();
const posts = await cms.getContentCollection('posts');
```

## API Reference

### `createWordpressClient()`

Creates a WordPress CMS client implementing the `CmsClient` interface.

**Returns:** `CmsClient`

**Methods:**
- `getContentCollection(collection, options?)` - Get multiple posts/pages
- `getContentItem(collection, slug, options?)` - Get single post/page
- `getCategories()` - Get WordPress categories
- `getTags()` - Get WordPress tags
- `searchContent(query, options?)` - Search WordPress content

### `WordpressContentRenderer`

React component for rendering WordPress content blocks.

**Props:**
- `content: string` - WordPress content HTML

## Content Types

### Posts

```typescript
interface WordpressPost {
  id: number;
  title: string;
  content: string;
  excerpt: string;
  slug: string;
  date: string;
  status: 'publish' | 'draft' | 'private';
  categories: number[];
  tags: number[];
  featured_media: number;
  author: number;
}
```

### Pages

```typescript
interface WordpressPage {
  id: number;
  title: string;
  content: string;
  excerpt: string;
  slug: string;
  date: string;
  status: 'publish' | 'draft' | 'private';
  parent: number;
  menu_order: number;
  featured_media: number;
}
```

## Authentication

### Application Passwords

1. **Create Application Password** in WordPress admin
2. **Set environment variables**:
```bash
WORDPRESS_AUTH_USER=your_username
WORDPRESS_AUTH_PASSWORD=your_app_password
```

### JWT Authentication

```typescript
// Custom authentication
const client = createWordpressClient({
  auth: {
    type: 'jwt',
    token: 'your_jwt_token',
  },
});
```

## Available Scripts

```bash
# Lint the package
pnpm --filter @kit/wordpress lint

# Type check
pnpm --filter @kit/wordpress typecheck

# Format code
pnpm --filter @kit/wordpress format
```

## Package Structure

```
packages/cms/wordpress/
├── src/
│   ├── wordpress-client.ts     # WordPress CMS client
│   ├── content-renderer.tsx    # Content rendering component
│   └── index.ts               # Package exports
├── package.json
├── tsconfig.json
└── README.md
```

## Dependencies

### Required Packages
- `@kit/cms-types` - CMS interface definitions
- `react` - React framework

### Used By
- `@kit/cms` - CMS abstraction layer
- `apps/web` - Main application

## WordPress Setup

### Required Plugins

- **None** - Uses WordPress core REST API
- **Optional**: WordPress SEO plugins for enhanced metadata
- **Optional**: Custom post type plugins for extended content

### Permissions

Ensure your WordPress user has:
- Read access to posts and pages
- Access to media library
- Appropriate category and tag permissions

## Best Practices

1. **Use Application Passwords**: More secure than regular passwords
2. **Cache content**: WordPress API can be slow, implement caching
3. **Handle errors**: API requests can fail, implement error handling
4. **Optimize images**: Use WordPress image optimization
5. **SEO integration**: Leverage WordPress SEO plugins

## Contributing

When contributing to this package:

1. **Follow WordPress conventions**: Use WordPress naming and patterns
2. **Test with real WordPress sites**: Verify functionality with actual WordPress installations
3. **Handle API limitations**: Work within WordPress REST API constraints
4. **Document authentication**: Clear examples for different auth methods

---

*Last updated: September 20, 2025*
