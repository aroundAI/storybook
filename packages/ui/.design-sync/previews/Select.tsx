import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';

export function Default() {
  return (
    <Select defaultValue="public">
      <SelectTrigger className="w-[280px]">
        <SelectValue placeholder="Select visibility" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="public">Public</SelectItem>
        <SelectItem value="unlisted">Unlisted</SelectItem>
        <SelectItem value="private">Private</SelectItem>
      </SelectContent>
    </Select>
  );
}

export function GroupedOpen() {
  return (
    <Select defaultValue="eleven_v3" open>
      <SelectTrigger className="w-[280px]">
        <SelectValue placeholder="Select voice model" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>ElevenLabs</SelectLabel>
          <SelectItem value="eleven_v3">Eleven v3</SelectItem>
          <SelectItem value="eleven_turbo_v2_5">Eleven Turbo v2.5</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Other providers</SelectLabel>
          <SelectItem value="playht">PlayHT</SelectItem>
          <SelectItem value="azure">Azure Speech</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
