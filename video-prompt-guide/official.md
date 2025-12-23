Below is the converted **Markdown document**, normalized and cleaned from the provided PDF. Structure, headings, lists, and code-style prompts are preserved. Non-essential UI chrome and repeated headers/footers were removed.

Source: 

---

# The Ultimate Prompting Guide for Veo 3.1

**Category:** AI & Machine Learning
**Published:** October 16, 2025
**Authors:**

* Khulan Davaajav — Global AI Content Manager
* Hussain Chinoy — Gen AI Technical Solutions Manager

> If a picture is worth a thousand words, a video is worth a million.

---

## Overview

Veo 3.1 is Google Cloud’s state-of-the-art video generation model, now generally available on Vertex AI. It introduces professional-grade creative controls, multiple aspect ratios, and rich synchronized audio.

Customers report measurable impact, including significant uplifts in retention and production efficiency.

---

## What You’ll Learn

* Full capabilities of Veo 3.1 on Vertex AI
* A repeatable formula for consistent characters and styles
* Professional cinematic control over video and sound
* Advanced workflows combining Veo 3.1 with Gemini 2.5 Flash Image (Nano Banana)

---

## Veo 3.1 Model Capabilities

### Core Generation Features

* **Video quality:** 720p or 1080p
* **Aspect ratios:** 16:9, 9:16
* **Clip length:** 4s, 6s, or 8s
* **Rich audio & dialogue:**

  * Multi-person conversations
  * Precisely timed sound effects
* **Scene comprehension:**

  * Narrative structure
  * Cinematic styles
  * Character interaction

### Advanced Creative Controls

* **Image-to-video:** Higher prompt adherence and audiovisual fidelity
* **Ingredients to Video:**

  * Reference images for characters, objects, scenes, styles
  * Consistent visuals across shots
  * Includes audio generation
* **First and Last Frame:**

  * Natural transitions between two images
  * Includes audio
* **Add / Remove Object:**

  * Modify generated scenes while preserving composition
  * Uses Veo 2 (no audio)

### Safety

* **Digital watermarking:** All videos include SynthID markers

---

## A Formula for Effective Prompts

Use a structured, five-part prompt:

```
[Cinematography] + [Subject] + [Action] + [Context] + [Style & Ambiance]
```

### Breakdown

* **Cinematography:** Camera work and composition
* **Subject:** Main character or focal point
* **Action:** What the subject is doing
* **Context:** Environment and background
* **Style & Ambiance:** Mood, lighting, aesthetic

### Example

```
Medium shot, a tired corporate worker, rubbing his temples in exhaustion,
in front of a bulky 1980s computer in a cluttered office late at night.
Harsh fluorescent overhead lights and green monochrome monitor glow.
Retro aesthetic, 1980s color film, slightly grainy.
```

---

## Essential Prompting Techniques

### Cinematography Language

#### Camera Movement

* Dolly shot
* Tracking shot
* Crane shot
* Aerial view
* Slow pan
* POV shot

**Example:**

```
Crane shot starting low on a lone hiker and ascending high above,
revealing a colossal mist-filled canyon at sunrise.
Epic fantasy style, awe-inspiring, soft morning light.
```

#### Composition

* Wide shot
* Close-up
* Extreme close-up
* Low angle
* Two-shot

#### Lens & Focus

* Shallow depth of field
* Wide-angle lens
* Macro lens
* Soft focus
* Deep focus

**Example:**

```
Close-up with very shallow depth of field, a young woman looking out
a bus window at passing city lights during a rainstorm.
Melancholic mood, cool blue tones, cinematic.
```

---

## Directing the Soundstage

Veo 3.1 can generate full soundtracks from text.

* **Dialogue:** Use quotation marks

  ```
  A woman says, "We have to leave now."
  ```
* **Sound Effects (SFX):**

  ```
  SFX: Thunder cracks in the distance.
  ```
* **Ambient Noise:**

  ```
  Ambient noise: quiet hum of a starship bridge.
  ```

---

## Negative Prompting

Specify exclusions clearly:

**Preferred:**

```
A desolate landscape with no buildings or roads.
```

**Avoid:**

```
No man-made structures.
```

---

## Prompt Enhancement with Gemini

Use Gemini to expand simple prompts into richer, cinematic descriptions before passing them to Veo.

---

## Advanced Creative Workflows

### Workflow 1: First and Last Frame Transition

**Goal:** Controlled camera movement between two images.

**Steps:**

1. **Create starting frame** (Gemini 2.5 Flash Image)
2. **Create ending frame** (different POV)
3. **Animate with Veo**

**Veo Prompt Example:**

```
The camera performs a smooth 180-degree arc shot, starting with a
front-facing view of the singer and circling to a POV shot from behind.
The singer sings, "When you look me in the eyes, I can see a million stars."
```

---

### Workflow 2: Ingredients to Video (Dialogue Scenes)

**Goal:** Multi-shot dialogue with consistent characters.

**Step 1:** Generate reference images
**Step 2:** Compose shots using Ingredients to Video

**Example Prompt:**

```
Using the provided images for the detective, woman, and office,
create a medium shot of the detective behind his desk.
He looks up and says in a weary voice,
"Of all the offices in this town, you had to walk into mine."
```

---

### Workflow 3: Timestamp Prompting

**Goal:** Full multi-shot sequence in one generation.

**Example:**

```
[00:00–00:02] Medium shot from behind a young female explorer pushing
aside jungle vines to reveal a hidden path.

[00:02–00:04] Reverse shot of her freckled face in awe.
SFX: rustling leaves, distant bird calls.

[00:04–00:06] Tracking shot as she runs her hand over ancient carvings.
Emotion: wonder and reverence.

[00:06–00:08] Wide high-angle crane shot revealing the vast jungle temple.
SFX: gentle orchestral score begins.
```

---

## Availability

* Veo 3.1 is available in preview via the Vertex AI API
* Suitable for developers and enterprise production workflows

---

## Acknowledgements

Thanks to:

* Anish Nangia
* Sabareesh Chinta
* Wafae Bakkali

For contributions to prompting guidance.

---

If you want this exported as a `.md` file or split into sections, say so.
