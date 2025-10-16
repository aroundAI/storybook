import Link from 'next/link';

import { Badge } from '@kit/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Trans } from '@kit/ui/trans';

import type { ProjectWithRole } from '../lib/types';

interface ProjectCardProps {
  project: ProjectWithRole;
  href: string;
}

export function ProjectCard({ project, href }: ProjectCardProps) {
  return (
    <Link href={href} className="block">
      <Card
        className="transition-shadow hover:shadow-md"
        data-test={`project-card-${project.id}`}
      >
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <CardTitle className="text-lg">{project.name}</CardTitle>
              {project.description && (
                <CardDescription className="mt-1 line-clamp-2">
                  {project.description}
                </CardDescription>
              )}
            </div>
            {project.user_role && (
              <Badge variant="secondary" className="ml-2">
                <Trans i18nKey={`projects:role.${project.user_role}`} />
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent>
          <div className="text-muted-foreground flex items-center gap-4 text-sm">
            {project.slug && (
              <span className="font-mono text-xs">{project.slug}</span>
            )}

            <span className="ml-auto">
              <Badge
                variant={project.status === 'active' ? 'default' : 'outline'}
                className="capitalize"
              >
                <Trans i18nKey={`projects:status.${project.status}`} />
              </Badge>
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
