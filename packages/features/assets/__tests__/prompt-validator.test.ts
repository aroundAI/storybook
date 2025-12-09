/**
 * Prompt Validator Tests (FILM-209)
 */
import { describe, expect, it } from 'vitest';

import { validateElementPrompt } from '../src/lib/element-prompt/prompt-validator';

describe('validateElementPrompt', () => {
  describe('word count validation', () => {
    it('should reject prompts that are too short (< 50 words)', () => {
      const shortPrompt = 'A young woman with brown hair and blue eyes.';
      const result = validateElementPrompt(shortPrompt);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.stringContaining('too short'),
      );
    });

    it('should reject prompts that are too long (> 200 words)', () => {
      const longPrompt = Array(250).fill('word').join(' ');
      const result = validateElementPrompt(longPrompt);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('too long'));
    });

    it('should accept prompts within valid range (50-200 words)', () => {
      const validPrompt = `A 32-year-old Caucasian man with an athletic build and fair skin. He has short, brown hair styled in a crew cut, blue eyes, and a square jawline. He wears a black leather jacket over a white t-shirt, dark jeans, and brown boots. A small scar runs through his left eyebrow, and he always wears a silver watch on his right wrist. His posture is straight and confident. He typically carries a worn leather messenger bag over one shoulder.`;
      const result = validateElementPrompt(validPrompt);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.wordCount).toBeGreaterThanOrEqual(50);
      expect(result.wordCount).toBeLessThanOrEqual(200);
    });

    it('should correctly count words', () => {
      const prompt = 'one two three four five';
      const result = validateElementPrompt(prompt);
      expect(result.wordCount).toBe(5);
    });
  });

  describe('subjective language detection', () => {
    it('should warn about subjective words like "beautiful"', () => {
      const prompt = `A beautiful 25-year-old woman with flowing blonde hair and sparkling blue eyes. She has a slim build with fair skin. She wears elegant designer dresses and high heels. Her makeup is always impeccable with red lipstick and perfectly shaped eyebrows. She carries a vintage handbag and wears pearl earrings. Her nails are always manicured.`;
      const result = validateElementPrompt(prompt);

      expect(result.warnings).toContainEqual(
        expect.stringContaining('beautiful'),
      );
    });

    it('should warn about subjective words like "handsome"', () => {
      const prompt = `A handsome 30-year-old man with dark hair and green eyes. He has a muscular build with tan skin. He wears fitted suits and leather shoes. His beard is well-groomed and his hair is always styled perfectly. He has a confident stance and broad shoulders. He wears an expensive watch and gold cufflinks.`;
      const result = validateElementPrompt(prompt);

      expect(result.warnings).toContainEqual(
        expect.stringContaining('handsome'),
      );
    });

    it('should warn about multiple subjective words', () => {
      const prompt = `A pretty and gorgeous 28-year-old woman with stunning features. She has an attractive face with lovely brown eyes. Her hair is beautiful and flows naturally. She wears cute outfits that complement her figure. She has a warm smile and graceful movements. Her style is elegant and sophisticated with attention to detail.`;
      const result = validateElementPrompt(prompt);

      const subjectiveWarnings = result.warnings.filter((w) =>
        w.includes('subjective'),
      );
      expect(subjectiveWarnings.length).toBeGreaterThan(0);
      expect(result.warnings.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('personality trait detection', () => {
    it('should warn about personality words like "brave"', () => {
      const prompt = `A brave 35-year-old man with dark hair and determined eyes. He has a strong build and weathered skin from years of outdoor work. He wears rugged clothing suitable for adventure. His face shows signs of past battles with small scars. He carries survival gear and always seems prepared for anything. His boots are worn but sturdy.`;
      const result = validateElementPrompt(prompt);

      expect(result.warnings).toContainEqual(expect.stringContaining('brave'));
    });

    it('should warn about personality words like "intelligent"', () => {
      const prompt = `An intelligent 40-year-old professor with graying hair at the temples. She wears reading glasses and professional attire. Her eyes are sharp and observant behind thin-framed spectacles. She carries a leather briefcase filled with papers. Her clothing is practical but well-made. She has a thoughtful expression and calm demeanor.`;
      const result = validateElementPrompt(prompt);

      expect(result.warnings).toContainEqual(
        expect.stringContaining('intelligent'),
      );
    });

    it('should use word boundaries to avoid false positives', () => {
      // "kindred" should not trigger warning for "kind"
      const prompt = `A 30-year-old woman with kindred spirit appearance and flowing red hair. She has pale skin and freckles across her nose. Her green eyes are bright and expressive. She wears bohemian-style clothing with layered skirts and loose blouses. She adorns herself with silver jewelry including multiple rings and bracelets. Her bare feet suggest a connection to nature.`;
      const result = validateElementPrompt(prompt);

      const kindWarnings = result.warnings.filter((w) => w.includes('"kind"'));
      expect(kindWarnings).toHaveLength(0);
    });
  });

  describe('tense detection', () => {
    it('should warn about past tense (was)', () => {
      const prompt = `A 45-year-old man who was once a soldier. He has gray hair and tired eyes. His face was weathered by years of combat. He wears casual civilian clothes now. He has a slight limp from an old injury. His posture was once military-straight but now relaxed. He carries himself with quiet dignity and wisdom from experience.`;
      const result = validateElementPrompt(prompt);

      expect(result.warnings).toContainEqual(
        expect.stringContaining('past tense'),
      );
    });

    it('should warn about past tense (were)', () => {
      const prompt = `A 28-year-old twin whose features were identical to her sister. She has blonde hair in a pixie cut. Her eyes were a striking shade of violet. She wears punk-style clothing with leather and chains. Her arms have sleeve tattoos of flowers and skulls. She has multiple ear piercings and a nose ring.`;
      const result = validateElementPrompt(prompt);

      expect(result.warnings).toContainEqual(
        expect.stringContaining('past tense'),
      );
    });

    it('should warn about past tense (had)', () => {
      const prompt = `A 50-year-old woman who had seen better days. She has silver hair in a simple bun. Her face shows deep wrinkles from years of smiling. She wears simple cotton dresses and comfortable shoes. She had a birthmark on her left cheek that is still visible. She carries a wooden cane carved with intricate patterns.`;
      const result = validateElementPrompt(prompt);

      expect(result.warnings).toContainEqual(
        expect.stringContaining('past tense'),
      );
    });
  });

  describe('person detection', () => {
    it('should warn about first person (I, me, my)', () => {
      const prompt = `I am a 25-year-old man with brown hair and hazel eyes. My build is athletic and my skin is olive-toned. I wear casual clothes like jeans and t-shirts. My hair is usually messy and unkempt. I have a small tattoo on my forearm. Me and my style could be described as laid-back and comfortable.`;
      const result = validateElementPrompt(prompt);

      expect(result.warnings).toContainEqual(
        expect.stringContaining('first/second person'),
      );
    });

    it('should warn about second person (you, your)', () => {
      const prompt = `You see a 30-year-old woman with black hair tied in braids. Your first impression is of someone tall and confident. She has dark skin and warm brown eyes. You notice she wears traditional African prints. Her jewelry includes gold hoops and beaded necklaces. Your eyes are drawn to her colorful headwrap.`;
      const result = validateElementPrompt(prompt);

      expect(result.warnings).toContainEqual(
        expect.stringContaining('first/second person'),
      );
    });
  });

  describe('validation result structure', () => {
    it('should return correct structure for valid prompt', () => {
      const validPrompt = `A 32-year-old East Asian woman with an athletic build and tan skin. She has shoulder-length black hair styled in a practical ponytail, dark brown eyes, and high cheekbones. She wears a navy blue police uniform with a badge on her chest. A small mole sits above her right lip. She always wears sensible black boots and keeps a notepad in her pocket.`;
      const result = validateElementPrompt(validPrompt);

      expect(result).toHaveProperty('isValid');
      expect(result).toHaveProperty('wordCount');
      expect(result).toHaveProperty('warnings');
      expect(result).toHaveProperty('errors');
      expect(typeof result.isValid).toBe('boolean');
      expect(typeof result.wordCount).toBe('number');
      expect(Array.isArray(result.warnings)).toBe(true);
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it('should have isValid true only when no errors', () => {
      const validPrompt = `A 28-year-old Hispanic man with a stocky build and medium brown skin. He has curly black hair worn short, dark eyes with thick eyebrows, and a wide smile. He wears casual work clothes including flannel shirts and sturdy jeans. His hands are calloused from manual labor. He has a small cross pendant around his neck and wears a baseball cap backwards.`;
      const result = validateElementPrompt(validPrompt);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should separate errors from warnings', () => {
      const shortButProblematic = 'A beautiful brave young person.';
      const result = validateElementPrompt(shortButProblematic);

      // Should have error for being too short
      expect(result.errors.length).toBeGreaterThan(0);

      // Should have warnings for subjective/personality words
      expect(result.warnings.length).toBeGreaterThan(0);

      // Should be invalid due to errors
      expect(result.isValid).toBe(false);
    });
  });
});
