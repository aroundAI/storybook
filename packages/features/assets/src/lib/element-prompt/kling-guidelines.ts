/**
 * Kling AI Guidelines (FILM-209)
 * Best practices for generating element prompts
 */

export const KLING_GUIDELINES = `
KLING AI ELEMENT PROMPT BEST PRACTICES:

1. Length: 50-200 words (2-3 sentences ideal)

2. Focus on Visual Appearance:
   - Age, gender, ethnicity
   - Body type and build
   - Hair color, style, length
   - Eye color
   - Skin tone
   - Distinctive features (scars, tattoos, glasses, piercings)
   - Clothing style and colors
   - Accessories

3. Language Style:
   - Use present tense
   - Use third person (he, she, they)
   - Use objective, neutral descriptions
   - Avoid subjective adjectives (beautiful, handsome, ugly)
   - Avoid personality traits (brave, intelligent, kind)

4. Specificity:
   - Be specific about colors (not "dark hair", use "black hair")
   - Mention exact styles (not "stylish", use "tailored suit")
   - Include measurable attributes (age, height ranges)

5. Consistency Keywords:
   - Use words that help maintain consistency across shots
   - "always wears", "distinctive", "signature"
   - Emphasize unique identifiers

GOOD EXAMPLE:
"A 32-year-old Caucasian man with an athletic build and fair skin. He has short, brown hair styled in a crew cut, blue eyes, and a square jawline. He wears a black leather jacket over a white t-shirt, dark jeans, and brown boots. A small scar runs through his left eyebrow, and he always wears a silver watch on his right wrist."

BAD EXAMPLE:
"A handsome young man who is very intelligent and brave. He has a great sense of style and was known for his charm. You can see confidence in his eyes."
`;

/**
 * Subjective words to avoid in element prompts
 */
export const SUBJECTIVE_WORDS = [
  'beautiful',
  'handsome',
  'ugly',
  'pretty',
  'gorgeous',
  'attractive',
  'unattractive',
  'cute',
  'stunning',
  'lovely',
];

/**
 * Personality trait words to exclude (not visual)
 */
export const PERSONALITY_WORDS = [
  'brave',
  'intelligent',
  'kind',
  'mean',
  'smart',
  'clever',
  'wise',
  'foolish',
  'confident',
  'shy',
  'timid',
  'bold',
];
