import { Trans } from '@kit/ui/trans';

import { getAccountProjects } from '../lib/server/project.queries';
import { ProjectCard } from './project-card';

interface ProjectsListProps {
  accountId: string;
  basePath: string;
}

export async function ProjectsList({ accountId, basePath }: ProjectsListProps) {
  const projects = await getAccountProjects(accountId);

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="text-muted-foreground">
          <Trans i18nKey="projects:emptyState" />
        </div>
        <p className="text-muted-foreground mt-2 text-sm">
          <Trans i18nKey="projects:emptyStateDescription" />
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => (
        <ProjectCard
          key={project.id}
          project={project}
          href={`${basePath}/${project.id}`}
        />
      ))}
    </div>
  );
}
