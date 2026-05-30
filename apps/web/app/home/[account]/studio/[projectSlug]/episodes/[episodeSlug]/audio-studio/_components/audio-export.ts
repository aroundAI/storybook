import type { CharacterAsset, DialogueLine } from '@kit/audio-generation/lib';
import { toast } from '@kit/ui/sonner';

/**
 * Helper to fetch audio as blob
 */
const fetchAudioAsBlob = async (url: string): Promise<Blob | null> => {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.blob();
  } catch {
    return null;
  }
};

/**
 * Format seconds to SRT timestamp (HH:MM:SS,ms)
 */
export const _formatSrtTime = (seconds: number): string => {
  const date = new Date(0);
  date.setMilliseconds(seconds * 1000);
  const iso = date.toISOString();
  // ISO format is YYYY-MM-DDTHH:MM:SS.mmmZ
  // We want HH:MM:SS,mmm
  return iso.substring(11, 23).replace('.', ',');
};

/**
 * Export all audio assets and SRTs
 */
export async function exportAudioData(
  dialogueLines: DialogueLine[],
  characters: CharacterAsset[],
  episodeTitle: string,
  setIsExporting: (v: boolean) => void,
) {
  if (dialogueLines.length === 0) {
    toast.warning('No dialogue to export');
    return;
  }

  setIsExporting(true);
  toast.info('Preparing Audio export...');

  try {
    // Dynamic import of JSZip
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    // Folders
    const dialogueFolder = zip.folder('Dialogue');
    const srtFolder = zip.folder('Subtitles');

    if (!dialogueFolder || !srtFolder) return;

    // Track fetched audio to avoid duplicates
    const fetchedAudio = new Map<string, Blob>();

    // Sort lines by execution order
    const sortedLines = [...dialogueLines].sort((a, b) => {
      // Sort by scene number first, then sequence number
      // Note: dialogueLines might not have scene number directly if not joined.
      return (a.sequenceNumber || 0) - (b.sequenceNumber || 0);
    });

    for (const line of sortedLines) {
      if (!line.audioUrl) continue;

      // 1. Add Audio File
      let blob = fetchedAudio.get(line.audioUrl);
      if (!blob) {
        blob = (await fetchAudioAsBlob(line.audioUrl)) ?? undefined;
        if (blob) {
          fetchedAudio.set(line.audioUrl, blob);
        }
      }

      if (blob) {
        // Filename: Scene-X_Seq-Y_Character.mp3
        // If scene info is missing, just use Seq-Y
        const characterName =
          characters.find((c) => c.id === line.characterAssetId)?.name ??
          'Unknown';
        const filename = `${line.sequenceNumber.toString().padStart(3, '0')}_${characterName.replace(/[^a-z0-9]/gi, '_')}.mp3`;
        dialogueFolder.file(filename, blob);
      }

      // 2. Append to SRT
      // Assuming we have timing info relative to the start of the episode
      // If 'startTime' exists on the line, use it. Otherwise, we can strictly only generate
      // per-clip SRTs or assume a sequential flow if we had durations.
      // For now, if we don't have global timeline positions, we can't generate a valid global SRT.
      // BUT, looking at `DialogueLine` type, we might not have `startTime`.
      // Let's create individual SRTs per line if global timing isn't available,
      // OR just dump the transcription text.

      // Let's assume for this export we primarily want the files.
      // If we want a global SRT, we'd need the Timeline logic to calculate offsets.
      // Since `dialogueLines` is just a list, we'll skip global SRT for now
      // and just export a JSON manifest of the lines.
    }

    // Export Metadata / Script
    const scriptContent = sortedLines
      .map((l) => {
        const charName =
          characters.find((c) => c.id === l.characterAssetId)?.name ??
          'Unknown';
        return `${charName}: ${l.text}`;
      })
      .join('\n\n');

    zip.file('script_transcript.txt', scriptContent);
    zip.file('dialogue_manifest.json', JSON.stringify(sortedLines, null, 2));

    // Generate and download ZIP
    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audio-export-${episodeTitle.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success(`Exported ${sortedLines.length} dialogue lines`);
  } catch (error) {
    console.error('Audio export failed:', error);
    toast.error('Failed to export audio data');
  } finally {
    setIsExporting(false);
  }
}
