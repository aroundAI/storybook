Below is a clean Markdown conversion of the document content, preserving structure and meaning while omitting UI chrome, timestamps, and media players. Source: uploaded PDF 

---

# How to Prompt Veo 3.1

*Posted October 16, 2025 by shridharathi*
Replicate Blog

Google released **Veo 3.1**, introducing new tools for video generation, including **reference images** and **first/last frame input**. This guide explains how to prompt the model effectively and highlights its new capabilities.

---

## General Prompting Guidelines

* **Shot composition**
  Specify framing and number of subjects
  Examples: *single shot*, *two shot*, *over-the-shoulder shot*

* **Focus and lens effects**
  Examples: *shallow focus*, *deep focus*, *soft focus*, *macro lens*, *wide-angle lens*

* **Overall style and subject**
  Examples: *sci-fi*, *romantic comedy*, *action movie*, *animation*

* **Camera positioning and movement**
  Examples: *eye level*, *high angle*, *worm’s eye*, *dolly shot*, *zoom shot*, *pan shot*, *tracking shot*

---

## Reference to Video

The most significant new feature in Veo 3.1.

* Accepts **up to three reference images**
* Combines them into a **single coherent video**
* Guided by the text prompt
* Preserves **character and object consistency**

### Key Benefit

Character consistency across different scenes and environments, enabling strong narrative control and brand storytelling.

---

## Example: Content Creator + Shampoo

Using:

* Reference image: content creator
* Reference image: shampoo bottle

Result:

* UGC-style review video
* Character and product identity preserved
* Fluid, realistic motion

---

## First and Last Frame to Video

Extends image-to-video by defining **both start and end frames**.

* Model interpolates motion between frames
* Text prompt guides the transformation
* Enables precise narrative arcs

### Example

* **First frame:** Lamb
* **Last frame:** Tiger
* Result: smooth morphing transformation

---

## Transformation Sequences

First/last frame interpolation enables transformations that are difficult with traditional video generation.

Example use case:

* Interior design room transformation
  *Before → After*

---

## Enhanced Image to Video

Classic image-to-video improved in Veo 3.1.

### How It Works

* Provide:

  * One starting image
  * A text prompt describing motion or action
* Model:

  * Understands image content
  * Generates natural, purposeful motion
  * Reasons contextually from the image

---

## Fast Generation Options

Available for all endpoints **except reference to video**.

* **Speed:** < 60 seconds (vs ~90 seconds standard)
* **Cost:** ~50% of standard
* **Quality:** Slightly reduced, still high

Use **Veo 3.1 Fast** for cheaper and faster outputs.

---

## Getting Started with the API

### Basic Image to Video

```javascript
import Replicate from "replicate";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const output = await replicate.run(
  "google/veo-3.1",
  {
    input: {
      image: "https://example.com/your-image.jpg",
      prompt: "A cinematic shot of the character walking through a bustling city",
      duration: 8,
      resolution: "1080p"
    }
  }
);

console.log(output);
```

---

### Reference to Video (Multiple Images)

```javascript
const output = await replicate.run(
  "google/veo-3.1",
  {
    input: {
      reference_images: [
        "https://example.com/character.jpg",
        "https://example.com/product.jpg",
        "https://example.com/background.jpg"
      ],
      prompt: "Create a product review video with the character showcasing the product",
      duration: 8,
      resolution: "1080p",
      generate_audio: false
    }
  }
);
```

---

### First and Last Frame

```javascript
const output = await replicate.run(
  "google/veo-3.1",
  {
    input: {
      first_frame: "https://example.com/start-image.jpg",
      last_frame: "https://example.com/end-image.jpg",
      prompt: "A smooth transformation sequence",
      duration: 8,
      resolution: "1080p"
    }
  }
);
```

---

## Output

* API returns a **video URL**
* Suitable for integration into generative video applications

**Veo 3.1** provides strong controllability and high-quality results for production use.

---

If you want this split into multiple Markdown files, front-matter added, or images reinserted as placeholders, say so.
