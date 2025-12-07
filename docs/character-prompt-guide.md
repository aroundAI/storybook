# Character Prompt Engineering Guide for Kling AI

> **SPIKE-05 Deliverable**: Best practices for writing prompts that maintain character consistency across video shots.

## Overview

This guide provides practical prompt engineering techniques for Kling AI video generation, with a focus on maintaining character consistency across multiple shots for storytelling.

---

## Prompt Structure

### Basic Structure

```
[Subject] + [Subject Description] + [Subject Movement] + [Scene] + [Scene Description] + [Camera] + [Lighting/Atmosphere]
```

### Example Progression

| Level | Prompt |
|-------|--------|
| **Basic** | "A woman walks through a park." |
| **Enhanced** | "A young woman with red hair, wearing a blue jacket, walks through a park. Trees line the path." |
| **Advanced** | "Medium shot, soft natural lighting. A young woman with flowing red hair in a ponytail, wearing a blue denim jacket, walks confidently through a sunlit park. Autumn leaves scatter on the ground. Cinematic color grading." |

---

## Character Description Templates

### Template 1: Simple Character

```
A [age range] [gender] with [hair description], [facial features], wearing [clothing]
```

**Example**:
> "A young woman with red hair in a ponytail, wearing a blue jacket"

**Best for**: Quick generations, establishing shots, background characters

### Template 2: Detailed Character

```
A [age]-year-old [ethnicity/nationality] [gender] with [hair color/style/length], [eye color], [distinctive features], wearing [detailed clothing description with colors and materials]
```

**Example**:
> "A 30-year-old Black man with short curly hair, brown eyes, a well-groomed beard, wearing round glasses, a gray cotton hoodie, and dark blue jeans"

**Best for**: Main characters, close-up shots, critical scenes

### Template 3: Storytelling Character

```
[Character name/role], a [brief description]. [Distinctive visual elements]. [Current state/emotion]. [Clothing/accessories relevant to scene].
```

**Example**:
> "Maya, a determined young scientist. Bright red hair pulled back in a practical ponytail, intense green eyes behind safety goggles. Focused and alert. White lab coat over a black turtleneck."

**Best for**: Narrative sequences, character-driven scenes

---

## Prompt Patterns for Consistency

### Pattern 1: Character-First Prompt

Put character description at the start for emphasis:

```
[Detailed Character Description]. [Action]. [Scene]. [Camera/Style].
```

**Example**:
> "A woman with long auburn hair, freckles, wearing a vintage floral dress. She reads a book while sitting on a park bench. Golden hour lighting, shallow depth of field."

### Pattern 2: Action-Wrapped Character

Embed character details within the action:

```
[Camera shot], [Character doing action], [character appearance details]. [Scene details].
```

**Example**:
> "Medium shot, a red-haired woman in a blue denim jacket walks through a crowded market, her ponytail swaying with each step. Vendors and colorful stalls fill the background."

### Pattern 3: Cinematic Structure

Mirror film screenplay format:

```
[Shot type]. [Scene description]. [Character name/description] [action]. [Camera movement]. [Mood/lighting].
```

**Example**:
> "Wide shot. A quiet suburban street at dusk. Sarah (red hair, blue jacket) walks alone toward the camera. Slow push-in. Melancholic atmosphere, streetlights flickering on."

---

## Elements Feature Best Practices

### When to Use Elements

| Scenario | Elements Recommended? | Notes |
|----------|----------------------|-------|
| Same character, multiple shots | Yes | Primary use case |
| Character in new scene | Yes | Maintains identity |
| Multiple characters together | Yes (with caution) | May need separate generations |
| Dynamic action scenes | Maybe | Simpler actions work better |
| Background/establishing | No | Not needed |

### Element Image Selection

**Ideal Reference Image Properties**:
- Clear, high-resolution face (300px+ minimum)
- Good lighting, no harsh shadows
- Neutral or relevant expression
- Uncluttered background
- Character fills ~50-70% of frame

**Avoid**:
- Blurry or low-res images
- Heavy makeup/effects
- Extreme angles (unless intentional)
- Busy backgrounds
- Multiple people in single image

### Element + Prompt Integration

**Do**: Describe element subjects in the prompt
```json
{
  "prompt": "A woman with red hair walks through a garden, picking flowers",
  "elements": [{ "image_url": "red-haired-woman-reference.png" }]
}
```

**Don't**: Contradict element with prompt
```json
{
  // BAD: Prompt says blonde but element shows red hair
  "prompt": "A blonde woman walks through a garden",
  "elements": [{ "image_url": "red-haired-woman-reference.png" }]
}
```

### Multi-Element Strategy

```json
{
  "elements": [
    { "image_url": "character-front-face.png" },      // Primary face reference
    { "image_url": "character-profile.png" },         // Alternative angle
    { "image_url": "character-outfit.png" },          // Clothing reference
    { "image_url": "scene-style.png" }                // Visual style reference
  ]
}
```

---

## Image-to-Video Prompts

For animating a still image, focus on **movement**, not appearance (the image provides appearance).

### Structure

```
[Subject] + [Movement], [Background] + [Movement]
```

### Examples

**Static Subject, Dynamic Background**:
> "Woman stands still, looking at camera. Wind blows leaves across the frame, clouds drift in sky."

**Dynamic Subject, Static Background**:
> "Man walks forward confidently, arms swinging naturally. Background remains static."

**Both Dynamic**:
> "Cat astronaut walks forward on alien landscape, tail swaying gently. Meteors streak across the sky behind."

### Tips for I2V

1. **Name the subject**: "The woman" not "A woman" (references the image)
2. **Describe movement, not appearance**: Image provides the look
3. **Keep movements simple**: "walks forward", "turns head slowly"
4. **Specify what stays still**: "static background", "camera fixed"

---

## Camera Movement Prompts

### Kling's Camera Terminology

**Important**: Kling uses non-standard terms!

| Kling Term | Standard Term | Effect |
|------------|---------------|--------|
| `horizontal` | Track | Move camera left/right |
| `vertical` | Pedestal | Move camera up/down |
| `pan` | Tilt | Rotate camera up/down |
| `tilt` | Pan | Rotate camera left/right |
| `roll` | Dutch angle | Rotate on lens axis |
| `zoom` | Zoom | Zoom in/out |

### Camera Prompt Examples

**360-Degree Rotation** (type in prompt, not in dropdown):
> "A chef prepares sushi, 360 spin around the character, photorealistic, cinematic"

**Push-In**:
> "The detective examines the evidence. Camera slowly pushes in on her face. Dramatic lighting."

**Tracking Shot**:
> "Following the runner through city streets, camera moves alongside, morning light."

---

## Avoiding Common Pitfalls

### Pitfall 1: Over-Specificity with Numbers

**Bad**:
> "5 birds fly across the sky, 3 trees in background"

**Good**:
> "Several birds fly across the sky, trees dotting the landscape"

**Why**: AI struggles with exact counts; results are inconsistent.

### Pitfall 2: Complex Physical Actions

**Bad**:
> "The basketball player dribbles twice, spins around the defender, and dunks"

**Good**:
> "The basketball player drives toward the basket and dunks"

**Why**: Complex sequences often break down; keep actions simple.

### Pitfall 3: Contradictory Descriptions

**Bad**:
> "A young woman with long hair" + [element showing short-haired woman]

**Good**:
> Ensure prompt matches element images exactly

### Pitfall 4: Slow Motion Triggers

**Words that may trigger slow motion**:
- "gracefully", "smoothly", "gently", "elegantly"

**To avoid slow motion**:
> "quickly", "briskly", "at normal speed", "natural pace"

### Pitfall 5: Banned Words

**Known banned words** (will reject prompt):
- `chest`, `pig`, `exorcism`, `filthy`

**Workarounds**:
- `pig` → `piglet`
- `filthy` → `unclean`, `dirty`
- `chest` → `torso`, `upper body`

**Test first**: Use Kling's image generator (cheaper) to test prompts.

---

## Multi-Character Prompts

### Challenge: Contagion Effect

When prompting 2+ characters doing different things, AI tends to make them do the same action.

### Strategies

**Strategy 1: Explicit Separation**
```
Character A (red-haired woman) sits reading a book. Character B (tall man with glasses) stands by the window, looking outside.
```

**Strategy 2: Position Anchoring**
```
In the left of frame, the woman reads quietly. On the right side, the man paces nervously.
```

**Strategy 3: Generate Separately**

Generate each character in separate videos, then composite in post-production.

**Strategy 4: Accept Mirroring**

For interactions, accept that characters may mirror actions:
> "Two friends walk side by side through the park, chatting and laughing"

---

## Shot Type Prompt Patterns

### Close-Up (Face Focus)

```
Extreme close-up of [character's] face. [Expression/emotion]. [Subtle movement]. [Lighting].
```

> "Extreme close-up of Maya's face. Her green eyes widen with realization. A slight smile forms. Soft key light from the left."

### Medium Shot (Waist Up)

```
Medium shot. [Character description] [action]. [Setting context]. [Mood].
```

> "Medium shot. The detective in her worn trench coat examines a photograph. Her office is cluttered with case files. Noir atmosphere."

### Wide Shot (Full Environment)

```
Wide establishing shot. [Setting description]. [Character small in frame] [action]. [Atmosphere].
```

> "Wide shot of a rainy Tokyo street at night. A lone figure in a red umbrella walks between neon signs. Cyberpunk aesthetic."

### Over-the-Shoulder

```
Over-the-shoulder shot from behind [Character A], looking at [Character B]. [Context]. [Mood].
```

> "Over-the-shoulder from behind the interviewer, looking at the nervous job candidate across the desk. Corporate office, tense atmosphere."

---

## Consistency Maintenance Checklist

### Before Generating

- [ ] Character description matches reference images
- [ ] Clothing details are consistent with previous shots
- [ ] Scene/setting is appropriate for story continuity
- [ ] Camera angle matches selected element references
- [ ] Prompt doesn't contain banned words

### During Generation

- [ ] Use Elements feature for main characters
- [ ] Include version: "1.6" or higher for Elements
- [ ] Use "pro" mode for quality-critical shots
- [ ] Consider generating 2-3 options for selection

### After Generation

- [ ] Verify character face matches reference
- [ ] Check clothing consistency
- [ ] Confirm setting matches expectations
- [ ] Extract useful frames for future references

---

## Example Character Workflow

### Step 1: Define Character

```typescript
const maya: CharacterProfile = {
  name: "Maya Chen",
  baseDescription: "A 28-year-old Asian-American woman",
  hair: "long black hair with subtle purple highlights, often in a loose braid",
  eyes: "dark brown eyes with determined expression",
  distinguishing: "small scar above left eyebrow, silver ear cuff",
  defaultOutfit: "black leather jacket over band t-shirt, dark jeans",
};
```

### Step 2: Generate Base Reference

**Prompt for image generation**:
> "Portrait of a 28-year-old Asian-American woman with long black hair in a loose braid, subtle purple highlights, dark brown eyes, determined expression, small scar above left eyebrow, silver ear cuff. Black leather jacket over band t-shirt. Studio lighting, neutral gray background. High detail, professional photograph."

### Step 3: Create Reference Library

Generate video with varied expressions:
> "Static shot of Maya auditioning for a role. She displays various emotions: curiosity, surprise, determination, amusement. She tilts her head slightly, looks left then right. Neutral background, soft lighting."

Extract frames at key expressions.

### Step 4: Scene Generation Prompts

**Scene 1 - Introduction**:
> "Medium shot. Maya Chen, a young woman with long black braided hair and a black leather jacket, enters a dimly lit bar. She scans the room with cautious eyes. Neon signs reflect off her silver ear cuff. Neo-noir atmosphere."

**Scene 2 - Confrontation**:
> "Close-up. Maya's face shows fierce determination, her dark eyes narrowing. The scar above her eyebrow catches the harsh overhead light. She speaks firmly, jaw set. Dramatic shadows."

**Scene 3 - Resolution**:
> "Wide shot. Morning light streams through the window. Maya sits at a small table, coffee in hand, a rare smile softening her features. Her braid falls over her shoulder. Warm, hopeful atmosphere."

---

## Quick Reference Card

### Character Description Formula

```
[Age] [ethnicity] [gender] with [hair], [eyes], [distinctive features], wearing [clothing]
```

### Action Prompt Formula

```
[Shot type]. [Character] [action]. [Setting]. [Camera movement]. [Mood/lighting].
```

### Elements Configuration

```json
{
  "version": "1.6",
  "mode": "pro",
  "elements": [{ "image_url": "..." }]
}
```

### Banned Words to Avoid

`chest`, `pig`, `exorcism`, `filthy`

### Camera Terms (Kling-specific)

- `pan` = tilt up/down
- `tilt` = pan left/right
- For 360 spin: add "360 rotation" to prompt text

---

## References

- [Character Consistency Report](./character-consistency-report.md)
- [Kling API Reference](./kling-api-reference.md)
- [Kling Integration Guide](./kling-integration-guide.md)
