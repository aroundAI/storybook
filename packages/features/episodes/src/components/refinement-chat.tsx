'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  AlertCircle,
  Check,
  Loader2,
  MessageSquare,
  RotateCcw,
  Send,
} from 'lucide-react';

import {
  refineScreenplayAction,
  refineStoryAction,
  undoRefinementAction,
} from '@kit/episodes/server';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { useLlmJob } from '@kit/ui/hooks';
import { ScrollArea } from '@kit/ui/scroll-area';
import { toast } from '@kit/ui/sonner';
import { Textarea } from '@kit/ui/textarea';
import { cn } from '@kit/ui/utils';

type RefinementStatus = 'pending' | 'refining' | 'applied' | 'error';

interface RefinementMessage {
  id: string;
  feedback: string;
  status: RefinementStatus;
  timestamp: Date;
  errorMessage?: string;
}

interface RefinementChatProps {
  mode: 'story' | 'screenplay';
  episodeId: string;
  projectId: string;
  onRefinementComplete?: () => void;
}

const STATUS_CONFIG: Record<
  RefinementStatus,
  { label: string; className: string; icon: React.ReactNode }
> = {
  pending: {
    label: 'Pending',
    className:
      'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
  },
  refining: {
    label: 'Refining...',
    className:
      'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
  },
  applied: {
    label: 'Applied',
    className:
      'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    icon: <Check className="h-3 w-3" />,
  },
  error: {
    label: 'Error',
    className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    icon: <AlertCircle className="h-3 w-3" />,
  },
};

export function RefinementChat({
  mode,
  episodeId,
  projectId,
  onRefinementComplete,
}: RefinementChatProps) {
  const [messages, setMessages] = useState<RefinementMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const jobType =
    mode === 'story' ? 'story-refinement' : 'screenplay-refinement';

  // WebSocket listener for refinement results
  const {
    status: llmStatus,
    result: llmResult,
    error: llmError,
  } = useLlmJob<{ success: boolean }>(jobType);

  // Handle LLM result from WebSocket
  useEffect(() => {
    if (llmStatus === 'success' && llmResult) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.status === 'refining' ? { ...msg, status: 'applied' } : msg,
        ),
      );
      toast.success(
        `${mode === 'story' ? 'Story' : 'Screenplay'} refined successfully`,
      );
      onRefinementComplete?.();
    } else if (llmStatus === 'error') {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.status === 'refining'
            ? {
                ...msg,
                status: 'error',
                errorMessage: llmError ?? 'Refinement failed',
              }
            : msg,
        ),
      );
      toast.error(llmError ?? 'Refinement failed');
    }
  }, [llmStatus, llmResult, llmError, mode, onRefinementComplete]);

  // Auto-scroll to bottom when new messages appear
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = useCallback(async () => {
    const feedback = input.trim();
    if (!feedback || isSubmitting) return;

    const messageId = `msg-${Date.now()}`;
    const newMessage: RefinementMessage = {
      id: messageId,
      feedback,
      status: 'pending',
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, newMessage]);
    setInput('');
    setIsSubmitting(true);

    try {
      const action =
        mode === 'story' ? refineStoryAction : refineScreenplayAction;
      const result = await action({
        episodeId,
        projectId,
        feedback,
      });

      if (result.queued) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === messageId ? { ...msg, status: 'refining' } : msg,
          ),
        );
      }
    } catch (error) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId
            ? {
                ...msg,
                status: 'error',
                errorMessage:
                  error instanceof Error
                    ? error.message
                    : 'Failed to submit feedback',
              }
            : msg,
        ),
      );
      toast.error('Failed to submit feedback');
    } finally {
      setIsSubmitting(false);
    }
  }, [input, isSubmitting, mode, episodeId, projectId]);

  const handleUndo = useCallback(async () => {
    setIsUndoing(true);
    try {
      await undoRefinementAction({
        episodeId,
        type: mode,
      });
      toast.success(
        `${mode === 'story' ? 'Story' : 'Screenplay'} reverted to previous version`,
      );
      onRefinementComplete?.();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to undo refinement',
      );
    } finally {
      setIsUndoing(false);
    }
  }, [episodeId, mode, onRefinementComplete]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const isRefining = messages.some((m) => m.status === 'refining');
  const hasAppliedRefinement = messages.some((m) => m.status === 'applied');

  const formatTime = (date: Date) =>
    date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-white/10 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-indigo-400" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              Refine {mode === 'story' ? 'Story' : 'Screenplay'}
            </h3>
          </div>
          {hasAppliedRefinement && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleUndo}
              disabled={isUndoing || isRefining}
              className="h-7 gap-1.5 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              {isUndoing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RotateCcw className="h-3 w-3" />
              )}
              Undo
            </Button>
          )}
        </div>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Describe changes you&apos;d like to make
        </p>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        <div ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-8 text-center">
              <MessageSquare className="mb-3 h-8 w-8 text-gray-400 dark:text-gray-500" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No refinements yet
              </p>
              <p className="mt-1 max-w-[200px] text-xs text-gray-400 dark:text-gray-500">
                Type your feedback below to refine the{' '}
                {mode === 'story' ? 'story' : 'screenplay'}
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {messages.map((message) => {
                  const statusConfig = STATUS_CONFIG[message.status];
                  return (
                    <div
                      key={message.id}
                      className="rounded-xl border border-gray-100 bg-gray-50/50 p-3 dark:border-gray-700/50 dark:bg-gray-800/50"
                    >
                      {/* Feedback text */}
                      <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                        {message.feedback}
                      </p>

                      {/* Footer: timestamp + status */}
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {formatTime(message.timestamp)}
                        </span>
                        <Badge
                          variant="secondary"
                          className={cn(
                            'flex items-center gap-1 text-xs',
                            statusConfig.className,
                          )}
                        >
                          {statusConfig.icon}
                          {statusConfig.label}
                        </Badge>
                      </div>

                      {/* Error message */}
                      {message.errorMessage && (
                        <p className="mt-2 text-xs text-red-500 dark:text-red-400">
                          {message.errorMessage}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
              <div ref={messagesEndRef} />
            </>
          )}
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="border-t border-white/10 p-3">
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isRefining
                ? 'Waiting for refinement to complete...'
                : `Describe changes to the ${mode}...`
            }
            disabled={isRefining || isSubmitting}
            className="max-h-[120px] min-h-[60px] resize-none border-gray-200 bg-white text-sm dark:border-gray-700 dark:bg-gray-800"
            rows={2}
          />
          <Button
            onClick={handleSubmit}
            disabled={!input.trim() || isRefining || isSubmitting}
            size="icon"
            className="h-[60px] w-10 shrink-0 bg-indigo-600 hover:bg-indigo-700"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        {isRefining && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-blue-500 dark:text-blue-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            AI is refining your {mode}...
          </p>
        )}
      </div>
    </div>
  );
}
