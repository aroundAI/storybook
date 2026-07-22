'use client';

import { useEffect, useState, useTransition } from 'react';

import { AlertTriangle, CheckCircle2, Circle, Clock, Download, ExternalLink, ListTodo, Music } from 'lucide-react';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@kit/ui/accordion';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@kit/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@kit/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';

import { getManualTasksAction, updateManualTaskStatusAction } from '../server/manual-task-actions';

interface ManualTaskQueueProps {
  accountId: string;
}

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'skipped' | 'blocked';
type TaskType = 'mla_attachment' | 'localized_thumbnail' | 'end_screen' | 'community_post' | 'other';

interface ManualTask {
  id: string;
  account_id: string;
  publish_id: string | null;
  episode_id: string | null;
  task_type: TaskType;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  title: string;
  instructions: any;
  status: TaskStatus;
  due_at: string | null;
  created_at: string;
}

export function ManualTaskQueue({ accountId }: ManualTaskQueueProps) {
  const [tasks, setTasks] = useState<ManualTask[]>([]);
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('pending');
  const [typeFilter, setTypeFilter] = useState<TaskType | 'all'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  const fetchTasks = async () => {
    setIsLoading(true);
    try {
      const result = await getManualTasksAction({
        accountId,
        status: statusFilter === 'all' ? undefined : statusFilter,
        taskType: typeFilter === 'all' ? undefined : typeFilter,
      });
      setTasks(result as unknown as ManualTask[]);
    } catch (error) {
      console.error('Failed to fetch tasks:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, [accountId, statusFilter, typeFilter]);

  const handleStatusUpdate = async (taskId: string, newStatus: TaskStatus) => {
    startTransition(async () => {
      try {
        await updateManualTaskStatusAction({
          taskId,
          status: newStatus,
        });
        // Optimistically update or refetch
        fetchTasks();
      } catch (error) {
        console.error('Failed to update task status:', error);
      }
    });
  };

  const getStatusBadge = (status: TaskStatus) => {
    switch (status) {
      case 'completed':
        return <Badge variant="default" className="bg-green-500 hover:bg-green-600"><CheckCircle2 className="w-3 h-3 mr-1" /> Completed</Badge>;
      case 'in_progress':
        return <Badge variant="secondary" className="bg-blue-100 text-blue-800"><Clock className="w-3 h-3 mr-1" /> In Progress</Badge>;
      case 'skipped':
        return <Badge variant="outline" className="text-gray-500">Skipped</Badge>;
      case 'blocked':
        return <Badge variant="destructive"><AlertTriangle className="w-3 h-3 mr-1" /> Blocked</Badge>;
      default:
        return <Badge variant="outline"><Circle className="w-3 h-3 mr-1" /> Pending</Badge>;
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return <Badge variant="destructive">Urgent</Badge>;
      case 'high':
        return <Badge variant="secondary" className="bg-orange-100 text-orange-800">High</Badge>;
      case 'low':
        return <Badge variant="outline" className="text-gray-500">Low</Badge>;
      default:
        return null;
    }
  };

  const pendingCount = tasks.filter(t => t.status === 'pending').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ListTodo className="w-6 h-6" />
            Manual Tasks
          </h2>
          <p className="text-muted-foreground">
            {pendingCount > 0 
              ? `You have ${pendingCount} pending task${pendingCount === 1 ? '' : 's'} that require manual action.`
              : 'All caught up! No pending tasks.'}
          </p>
        </div>

        <div className="flex gap-2">
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TaskType | 'all')}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All Task Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="mla_attachment">MLA Audio Tracks</SelectItem>
              <SelectItem value="localized_thumbnail">Localized Thumbnails</SelectItem>
              <SelectItem value="end_screen">End Screens</SelectItem>
              <SelectItem value="community_post">Community Posts</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as TaskStatus | 'all')} className="w-full">
        <TabsList>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="in_progress">In Progress</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
          <TabsTrigger value="all">All Tasks</TabsTrigger>
        </TabsList>

        <TabsContent value={statusFilter} className="mt-6 space-y-4">
          {isLoading ? (
            <div className="flex justify-center p-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : tasks.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <ListTodo className="w-12 h-12 text-muted-foreground mb-4 opacity-20" />
                <p className="text-lg font-medium">No tasks found</p>
                <p className="text-sm text-muted-foreground">Try changing your filters.</p>
              </CardContent>
            </Card>
          ) : (
            tasks.map((task) => (
              <Card key={task.id} className={task.status === 'completed' ? 'opacity-70' : ''}>
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {getStatusBadge(task.status)}
                        {getPriorityBadge(task.priority)}
                        <span className="text-xs text-muted-foreground">
                          {new Date(task.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <CardTitle className="text-xl pt-1">{task.title}</CardTitle>
                      {task.task_type === 'mla_attachment' && task.instructions?.videoTitle && (
                        <CardDescription>
                          Video: <span className="font-medium text-foreground">{task.instructions.videoTitle}</span>
                        </CardDescription>
                      )}
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="pb-3">
                  <Accordion type="single" collapsible className="w-full">
                    <AccordionItem value="instructions" className="border-b-0">
                      <AccordionTrigger className="py-2 hover:no-underline text-sm font-medium text-primary">
                        View Instructions
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="bg-muted/50 p-4 rounded-md mt-2 space-y-4">
                          {task.instructions?.steps && Array.isArray(task.instructions.steps) && (
                            <ol className="list-decimal pl-5 space-y-2 text-sm">
                              {task.instructions.steps.map((step: string, i: number) => (
                                <li key={i}>{step}</li>
                              ))}
                            </ol>
                          )}
                          
                          {task.task_type === 'mla_attachment' && task.instructions?.audioFileUrl && (
                            <div className="flex flex-wrap gap-3 pt-2">
                              <Button variant="outline" size="sm" asChild>
                                <a href={task.instructions.audioFileUrl} target="_blank" rel="noopener noreferrer">
                                  <Download className="w-4 h-4 mr-2" />
                                  Download Audio Track
                                </a>
                              </Button>
                              
                              {task.instructions?.youtubeStudioUrl && (
                                <Button variant="default" size="sm" asChild>
                                  <a href={task.instructions.youtubeStudioUrl} target="_blank" rel="noopener noreferrer">
                                    <ExternalLink className="w-4 h-4 mr-2" />
                                    Open in YouTube Studio
                                  </a>
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </CardContent>

                <CardFooter className="flex justify-end gap-2 pt-2 border-t mt-4 bg-muted/20">
                  {task.status === 'pending' && (
                    <>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        disabled={isPending}
                        onClick={() => handleStatusUpdate(task.id, 'skipped')}
                      >
                        Skip
                      </Button>
                      <Button 
                        variant="default" 
                        size="sm"
                        disabled={isPending}
                        onClick={() => handleStatusUpdate(task.id, 'in_progress')}
                      >
                        Start Task
                      </Button>
                    </>
                  )}
                  
                  {task.status === 'in_progress' && (
                    <>
                      <Button 
                        variant="outline" 
                        size="sm"
                        disabled={isPending}
                        onClick={() => handleStatusUpdate(task.id, 'pending')}
                      >
                        Cancel
                      </Button>
                      <Button 
                        variant="default" 
                        size="sm"
                        className="bg-green-600 hover:bg-green-700 text-white"
                        disabled={isPending}
                        onClick={() => handleStatusUpdate(task.id, 'completed')}
                      >
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        Mark Completed
                      </Button>
                    </>
                  )}
                </CardFooter>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
