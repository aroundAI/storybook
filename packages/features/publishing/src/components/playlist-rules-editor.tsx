'use client';

import React, { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { 
  ListMusic, Plus, Trash2, Edit, Save, GripVertical 
} from 'lucide-react';

import { PlaylistRule } from '../lib/auto-playlist-rules';

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@kit/ui/card';
import { Button } from '@kit/ui/button';
import { Badge } from '@kit/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { Checkbox } from '@kit/ui/checkbox';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import { RadioGroup, RadioGroupItem } from '@kit/ui/radio-group';
import { Switch } from '@kit/ui/switch';

interface PlaylistRulesEditorProps {
  projectId: string;
  accountSlug: string;
  initialRules: PlaylistRule[];
  availablePlaylists: Array<{ id: string; title: string }>;
  onSave: (rules: PlaylistRule[]) => Promise<void>;
}

const AVAILABLE_PLATFORMS = ['youtube'];
const AVAILABLE_CONTENT_TYPES = ['full', 'short', 'trailer'];

export function PlaylistRulesEditor({
  projectId,
  accountSlug,
  initialRules,
  availablePlaylists,
  onSave,
}: PlaylistRulesEditorProps) {
  const [rules, setRules] = useState<PlaylistRule[]>(initialRules);
  const [isSaving, setIsSaving] = useState(false);
  const [editingRule, setEditingRule] = useState<PlaylistRule | null>(null);

  const handleSaveAll = async () => {
    setIsSaving(true);
    try {
      await onSave(rules);
    } catch (error) {
      console.error('Failed to save rules', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddRule = () => {
    setEditingRule({
      id: uuidv4(),
      playlistId: 'auto-create',
      platforms: ['youtube'],
      contentTypes: ['full'],
      orderBy: 'episode_number',
      isActive: true,
      seasonScope: 'all',
    });
  };

  const handleSaveRule = () => {
    if (!editingRule) return;
    
    setRules((prev) => {
      const existingIdx = prev.findIndex((r) => r.id === editingRule.id);
      if (existingIdx >= 0) {
        const newRules = [...prev];
        newRules[existingIdx] = editingRule;
        return newRules;
      }
      return [...prev, editingRule];
    });
    setEditingRule(null);
  };

  const handleDeleteRule = (id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id));
  };

  const getPlaylistDisplayName = (rule: PlaylistRule) => {
    if (rule.playlistId === 'auto-create') {
      return \`Auto-create: \${rule.playlistTitle || 'Default Title'}\`;
    }
    const found = availablePlaylists.find((p) => p.id === rule.playlistId);
    return found ? found.title : rule.playlistId;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Auto-Playlist Rules</h3>
          <p className="text-sm text-muted-foreground">
            Automatically organize your published episodes into YouTube playlists.
          </p>
        </div>
        <Button onClick={handleAddRule} size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Add Rule
        </Button>
      </div>

      {rules.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground border-dashed">
          <ListMusic className="mb-4 h-12 w-12 opacity-20" />
          <p>No playlist rules configured yet.</p>
          <Button variant="link" onClick={handleAddRule}>
            Create your first rule
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {rules.map((rule, index) => (
            <Card key={rule.id}>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="cursor-move text-muted-foreground">
                    <GripVertical className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="font-semibold flex items-center gap-2">
                      {getPlaylistDisplayName(rule)}
                      {!rule.isActive && <Badge variant="secondary">Inactive</Badge>}
                    </h4>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      <span>Platforms: {rule.platforms.join(', ')}</span>
                      <span>•</span>
                      <span>Types: {rule.contentTypes.join(', ')}</span>
                      <span>•</span>
                      <span>Order: {rule.orderBy.replace('_', ' ')}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" onClick={() => setEditingRule(rule)}>
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDeleteRule(rule.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          <div className="flex justify-end pt-4">
            <Button onClick={handleSaveAll} disabled={isSaving}>
              <Save className="mr-2 h-4 w-4" />
              {isSaving ? 'Saving...' : 'Save All Rules'}
            </Button>
          </div>
        </div>
      )}

      {/* Rule Editor Dialog */}
      <Dialog open={!!editingRule} onOpenChange={(open) => !open && setEditingRule(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{rules.find(r => r.id === editingRule?.id) ? 'Edit Rule' : 'New Rule'}</DialogTitle>
            <DialogDescription>
              Configure how episodes are added to playlists.
            </DialogDescription>
          </DialogHeader>

          {editingRule && (
            <div className="space-y-6 py-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="active-rule">Rule is Active</Label>
                <Switch
                  id="active-rule"
                  checked={editingRule.isActive}
                  onCheckedChange={(checked) => setEditingRule({ ...editingRule, isActive: checked })}
                />
              </div>

              <div className="space-y-3">
                <Label>Target Playlist</Label>
                <Select
                  value={editingRule.playlistId}
                  onValueChange={(val) => setEditingRule({ ...editingRule, playlistId: val })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a playlist" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto-create">Auto-create new playlist</SelectItem>
                    {availablePlaylists.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {editingRule.playlistId === 'auto-create' && (
                <div className="space-y-3">
                  <Label>Auto-created Playlist Title</Label>
                  <Input
                    placeholder="e.g. My Awesome Show"
                    value={editingRule.playlistTitle || ''}
                    onChange={(e) => setEditingRule({ ...editingRule, playlistTitle: e.target.value })}
                  />
                  <div className="flex items-center justify-between mt-2">
                    <Label htmlFor="season-scope" className="text-xs font-normal">Include Season Name in Title</Label>
                    <Switch
                      id="season-scope"
                      checked={editingRule.seasonScope === 'current'}
                      onCheckedChange={(checked) => 
                        setEditingRule({ ...editingRule, seasonScope: checked ? 'current' : 'all' })
                      }
                    />
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <Label>Content Types</Label>
                <div className="flex flex-wrap gap-4">
                  {AVAILABLE_CONTENT_TYPES.map((type) => (
                    <div key={type} className="flex items-center space-x-2">
                      <Checkbox
                        id={\`type-\${type}\`}
                        checked={editingRule.contentTypes.includes(type)}
                        onCheckedChange={(checked) => {
                          const newTypes = checked
                            ? [...editingRule.contentTypes, type]
                            : editingRule.contentTypes.filter((t) => t !== type);
                          setEditingRule({ ...editingRule, contentTypes: newTypes });
                        }}
                      />
                      <label htmlFor={\`type-\${type}\`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 capitalize">
                        {type}
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <Label>Ordering</Label>
                <RadioGroup
                  value={editingRule.orderBy}
                  onValueChange={(val: any) => setEditingRule({ ...editingRule, orderBy: val })}
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="episode_number" id="order-ep" />
                    <Label htmlFor="order-ep">By Episode Number (Position = Ep - 1)</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="publish_date" id="order-date" />
                    <Label htmlFor="order-date">By Publish Date (Append to end)</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="manual" id="order-manual" />
                    <Label htmlFor="order-manual">Manual (Append to end)</Label>
                  </div>
                </RadioGroup>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingRule(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveRule} disabled={!editingRule?.contentTypes.length}>
              Save Rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
