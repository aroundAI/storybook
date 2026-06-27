import { ToggleGroup, ToggleGroupItem } from '@kit/ui/toggle-group';

export function Default() {
  return (
    <ToggleGroup type="single" defaultValue="views">
      <ToggleGroupItem value="views" size="sm">
        Views
      </ToggleGroupItem>
      <ToggleGroupItem value="watch-time" size="sm">
        Watch time
      </ToggleGroupItem>
      <ToggleGroupItem value="subscribers" size="sm">
        Subscribers
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

export function ChartTypeSwitcher() {
  return (
    <div className="flex items-center gap-4">
      <ToggleGroup type="single" defaultValue="views">
        <ToggleGroupItem value="views" size="sm">
          Views
        </ToggleGroupItem>
        <ToggleGroupItem value="watch-time" size="sm">
          Watch time
        </ToggleGroupItem>
        <ToggleGroupItem value="subscribers" size="sm">
          Subscribers
        </ToggleGroupItem>
      </ToggleGroup>

      <ToggleGroup type="single" defaultValue="line">
        <ToggleGroupItem value="line" size="sm">
          Line
        </ToggleGroupItem>
        <ToggleGroupItem value="area" size="sm">
          Area
        </ToggleGroupItem>
        <ToggleGroupItem value="stacked" size="sm">
          Stacked
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}

export function Outline() {
  return (
    <ToggleGroup type="multiple" variant="outline" defaultValue={['bold']}>
      <ToggleGroupItem value="bold" size="sm">
        Bold
      </ToggleGroupItem>
      <ToggleGroupItem value="italic" size="sm">
        Italic
      </ToggleGroupItem>
      <ToggleGroupItem value="underline" size="sm">
        Underline
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
