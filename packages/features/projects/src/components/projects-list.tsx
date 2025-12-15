import { getAccountProjects } from '../lib/server/project.queries';
import { ProjectsListClient } from './projects-list-client';

interface ProjectsListProps {
  accountId: string;
  basePath: string;
}

/**
 * ProjectsList - Server component that fetches projects and renders the client list
 */
export async function ProjectsList({ accountId, basePath }: ProjectsListProps) {
  const projects = await getAccountProjects(accountId);

  return <ProjectsListClient projects={projects} basePath={basePath} />;
}
