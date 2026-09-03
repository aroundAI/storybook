import {
  RadioGroup,
  RadioGroupItem,
  RadioGroupItemLabel,
} from '@kit/ui/radio-group';

export function Default() {
  return (
    <RadioGroup defaultValue="balanced" className="w-[360px]">
      <RadioGroupItemLabel>
        <RadioGroupItem value="dialogue-heavy" id="dialogue-heavy" />
        <div>
          <p className="text-sm font-medium">Dialogue-heavy</p>
          <p className="text-muted-foreground text-xs">
            More scenes driven by character conversation.
          </p>
        </div>
      </RadioGroupItemLabel>
      <RadioGroupItemLabel selected>
        <RadioGroupItem value="balanced" id="balanced" />
        <div>
          <p className="text-sm font-medium">Balanced</p>
          <p className="text-muted-foreground text-xs">
            An even mix of dialogue and visual storytelling.
          </p>
        </div>
      </RadioGroupItemLabel>
      <RadioGroupItemLabel>
        <RadioGroupItem value="action-heavy" id="action-heavy" />
        <div>
          <p className="text-sm font-medium">Action-heavy</p>
          <p className="text-muted-foreground text-xs">
            Favors visual sequences over spoken lines.
          </p>
        </div>
      </RadioGroupItemLabel>
    </RadioGroup>
  );
}
