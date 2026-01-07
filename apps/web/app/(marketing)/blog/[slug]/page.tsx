import { cache } from 'react';

import type { Metadata } from 'next';

import { notFound } from 'next/navigation';

import { createCmsClient } from '@kit/cms';

import appConfig from '~/config/app.config';
import { withI18n } from '~/lib/i18n/with-i18n';
import { getArticleSchema, JsonLd } from '~/lib/structured-data';

import { Post } from '../../blog/_components/post';

interface BlogPageProps {
  params: Promise<{ slug: string }>;
}

const getPostBySlug = cache(postLoader);

async function postLoader(slug: string) {
  const client = await createCmsClient();

  return client.getContentItemBySlug({ slug, collection: 'posts' });
}

export async function generateMetadata({
  params,
}: BlogPageProps): Promise<Metadata> {
  const slug = (await params).slug;
  const post = await getPostBySlug(slug);

  if (!post) {
    notFound();
  }

  const { title, publishedAt, description, image } = post;

  return Promise.resolve({
    title,
    description,
    alternates: {
      canonical: `${appConfig.url}/blog/${slug}`,
    },
    openGraph: {
      title,
      description,
      type: 'article',
      publishedTime: publishedAt,
      url: post.url,
      images: image
        ? [
          {
            url: image,
          },
        ]
        : [],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: image ? [image] : [],
    },
  });
}

async function BlogPost({ params }: BlogPageProps) {
  const slug = (await params).slug;
  const post = await getPostBySlug(slug);

  if (!post) {
    notFound();
  }

  // Generate Article structured data for SEO
  const articleSchema = getArticleSchema({
    title: post.title,
    description: post.description ?? '',
    url: `${appConfig.url}/blog/${slug}`,
    imageUrl: post.image,
    datePublished: post.publishedAt,
  });

  return (
    <div className={'container sm:max-w-none sm:p-0'}>
      <JsonLd data={articleSchema} />
      <Post post={post} content={post.content} />
    </div>
  );
}

export default withI18n(BlogPost);

