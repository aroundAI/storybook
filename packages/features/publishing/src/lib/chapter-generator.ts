import { ChapterMarker, CompilationSegment } from './compilation-types';

export function calculateChaptersFromSegments(segments: CompilationSegment[]): ChapterMarker[] {
  const chapters: ChapterMarker[] = [];
  let currentStartSeconds = 0;

  for (const segment of segments) {
    if (segment.isChapterStart && segment.chapterTitle) {
      chapters.push({
        title: segment.chapterTitle,
        startSeconds: currentStartSeconds,
      });
    }

    let duration = segment.durationSeconds || 0;
    if (!duration && segment.endSeconds !== null) {
      duration = segment.endSeconds - segment.startSeconds;
    }
    
    currentStartSeconds += duration;
  }

  return chapters;
}

function formatSecondsToTimestamp(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  const paddedMinutes = hours > 0 ? minutes.toString().padStart(2, '0') : minutes.toString();
  const paddedSeconds = seconds.toString().padStart(2, '0');

  if (hours > 0) {
    return `${hours}:${paddedMinutes}:${paddedSeconds}`;
  }
  return `${paddedMinutes}:${paddedSeconds}`;
}

export function generateChaptersDescription(chapters: ChapterMarker[]): string {
  return chapters
    .map(
      (chapter) =>
        `${formatSecondsToTimestamp(chapter.startSeconds)} ${chapter.title}`
    )
    .join('\n');
}
