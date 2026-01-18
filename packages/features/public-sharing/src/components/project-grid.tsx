import Link from 'next/link';

import { Film } from 'lucide-react';

import { Card, CardContent } from '@kit/ui/card';

interface Project {
  id: string;
  name: string;
  description: string | null;
  public_slug: string | null;
  cover_image_url?: string | null;
  episode_count?: number;
}

interface ProjectGridProps {
  projects: Project[];
  companySlug: string;
}

export function ProjectGrid({ projects, companySlug }: ProjectGridProps) {
  if (projects.length === 0) {
    return (
      <div className="text-muted-foreground py-12 text-center">
        <Film className="mx-auto mb-4 h-12 w-12 opacity-50" />
        <p>No public projects yet.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {projects.map((project) => {
        const projectUrl = `/@${companySlug}/${project.public_slug}`;

        return (
          <Link key={project.id} href={projectUrl} className="group block">
            <Card className="overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg">
              {/* Cover Image */}
              <div className="bg-muted relative aspect-video overflow-hidden">
                {project.cover_image_url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={project.cover_image_url}
                    alt={project.name}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : (
                  <div className="from-primary/20 to-primary/5 flex h-full w-full items-center justify-center bg-gradient-to-br">
                    <Film className="text-primary/50 h-12 w-12" />
                  </div>
                )}
              </div>

              <CardContent className="p-4">
                <h3 className="group-hover:text-primary truncate font-semibold transition-colors">
                  {project.name}
                </h3>
                {project.description && (
                  <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
                    {project.description}
                  </p>
                )}
                {project.episode_count !== undefined && (
                  <p className="text-muted-foreground mt-2 text-xs">
                    {project.episode_count} episode
                    {project.episode_count !== 1 ? 's' : ''}
                  </p>
                )}
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
