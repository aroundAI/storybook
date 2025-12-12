/**
 * Audio generation components (FILM-DS-01)
 */

export { AudioPlayer, type AudioPlayerProps } from './AudioPlayer';
export { Waveform, type WaveformProps } from './Waveform';

// Voice cloning components (FILM-510)
export {
  AudioUploader,
  type AudioSample,
  type AudioUploaderProps,
} from './AudioUploader';
export { ConsentDialog, type ConsentDialogProps } from './ConsentDialog';
export {
  VoiceCloningEditor,
  type VoiceCloningEditorProps,
  type VoiceProfile,
} from './VoiceCloningEditor';

// Lip sync components (FILM-511)
export {
  LipSyncEditor,
  type DialogueLine,
  type LipSyncEditorProps,
} from './LipSyncEditor';

// Voice assignment components (FILM-507)
export {
  VoiceAssignmentPanel,
  type VoiceAssignmentProps,
  type VoiceAssignmentCharacter,
} from './VoiceAssignment';
export {
  VoiceSelector,
  type VoiceSelectorProps,
  type VoiceOption,
} from './VoiceSelector';
export {
  VoiceSettingsPanel,
  type VoiceSettingsPanelProps,
} from './VoiceSettings';

// Dialogue list component (FILM-506)
export { DialogueList, type DialogueListProps } from './DialogueList';
