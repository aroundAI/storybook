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
            <div className="text-center py-12 text-muted-foreground">
                <Film className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No public projects yet.</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {projects.map((project) => {
                const projectUrl = `/@${companySlug}/${project.public_slug}`;

                return (
                    <Link key={project.id} href={projectUrl} className="block group">
                        <Card className="overflow-hidden transition-all hover:shadow-lg hover:-translate-y-1">
                            {/* Cover Image */}
                            <div className="aspect-video bg-muted relative overflow-hidden">
                                {project.cover_image_url ? (
                                    /* eslint-disable-next-line @next/next/no-img-element */
                                    <img
                                        src={project.cover_image_url}
                                        alt={project.name}
                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5">
                                        <Film className="w-12 h-12 text-primary/50" />
                                    </div>
                                )}
                            </div>

                            <CardContent className="p-4">
                                <h3 className="font-semibold truncate group-hover:text-primary transition-colors">
                                    {project.name}
                                </h3>
                                {project.description && (
                                    <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                                        {project.description}
                                    </p>
                                )}
                                {project.episode_count !== undefined && (
                                    <p className="text-xs text-muted-foreground mt-2">
                                        {project.episode_count} episode{project.episode_count !== 1 ? 's' : ''}
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
