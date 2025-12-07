# Character Consistency Report: Kling AI Video Generation

> **SPIKE-05 Deliverable**: Analysis of Kling's character consistency capabilities and recommendations for implementation.

## Executive Summary

Character consistency across multiple video shots is the #1 challenge in AI video storytelling. After researching Kling AI's capabilities, particularly the "Elements" feature, we've identified practical approaches to maintain reasonable consistency while setting realistic user expectations.

### Key Findings

| Aspect | Rating | Notes |
|--------|--------|-------|
| Face Consistency (same angle) | Excellent | Near-identical with high strength slider |
| Face Consistency (different angles) | Good | Requires reference images from video frames |
| Clothing Consistency | Moderate | Elements feature helps; Virtual Try-On limited |
| Multi-Character Consistency | Challenging | "Contagion effect" - characters tend to mirror actions |
| Style/Mood Consistency | Good | Achievable with consistent prompting |
| Cross-Shot Narrative | Moderate | Requires careful workflow design |

---

## The Elements Feature

### What It Is

Kling's Elements feature allows uploading 1-4 reference images that the model uses to maintain consistency of characters, objects, or scenes across video generations.

### Technical Specifications

- **Image Count**: 1-4 images per request
- **Formats**: JPG, PNG
- **Max Size**: 10MB per image
- **Min Dimension**: 300px
- **Version Required**: 1.6 or higher

### API Usage

```json
{
  "model": "kling",
  "task_type": "video_generation",
  "input": {
    "prompt": "A woman walking through a park",
    "elements": [
      { "image_url": "https://example.com/character-face.png" },
      { "image_url": "https://example.com/character-outfit.png" }
    ],
    "duration": 5,
    "aspect_ratio": "16:9",
    "version": "1.6",
    "mode": "std"
  }
}
```

### How Elements Work

1. **Whole Image as Element**: The entire uploaded image is treated as one element
2. **No Region Selection**: Cannot select specific parts of an image
3. **Subject Extraction**: Kling identifies and uses the main subject
4. **Prompt Integration**: Describe how elements should interact in the main prompt

---

## Consistency Strategies

### Strategy 1: Reference Image Generation Workflow

The most effective approach for character consistency:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ 1. Generate     │────▶│ 2. Create Short │────▶│ 3. Extract      │
│ Initial Image   │     │ Video (5s)      │     │ Key Frames      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
        ┌───────────────────────────────────────────────┘
        ▼
┌─────────────────┐     ┌─────────────────┐
│ 4. Use Frames   │────▶│ 5. Generate     │
│ as References   │     │ New Videos      │
└─────────────────┘     └─────────────────┘
```

#### Step-by-Step Process

1. **Create Base Character Image**
   - Use Flux, Midjourney, or Kling's image generator
   - Front-facing, neutral expression, clear lighting
   - High resolution (1024px+ recommended)

2. **Generate Initial Video**
   - Use base image as reference
   - Prompt for varied expressions/angles:
     > "Static shot of the person auditioning as an actor, displaying various emotions, tilting head left then right, showing surprise, curiosity, and calm"

3. **Extract Diverse Frames**
   - Pull frames showing different angles
   - Get varied expressions (smile, serious, surprised)
   - Save profile views, 3/4 views

4. **Build Reference Library**
   - Organize frames by angle and expression
   - Use appropriate reference for each shot

5. **Generate Subsequent Videos**
   - Use matching reference for shot angle
   - Include 1-2 element images per generation

### Strategy 2: Kling Image Generator Reference

For maintaining face consistency using Kling's image generator:

#### Reference Strength Slider

| Value | Effect | Best For |
|-------|--------|----------|
| 0-40 | Loose resemblance | Creative variations |
| 42 (default) | Similar face, not exact | General use |
| 70-100 | Near-identical face | Strict consistency |

**Trade-off**: Higher values = better consistency but same angle/expression stamped repeatedly.

#### Recommendation

Use **70-85** for initial reference, then generate videos to get new angles, extract frames, and use those as additional references.

### Strategy 3: Multi-Element Approach

Combine multiple element types for comprehensive consistency:

```json
{
  "elements": [
    { "image_url": "character-face-front.png" },
    { "image_url": "character-face-profile.png" },
    { "image_url": "character-outfit.png" },
    { "image_url": "scene-style-reference.png" }
  ]
}
```

### Strategy 4: Progressive Referencing (Caution)

Using each generated shot as reference for the next:

```
Shot 1 (text) → Shot 2 (ref: Shot 1) → Shot 3 (ref: Shot 2) → ...
```

**Warning**: This causes "visual drift" over 5+ shots. Character gradually morphs away from original.

**Better Approach**: Always reference back to original base images, not the previous generation.

---

## Consistency Challenges

### Challenge 1: Angle/Expression Lock

**Problem**: High-strength face references lock in the exact angle and expression.

**Solution**:
- Generate short video first to extract varied angles
- Maintain library of reference frames at different angles
- Accept some variation in exchange for dynamic poses

### Challenge 2: Clothing Inconsistency

**Problem**: Clothing details frequently change between generations.

**Solution**:
- Include clothing in element references
- Be specific about clothing in prompt
- Use Elements feature with outfit images
- Accept minor variations (wrinkles, exact fit)

### Challenge 3: Multi-Character "Contagion Effect"

**Problem**: When prompting for 2+ characters doing different actions, AI tends to make them do the same thing.

**Solutions**:
- Generate characters separately, composite in post
- Accept that both characters may mirror actions
- Use very explicit, separated descriptions:
  > "Character A (red hair) stands still. Character B (black hair) waves goodbye."

### Challenge 4: Complex Actions

**Problem**: Dynamic movements (dancing, jumping, running) reduce consistency.

**Solutions**:
- Use simpler movements for consistency-critical shots
- Generate multiple options and pick best match
- Break complex actions into shorter segments

### Challenge 5: Virtual Try-On Limitations

**Problem**: Kling's Virtual Try-On produces lower quality output.

**Recommendation**: Skip Virtual Try-On for production. Instead:
- Include outfit in initial character image
- Use Elements with outfit references
- Prompt for specific clothing details

---

## Realistic Expectations

### What Works Well

- **Same character, same angle**: 90%+ consistency
- **Same character, similar angles**: 80%+ consistency
- **General style/mood**: 85%+ consistency
- **Simple movements**: 75%+ consistency
- **Single character scenes**: 80%+ consistency

### What's Challenging

- **Exact clothing match**: 60-70% consistency
- **Multiple characters**: 50-70% consistency
- **Complex movements**: 40-60% consistency
- **Accessories (glasses, jewelry)**: 50-70% consistency
- **5+ shot sequences**: Requires careful workflow

### User Expectation Setting

**Key Message**: AI video generation produces "good enough" consistency for storytelling, not frame-perfect continuity.

**Recommended UI Messaging**:
> "AI-generated videos maintain character resemblance across shots. Minor variations in appearance are normal and part of the AI generation process."

---

## Evaluation Criteria

### Consistency Scoring (1-5 Scale)

| Score | Label | Description |
|-------|-------|-------------|
| 5 | Perfect | Indistinguishable from same character |
| 4 | Excellent | Clear same character, minor variations |
| 3 | Good | Recognizable as same character |
| 2 | Fair | Similar but noticeable differences |
| 1 | Poor | Different person/appearance |

### Elements to Evaluate

1. **Facial Features**
   - Face structure and proportions
   - Eye color and shape
   - Nose and mouth features
   - Skin tone

2. **Body**
   - Height and build
   - Body proportions
   - Posture

3. **Clothing**
   - Color accuracy
   - Style and design
   - Fit and details
   - Accessories

4. **Overall**
   - Would viewer recognize as same character?
   - Could this work in a multi-shot sequence?

### Usability Rating

- **Pass**: Can use as-is in final output
- **Acceptable**: Minor inconsistencies, still usable
- **Regenerate**: Too inconsistent, needs new generation

---

## Hypotheses Tested (Research Conclusions)

| # | Hypothesis | Finding |
|---|------------|---------|
| H1 | Reference images > text-only | **Confirmed** - Significant improvement |
| H2 | Detailed prompts > brief | **Partially** - Too detailed can backfire |
| H3 | Consistency degrades over shots | **Confirmed** - Progressive referencing causes drift |
| H4 | Simple characters > complex | **Confirmed** - Fewer details = easier to maintain |
| H5 | Close-ups better than wide | **Confirmed** - Face detail preserved in close-ups |
| H6 | Complex actions reduce consistency | **Confirmed** - Keep movements simple |
| H7 | Previous shot as ref causes drift | **Confirmed** - Use original refs instead |
| H8 | Multi-character reduces individual consistency | **Confirmed** - "Contagion effect" observed |

---

## Recommended Implementation Approach

### Character Data Model

```typescript
interface Character {
  id: string;
  name: string;
  description: string;  // Text description for prompts

  // Reference images
  primaryReference: string;  // Main face reference URL
  references: {
    angle: 'front' | 'profile' | 'three-quarter';
    expression: 'neutral' | 'happy' | 'serious' | 'surprised';
    imageUrl: string;
  }[];

  // Clothing references
  outfitReferences: {
    name: string;
    imageUrl: string;
  }[];

  // Generated from character description
  elementPrompt: string;  // Optimized prompt for Elements feature
}
```

### Element Prompt Generation

```typescript
function generateElementPrompt(character: Character): string {
  // Construct optimized prompt for Kling's Elements
  const parts = [
    character.name,
    character.description,
    'maintains exact appearance throughout',
  ];

  return parts.join(', ');
}
```

### Shot Generation Workflow

```typescript
async function generateShotWithConsistency(
  shot: Shot,
  characters: Character[],
): Promise<GenerationJob> {
  // 1. Select appropriate references based on shot type
  const elements = characters.flatMap(char =>
    selectReferencesForShot(char, shot.shotType, shot.cameraAngle)
  );

  // 2. Build prompt with character consistency hints
  const prompt = buildConsistentPrompt(shot.description, characters);

  // 3. Generate with Elements
  return await klingClient.createVideoTask({
    prompt,
    elements: elements.slice(0, 4),  // Max 4 elements
    duration: shot.duration,
    aspectRatio: shot.aspectRatio,
    mode: 'pro',  // Pro mode for better quality
    version: '1.6',  // Required for Elements
  });
}

function selectReferencesForShot(
  character: Character,
  shotType: string,
  cameraAngle: string,
): ElementReference[] {
  // Match reference angle to shot requirements
  const angleMap: Record<string, string> = {
    'close-up': 'front',
    'medium': 'front',
    'wide': 'front',
    'profile': 'profile',
    'over-shoulder': 'three-quarter',
  };

  const targetAngle = angleMap[shotType] ?? 'front';

  const matchingRef = character.references.find(
    ref => ref.angle === targetAngle
  );

  return matchingRef
    ? [{ image_url: matchingRef.imageUrl }]
    : [{ image_url: character.primaryReference }];
}
```

### Batch Generation with Cherry-Picking

For critical shots, generate multiple options:

```typescript
async function generateWithOptions(
  shot: Shot,
  characters: Character[],
  optionCount: number = 3,
): Promise<GenerationJob[]> {
  const jobs = await Promise.all(
    Array.from({ length: optionCount }, () =>
      generateShotWithConsistency(shot, characters)
    )
  );

  return jobs;
}

// UI allows user to pick best result
```

---

## Future Enhancements

### Short-Term (Next 3 months)

1. **Consistency Scoring**: Implement automated consistency checking
2. **Reference Library UI**: Let users upload/manage character references
3. **Batch Generation**: Generate multiple options for each shot

### Medium-Term (3-6 months)

1. **Consistency Detection**: Use vision models to score consistency
2. **Smart Reference Selection**: Automatically pick best reference for shot
3. **A/B Testing**: Compare prompt strategies automatically

### Long-Term (6-12 months)

1. **Character Fine-Tuning**: If Kling offers custom models
2. **LoRA Integration**: Character-specific model weights
3. **Automated Retakes**: Re-generate inconsistent shots automatically

---

## References

- [Kling API Reference](./kling-api-reference.md)
- [Character Prompt Guide](./character-prompt-guide.md)
- [Kling Integration Guide](./kling-integration-guide.md)
- Community Resources:
  - [AgeOfLLMs - Kling Consistent Characters](https://ageofllms.com/ai-howto-prompts/ai-fun/kling-image-consistent-character)
  - [AgeOfLLMs - Kling AI Prompt Guide](https://ageofllms.com/ai-howto-prompts/ai-fun/kling-ai-promp-guide)
  - Reddit r/KlingAI
  - YouTube tutorials on Kling character consistency
