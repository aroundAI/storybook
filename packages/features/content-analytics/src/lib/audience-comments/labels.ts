import { z } from 'zod';

/**
 * FILM-1733. What a comment is labelled with: its tone, and what it is
 * about, from closed lists. A label is several facts rather than one score
 * (analytics standard: no composite scores), so "people ask for the next
 * episode" stays separate from "people liked it".
 *
 * One schema for every labeller: the server's model, and a team's own AI
 * writing through the MCP connector. Environment-free: the worker, the MCP
 * tools and the page all import it.
 */

export const COMMENT_SENTIMENTS = ['positive', 'neutral', 'negative'] as const;

export type CommentSentiment = (typeof COMMENT_SENTIMENTS)[number];

export const COMMENT_TOPICS = [
  'story',
  'character',
  'voice_audio',
  'visuals',
  'feels_ai',
  'pacing',
  'wants_more',
  'question',
  'spam',
] as const;

export type CommentTopic = (typeof COMMENT_TOPICS)[number];

/** What each topic means, for a labeller and for the page */
export const COMMENT_TOPIC_MEANINGS: Record<CommentTopic, string> = {
  story: 'the plot, the twist, how it ends',
  character: 'a character, their choices, a performance',
  voice_audio: 'voices, narration, music or sound',
  visuals: 'how it looks: images, animation, editing',
  feels_ai: 'that it looks or sounds AI-made, either way',
  pacing: 'length or pace: too slow, too fast, too long, too short',
  wants_more: 'asks for the next part, more episodes, a series',
  question: 'asks something',
  spam: 'promotion, links, bots, nothing about the video',
};

export const COMMENT_TOPIC_LABELS: Record<CommentTopic, string> = {
  story: 'Story',
  character: 'Characters',
  voice_audio: 'Voice and audio',
  visuals: 'Visuals',
  feels_ai: 'Feels AI-made',
  pacing: 'Pacing and length',
  wants_more: 'Wants more',
  question: 'Questions',
  spam: 'Spam',
};

/** The version of the labelling instructions the server's model reads */
export const COMMENT_LABEL_PROMPT_VERSION = '1';

export const CommentLabelSchema = z.object({
  commentId: z.string().uuid(),
  sentiment: z.enum(COMMENT_SENTIMENTS),
  topics: z
    .array(z.enum(COMMENT_TOPICS))
    .max(COMMENT_TOPICS.length)
    .transform((topics) => [...new Set(topics)]),
});

export type CommentLabel = z.infer<typeof CommentLabelSchema>;

/** The most labels one write takes: the MCP tool's and the worker's batch */
export const MAX_LABELS_PER_WRITE = 200;

export const CommentLabelBatchSchema = z.object({
  labels: z.array(CommentLabelSchema).min(1).max(MAX_LABELS_PER_WRITE),
  /** The model that read the comments, as the labeller names it */
  model: z.string().trim().min(1).max(200),
  /** The labeller's own version of its instructions */
  promptVersion: z.string().trim().min(1).max(50),
});

export type CommentLabelBatch = z.infer<typeof CommentLabelBatchSchema>;

/** The guidance a labeller follows, the server's prompt and the MCP tool's */
export function commentLabelInstructions() {
  const topics = COMMENT_TOPICS.map(
    (topic) => `- ${topic}: ${COMMENT_TOPIC_MEANINGS[topic]}`,
  ).join('\n');

  return [
    'Label each audience comment on one of the team’s own videos.',
    'sentiment: positive, neutral or negative, toward the video. A question or a neutral remark is neutral; sarcasm takes its meaning, not its words.',
    'topics: every one that applies, or none:',
    topics,
    'Use only the comment’s own words. Do not guess at what a short comment meant.',
  ].join('\n');
}
