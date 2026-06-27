import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';

const models = [
  'Eleven v3',
  'Eleven Turbo v2.5',
  'Eleven Multilingual v2',
  'Eleven Flash v2.5',
  'PlayHT 2.0',
  'PlayHT Turbo',
  'Azure Neural',
  'Azure Standard',
  'Google Studio',
  'Google Standard',
];

export function Default() {
  return (
    <Select defaultValue={models[6]} open>
      <SelectTrigger className="w-[280px]">
        <SelectValue placeholder="Select voice model" />
      </SelectTrigger>
      <SelectContent style={{ maxHeight: 180 }}>
        {models.map((model) => (
          <SelectItem key={model} value={model}>
            {model}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
