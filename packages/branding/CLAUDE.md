# Branding Configuration Guide for AI Agents

## Your Role

When a developer describes their app, you should suggest appropriate branding based on:
- App category (fintech, SaaS, e-commerce, healthcare, education, social)
- Target audience (B2B, B2C, enterprise, consumer)
- Brand personality (professional, playful, minimal, bold, elegant)

This branding system uses **environment variables only** - no database, no UI configuration. The developer copies your suggested env vars to `.env.local` and gets a fully branded app instantly.

---

## Quick Reference

**Available Categories**: fintech, saas, ecommerce, healthcare, education, social
**Available Personalities**: professional, playful, minimal, bold, elegant
**Logo Types**: text, image, svg
**Icon Styles**: outline, solid

**Example Files**: See `packages/branding/examples/` for complete working examples.

---

## Color Psychology by Category

### Fintech / Financial Services

**Primary Color**: Blue (#0066cc - #2563eb range)
- **Psychology**: Trust, security, stability, reliability
- **Why**: Financial services need to convey trustworthiness and professionalism
- **Avoid**: Red (risk, danger), Yellow (caution)

**Secondary Color**: Green (#00cc66 - #10b981 range)
- **Psychology**: Growth, prosperity, positive movement
- **Why**: Represents financial growth and success

**Accent Color**: Gold/Amber (#FFD700 - #f59e0b range)
- **Psychology**: Premium, value, wealth
- **Why**: Adds premium feel without being gaudy

**Font Recommendations**:
- **Heading**: Poppins (600-800) - Modern yet professional
- **Body**: Inter (400-600) - Highly readable for financial data
- **Alternative**: Roboto, Open Sans

**Icon Style**: Outline (stroke-width: 2) - Professional, clean

**Example Apps**: Banking apps, investment platforms, budgeting tools

---

### SaaS / Productivity Tools

**Primary Color**: Purple/Indigo (#6366f1 - #8b5cf6 range)
- **Psychology**: Innovation, creativity, forward-thinking
- **Why**: Differentiates from traditional business software

**Secondary Color**: Cyan/Teal (#06b6d4 - #14b8a6 range)
- **Psychology**: Technology, efficiency, modern
- **Why**: Conveys cutting-edge technology

**Accent Color**: Orange (#f97316 - #fb923c range)
- **Psychology**: Energy, action, call-to-action
- **Why**: Great for CTA buttons and important actions

**Font Recommendations**:
- **Heading**: Quicksand (600-700) OR Poppins (600-700) - Friendly yet professional
- **Body**: Inter (400-600) - Clean, modern
- **Alternative**: DM Sans, Nunito

**Icon Style**: Outline (stroke-width: 2) - Modern, clean

**Example Apps**: Project management, team collaboration, productivity tools

---

### E-commerce / Retail

**Primary Color**: Red (#dc2626 - #ef4444 range)
- **Psychology**: Urgency, excitement, attention
- **Why**: Encourages action and purchases

**Secondary Color**: Teal (#14b8a6 - #06b6d4 range)
- **Psychology**: Trust, quality, balanced with urgency
- **Why**: Balances the aggressive primary color

**Accent Color**: Yellow/Amber (#fbbf24 - #facc15 range)
- **Psychology**: Attention, value, deals
- **Why**: Perfect for highlighting sales and deals

**Font Recommendations**:
- **Heading**: Montserrat (700-900) - Bold, impactful
- **Body**: Inter (400-600) OR Open Sans (400-600) - Clean for product descriptions
- **Alternative**: Raleway, Roboto

**Icon Style**: Solid (or outline with stroke-width: 2.5) - Friendly, consumer-oriented

**Example Apps**: Online stores, marketplaces, retail platforms

---

### Healthcare / Wellness

**Primary Color**: Cyan/Blue-Green (#0891b2 - #06b6d4 range)
- **Psychology**: Health, calm, vitality, cleanliness
- **Why**: Evokes feelings of health and well-being

**Secondary Color**: Green (#10b981 - #22c55e range)
- **Psychology**: Healing, nature, growth
- **Why**: Universal symbol of health

**Accent Color**: Purple (#8b5cf6 - #a78bfa range)
- **Psychology**: Care, compassion, holistic
- **Why**: Adds warmth without being clinical

**Font Recommendations**:
- **Heading**: Nunito (700-800) - Soft, approachable
- **Body**: Inter (400-600) - Clear for health information
- **Alternative**: Quicksand, Source Sans Pro

**Icon Style**: Outline (stroke-width: 2) - Approachable, non-threatening

**Example Apps**: Fitness tracking, telemedicine, wellness apps, health records

---

### Education / Learning Platforms

**Primary Color**: Indigo (#4f46e5 - #6366f1 range)
- **Psychology**: Knowledge, wisdom, intelligence
- **Why**: Associated with learning and academia

**Secondary Color**: Amber/Yellow (#f59e0b - #fbbf24 range)
- **Psychology**: Energy, curiosity, enlightenment
- **Why**: Represents the spark of learning

**Accent Color**: Pink (#ec4899 - #f472b6 range)
- **Psychology**: Creativity, engagement, fun
- **Why**: Makes learning feel exciting

**Font Recommendations**:
- **Heading**: Quicksand (600-700) - Friendly, inviting
- **Body**: Inter (400-600) - Readable for educational content
- **Alternative**: Nunito, Poppins

**Icon Style**: Outline (stroke-width: 2) - Educational, clear

**Example Apps**: Online courses, e-learning platforms, educational tools

---

### Social Media / Networking

**Primary Color**: Pink (#ec4899 - #f472b6 range)
- **Psychology**: Connection, warmth, social interaction
- **Why**: Evokes feelings of human connection

**Secondary Color**: Purple (#8b5cf6 - #a855f7 range)
- **Psychology**: Creativity, expression, individuality
- **Why**: Supports self-expression

**Accent Color**: Cyan (#06b6d4 - #22d3ee range)
- **Psychology**: Communication, interaction, engagement
- **Why**: Represents digital communication

**Font Recommendations**:
- **Heading**: Nunito (700-800) - Friendly, social
- **Body**: Inter (400-600) - Readable for messages
- **Alternative**: Quicksand, Poppins

**Icon Style**: Solid (or outline with stroke-width: 2) - Friendly, approachable

**Example Apps**: Social networks, community platforms, messaging apps

---

## Font Pairing Guidelines

### Professional / Corporate

**Best Pairings**:
1. **Inter + Inter** - Ultra-clean, minimalist
2. **Poppins + Inter** - Modern with personality
3. **Roboto + Roboto** - Google-standard, reliable

**Weights**:
- Heading: 600, 700, 800
- Body: 400, 500, 600

**When to use**: Fintech, B2B SaaS, enterprise software

---

### Playful / Creative

**Best Pairings**:
1. **Quicksand + Inter** - Friendly headings, readable body
2. **Nunito + Inter** - Soft, approachable
3. **Poppins + Inter** - Balanced playfulness

**Weights**:
- Heading: 600, 700
- Body: 400, 500, 600

**When to use**: SaaS tools, education, healthcare, social

---

### Elegant / Luxury

**Best Pairings**:
1. **Playfair Display + Inter** - Serif elegance with modern body
2. **Cormorant + Lora** - Classic, sophisticated
3. **Merriweather + Inter** - Refined yet approachable

**Weights**:
- Heading: 600, 700
- Body: 400, 500

**When to use**: Premium products, luxury e-commerce, high-end services

---

### Bold / Impactful

**Best Pairings**:
1. **Montserrat + Inter** - Strong headings, clean body
2. **Raleway + Open Sans** - Bold but balanced
3. **Poppins + Inter** - Modern and confident

**Weights**:
- Heading: 700, 800, 900
- Body: 400, 500, 600

**When to use**: E-commerce, consumer products, competitive markets

---

### Minimal / Modern

**Best Pairings**:
1. **Inter + Inter** - Ultimate minimalism
2. **DM Sans + DM Sans** - Clean, geometric
3. **Poppins + Poppins** - Subtle variation with weights

**Weights**:
- Heading: 600, 700
- Body: 400, 500

**When to use**: Minimalist products, tech startups, design tools

---

## Logo Type Recommendations

### Text-based Logos

**When to use**:
- Startup with distinctive/memorable name (< 10 characters)
- Professional services (consulting, legal, financial)
- Name is the brand (like "Stripe", "Notion", "Linear")
- Want flexibility (easy to update colors, fonts)

**Best practices**:
- Keep text short (1-10 characters ideal)
- Choose distinctive font that matches personality
- Add subtle emoji/icon for memorability (optional)
- Ensure good contrast in both light/dark modes

**Example**:
```bash
NEXT_PUBLIC_LOGO_TYPE=text
NEXT_PUBLIC_LOGO_TEXT="Notion"
NEXT_PUBLIC_LOGO_FONT="Inter"
NEXT_PUBLIC_LOGO_FONT_WEIGHT=700
```

---

### Image-based Logos

**When to use**:
- Established brand with existing logo
- Complex visual identity
- Consumer-focused products needing instant recognition
- Have professional logo design files

**Best practices**:
- Provide both light and dark mode variants
- Use SVG format for scalability
- Optimize file size
- Ensure legibility at small sizes

**Example**:
```bash
NEXT_PUBLIC_LOGO_TYPE=image
NEXT_PUBLIC_LOGO_IMAGE_URL=/assets/logo.svg
NEXT_PUBLIC_LOGO_IMAGE_DARK_URL=/assets/logo-dark.svg
NEXT_PUBLIC_LOGO_WIDTH=120
NEXT_PUBLIC_LOGO_HEIGHT=40
```

---

### Hybrid (Text + Icon)

**When to use**:
- SaaS products needing quick recognition
- Short, meaningful names (< 15 characters)
- Want balance between professional and memorable
- Name benefits from visual reinforcement

**Best practices**:
- Choose emoji/icon that reinforces brand meaning
- Keep icon simple (1-2 emoji characters)
- Ensure icon doesn't overwhelm text
- Test readability without icon

**Example**:
```bash
NEXT_PUBLIC_LOGO_TYPE=text
NEXT_PUBLIC_LOGO_TEXT="LaunchPad"
NEXT_PUBLIC_LOGO_FONT="Poppins"
NEXT_PUBLIC_LOGO_FONT_WEIGHT=700
NEXT_PUBLIC_LOGO_ICON="🚀"
```

---

## Response Template

When a developer describes their app, respond in this exact format:

```bash
# Suggested Branding for [App Name]
# Category: [detected category]
# Personality: [suggested personality]
# Target Audience: [B2B/B2C/etc]

# Logo Configuration
NEXT_PUBLIC_LOGO_TYPE=[text|image|svg]
NEXT_PUBLIC_LOGO_TEXT="[App Name]"
NEXT_PUBLIC_LOGO_FONT="[Font Name]"
NEXT_PUBLIC_LOGO_FONT_WEIGHT=[weight]
NEXT_PUBLIC_LOGO_TEXT_COLOR_LIGHT=#[hex color]
NEXT_PUBLIC_LOGO_TEXT_COLOR_DARK=#[hex color]
NEXT_PUBLIC_LOGO_ICON="[emoji]"  # Optional

# Brand Colors
# [Explain color psychology reasoning]
NEXT_PUBLIC_BRAND_PRIMARY=#[hex color]
NEXT_PUBLIC_BRAND_PRIMARY_DARK=#[hex color]  # Auto-generated if omitted
NEXT_PUBLIC_BRAND_SECONDARY=#[hex color]
NEXT_PUBLIC_BRAND_ACCENT=#[hex color]

# Typography
# [Explain font choice reasoning]
NEXT_PUBLIC_FONT_HEADING=[Font Name]
NEXT_PUBLIC_FONT_HEADING_WEIGHTS=[weights]
NEXT_PUBLIC_FONT_BODY=[Font Name]
NEXT_PUBLIC_FONT_BODY_WEIGHTS=[weights]

# Icon Style
NEXT_PUBLIC_ICON_STYLE=[outline|solid]
NEXT_PUBLIC_ICON_STROKE_WIDTH=[1-3]

# Metadata
NEXT_PUBLIC_BRAND_PERSONALITY=[personality]
NEXT_PUBLIC_APP_CATEGORY=[category]
```

**Then add**:

**Reasoning**: [2-3 sentences explaining why these choices fit the app description, target audience, and category]

---

## Complete Examples

### Example 1: Fintech App

**User**: "I'm building a personal finance app for millennials to track spending and savings"

**Response**:
```bash
# Suggested Branding for MoneyFlow
# Category: fintech
# Personality: professional with friendly touch
# Target Audience: Millennials (B2C)

# Logo Configuration
NEXT_PUBLIC_LOGO_TYPE=text
NEXT_PUBLIC_LOGO_TEXT="MoneyFlow"
NEXT_PUBLIC_LOGO_FONT="Poppins"
NEXT_PUBLIC_LOGO_FONT_WEIGHT=700
NEXT_PUBLIC_LOGO_TEXT_COLOR_LIGHT=#0066cc
NEXT_PUBLIC_LOGO_TEXT_COLOR_DARK=#4da6ff
NEXT_PUBLIC_LOGO_ICON="💰"

# Brand Colors
NEXT_PUBLIC_BRAND_PRIMARY=#0066cc
NEXT_PUBLIC_BRAND_PRIMARY_DARK=#0052a3
NEXT_PUBLIC_BRAND_SECONDARY=#00cc66
NEXT_PUBLIC_BRAND_ACCENT=#fbbf24

# Typography
NEXT_PUBLIC_FONT_HEADING=Poppins
NEXT_PUBLIC_FONT_HEADING_WEIGHTS=600,700,800
NEXT_PUBLIC_FONT_BODY=Inter
NEXT_PUBLIC_FONT_BODY_WEIGHTS=400,500,600

# Icon Style
NEXT_PUBLIC_ICON_STYLE=outline
NEXT_PUBLIC_ICON_STROKE_WIDTH=2

# Metadata
NEXT_PUBLIC_BRAND_PERSONALITY=professional
NEXT_PUBLIC_APP_CATEGORY=fintech
```

**Reasoning**: Blue primary conveys trust and financial stability crucial for finance apps. Poppins headings are modern yet professional, appealing to millennials. Green secondary represents growth and savings. Gold accent highlights value and achievements. Outline icons keep it approachable rather than corporate.

---

### Example 2: Creative SaaS Tool

**User**: "Building a project management tool for creative teams and designers"

**Response**:
```bash
# Suggested Branding for DesignFlow
# Category: saas
# Personality: playful and creative
# Target Audience: Creative professionals (B2B)

# Logo Configuration
NEXT_PUBLIC_LOGO_TYPE=text
NEXT_PUBLIC_LOGO_TEXT="DesignFlow"
NEXT_PUBLIC_LOGO_FONT="Quicksand"
NEXT_PUBLIC_LOGO_FONT_WEIGHT=700
NEXT_PUBLIC_LOGO_TEXT_COLOR_LIGHT=#6366f1
NEXT_PUBLIC_LOGO_TEXT_COLOR_DARK=#a5b4fc
NEXT_PUBLIC_LOGO_ICON="✨"

# Brand Colors
NEXT_PUBLIC_BRAND_PRIMARY=#6366f1
NEXT_PUBLIC_BRAND_PRIMARY_DARK=#4f46e5
NEXT_PUBLIC_BRAND_SECONDARY=#ec4899
NEXT_PUBLIC_BRAND_ACCENT=#f59e0b

# Typography
NEXT_PUBLIC_FONT_HEADING=Quicksand
NEXT_PUBLIC_FONT_HEADING_WEIGHTS=600,700
NEXT_PUBLIC_FONT_BODY=Inter
NEXT_PUBLIC_FONT_BODY_WEIGHTS=400,500,600

# Icon Style
NEXT_PUBLIC_ICON_STYLE=outline
NEXT_PUBLIC_ICON_STROKE_WIDTH=2

# Metadata
NEXT_PUBLIC_BRAND_PERSONALITY=playful
NEXT_PUBLIC_APP_CATEGORY=saas
```

**Reasoning**: Purple suggests creativity and innovation perfect for design tools. Quicksand is friendly and approachable for creative teams without sacrificing professionalism. Pink secondary adds creative energy. Sparkle emoji reinforces creative identity. Amber accent provides energetic call-to-actions.

---

## Tips for Effective Suggestions

1. **Ask clarifying questions** if category is ambiguous
2. **Consider target audience age** - younger = more playful, older = more professional
3. **Check app name length** - short names work great as text logos
4. **Match personality to industry norms** - finance should be more conservative
5. **Explain your reasoning** - developers appreciate understanding the "why"
6. **Use color psychology** - reference the category sections above
7. **Test contrast** - ensure colors work in both light and dark modes
8. **Keep it simple** - don't over-complicate with too many accent colors

---

## Common Mistakes to Avoid

❌ **Don't**: Suggest red for healthcare (evokes danger, blood)
✅ **Do**: Use calming blues and greens

❌ **Don't**: Use serif fonts for tech/SaaS products
✅ **Do**: Stick with modern sans-serif fonts

❌ **Don't**: Suggest playful colors for fintech
✅ **Do**: Stick with trustworthy blues and professional tones

❌ **Don't**: Make logo text too long (> 15 characters)
✅ **Do**: Suggest abbreviation or acronym if name is long

❌ **Don't**: Use too many different fonts
✅ **Do**: Maximum 2 fonts (heading + body, can be same font)

❌ **Don't**: Ignore dark mode considerations
✅ **Do**: Ensure colors work in both modes

---

## Advanced Customization

### When Developer Has Specific Requests

If developer says: "I want a green color scheme"
- Respect their preference
- Suggest appropriate shade for their category
- Explain what the green conveys (growth, nature, etc.)
- Provide complementary secondary/accent colors

### When App Doesn't Fit Standard Categories

If app is unique/hybrid:
- Identify closest category or dominant aspect
- Mix color psychology from multiple categories if appropriate
- Explain the custom approach in reasoning

### When Brand Already Exists

If developer has existing brand colors/fonts:
- Ask them to provide existing hex colors
- Offer to suggest complementary additions
- Focus on helping them implement existing brand in env vars

---

## Success Metrics

A good branding suggestion should:
- ✅ Be copy-paste ready (valid hex colors, supported fonts)
- ✅ Include clear reasoning (developer understands the "why")
- ✅ Match app category psychology
- ✅ Work in both light and dark modes
- ✅ Be accessible (good contrast ratios)
- ✅ Feel appropriate for target audience

---

## Reference: Supported Fonts

Always suggest from this list (pre-configured):
- Inter (versatile, professional)
- Poppins (modern, friendly)
- Montserrat (bold, impactful)
- Quicksand (playful, rounded)
- Nunito (soft, approachable)
- Playfair Display (elegant, serif)
- Lora (elegant, readable serif)
- DM Sans (minimal, geometric)
- Open Sans (friendly, neutral)
- Raleway (elegant, sophisticated)
- Roboto (modern, Google-standard)
- Source Sans Pro (professional, Adobe)
- Merriweather (traditional, readable)
- Cormorant (elegant, classic)
- JetBrains Mono (monospace, code)

If developer requests unsupported font, suggest closest alternative from list.

---

## Need Help?

See `packages/branding/examples/` for complete working examples of each category.
