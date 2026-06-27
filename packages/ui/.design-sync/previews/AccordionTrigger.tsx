import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@kit/ui/accordion';

export function Default() {
  return (
    <Accordion
      type="multiple"
      defaultValue={['voice']}
      className="w-full max-w-md"
    >
      <AccordionItem value="voice">
        <AccordionTrigger data-test="character-voice-accordion">
          Voice &amp; Delivery
        </AccordionTrigger>
        <AccordionContent>
          <p className="text-muted-foreground">
            Define how this character sounds: pitch, pacing, accent, and
            emotional range used when generating narration and dialogue.
          </p>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="personality">
        <AccordionTrigger data-test="character-personality-accordion">
          Personality Traits
        </AccordionTrigger>
        <AccordionContent>
          <p className="text-muted-foreground">
            Core motivations, quirks, and behavioral patterns that shape how
            this character reacts across scenes.
          </p>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="appearance">
        <AccordionTrigger data-test="character-appearance-accordion">
          Appearance
        </AccordionTrigger>
        <AccordionContent>
          <p className="text-muted-foreground">
            Age, build, hair, eyes, and wardrobe details used to keep VEO 3.1
            shots visually consistent across episodes.
          </p>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

export function SingleCollapsible() {
  return (
    <Accordion type="single" collapsible defaultValue="season-1" className="w-full max-w-md">
      <AccordionItem value="season-1">
        <AccordionTrigger>Season 1 — Origins</AccordionTrigger>
        <AccordionContent>
          8 episodes covering the founding mystery. Tone: investigative,
          slow-burn.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="season-2">
        <AccordionTrigger>Season 2 — Fallout</AccordionTrigger>
        <AccordionContent>
          6 episodes. Tone shifts toward faster-paced thriller beats.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
