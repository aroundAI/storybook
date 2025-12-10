'use client';

import { Eye, MapPin, MoreVertical, Pencil, Trash2, Users } from 'lucide-react';

import type { ProjectTemplate } from '@kit/film-studio/lib';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';

interface TemplateCardProps {
  template: ProjectTemplate;
  onPreview: () => void;
  onUse: () => void;
  isCreating?: boolean;
  showEditActions?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function TemplateCard({
  template,
  onPreview,
  onUse,
  isCreating = false,
  showEditActions = false,
  onEdit,
  onDelete,
}: TemplateCardProps) {
  const characterCount = template.templateData.sampleCharacters?.length ?? 0;
  const locationCount = template.templateData.sampleLocations?.length ?? 0;

  return (
    <Card className="group hover:border-primary/50 relative overflow-hidden transition-colors">
      {/* Thumbnail */}
      {template.thumbnailUrl ? (
        <div className="aspect-video overflow-hidden">
          <img
            src={template.thumbnailUrl}
            alt={template.name}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        </div>
      ) : (
        <div className="bg-muted flex aspect-video items-center justify-center">
          <span className="text-muted-foreground text-sm">No preview</span>
        </div>
      )}

      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg">{template.name}</CardTitle>
            <CardDescription className="mt-1 line-clamp-2">
              {template.description ?? 'No description'}
            </CardDescription>
          </div>

          {showEditActions && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={onDelete}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </CardHeader>

      <CardContent className="pb-2">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{template.category}</Badge>
          {template.genre && <Badge variant="outline">{template.genre}</Badge>}
          {template.isSystem && <Badge variant="default">System</Badge>}
          {template.isPublic && !template.isSystem && (
            <Badge variant="outline">
              <Users className="mr-1 h-3 w-3" />
              Shared
            </Badge>
          )}
        </div>

        <div className="text-muted-foreground mt-3 flex gap-4 text-sm">
          {characterCount > 0 && (
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {characterCount} character{characterCount > 1 ? 's' : ''}
            </span>
          )}
          {locationCount > 0 && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {locationCount} location{locationCount > 1 ? 's' : ''}
            </span>
          )}
          <span>{template.usageCount} uses</span>
        </div>
      </CardContent>

      <CardFooter className="gap-2">
        <Button variant="outline" size="sm" onClick={onPreview}>
          <Eye className="mr-2 h-4 w-4" />
          Preview
        </Button>
        <Button
          size="sm"
          className="flex-1"
          onClick={onUse}
          disabled={isCreating}
        >
          {isCreating ? 'Creating...' : 'Use Template'}
        </Button>
      </CardFooter>
    </Card>
  );
}
