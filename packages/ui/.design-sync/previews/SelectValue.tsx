import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@kit/ui/select';

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
