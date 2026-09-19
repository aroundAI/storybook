import { Avatar, AvatarFallback, AvatarImage } from '@kit/ui/avatar';
import { Badge } from '@kit/ui/badge';
import { Trans } from '@kit/ui/trans';

import { getProjectMembers } from '../lib/server/project.queries';

interface ProjectMembersListProps {
  projectId: string;
}

export async function ProjectMembersList({
  projectId,
}: ProjectMembersListProps) {
  const members = await getProjectMembers(projectId);

  if (members.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        <Trans i18nKey="projects:noMembers" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {members.map((member) => (
        <div
          key={member.id}
          className="flex items-center justify-between rounded-lg border p-4"
          data-test={`member-${member.user_id}`}
        >
          <div className="flex items-center gap-3">
            <Avatar>
              <AvatarImage
                src={member.user.picture_url || undefined}
                alt={member.user.name || ''}
              />
              <AvatarFallback>
                {member.user.name?.charAt(0).toUpperCase() ||
                  member.user.email?.charAt(0).toUpperCase() ||
                  '?'}
              </AvatarFallback>
            </Avatar>

            <div>
              <div className="font-medium">
                {member.user.name || member.user.email}
              </div>
              {member.user.name && member.user.email && (
                <div className="text-sm text-muted-foreground">
                  {member.user.email}
                </div>
              )}
            </div>
          </div>

          <Badge variant="secondary">
            <Trans i18nKey={`projects:role.${member.role}`} />
          </Badge>
        </div>
      ))}
    </div>
  );
}
