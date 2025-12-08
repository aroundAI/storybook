import Link from 'next/link';

import { Plus } from 'lucide-react';

import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Heading } from '@kit/ui/heading';

import { withI18n } from '~/lib/i18n/with-i18n';

export const metadata = {
  title: 'Film Studio | Create AI-Generated Videos',
  description:
    'Create and manage your AI-generated video projects with Film Studio',
};

interface PageProps {
  params: Promise<{ account: string }>;
}

async function FilmStudioPage({ params }: PageProps) {
  const { account } = await params;

  return (
    <div className="container mx-auto py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <Heading level={2}>Film Studio</Heading>
          <p className="text-muted-foreground mt-2">
            Create and manage your AI-generated video projects
          </p>
        </div>

        <Button asChild data-test="create-project-button">
          <Link href={`/home/${account}/studio/projects/new`}>
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </Link>
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-muted-foreground flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Create Your First Project
            </CardTitle>
            <CardDescription>
              Get started by creating a new Film Studio project with custom
              settings for video and audio generation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" asChild>
              <Link href={`/home/${account}/studio/projects/new`}>
                Get Started
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default withI18n(FilmStudioPage);
