# Complete Branding Customization Guide

## Table of Contents

1. [Quick Start](#quick-start)
2. [Basic Logo Configuration](#basic-logo-configuration)
3. [Enhanced Styling Features](#enhanced-styling-features)
   - [Gradient Text Effects](#gradient-text-effects)
   - [Glow/Neon Effects](#glowneon-effects)
   - [Text Stroke/Outline](#text-strokeoutline)
   - [Custom Fonts](#custom-fonts)
   - [Animations](#animations)
4. [Complete Configuration Reference](#complete-configuration-reference)
5. [Step-by-Step Examples](#step-by-step-examples)
6. [Troubleshooting](#troubleshooting)
7. [Advanced Techniques](#advanced-techniques)

---

## Quick Start

### 1. Choose Your Logo Type

The branding system supports three logo types:

- **`text`** - Text-based logo with optional emoji icon
- **`image`** - Image file (PNG, SVG, etc.) with light/dark mode variants
- **`svg`** - Inline SVG code

For enhanced styling (gradients, glow, stroke), use `type: text`.

### 2. Create Your Branding Configuration

Add these environment variables to your `.env.local` file:

```bash
# Start with a simple text logo
NEXT_PUBLIC_LOGO_TYPE=text
NEXT_PUBLIC_LOGO_TEXT="YourApp"
NEXT_PUBLIC_LOGO_FONT="Inter"
NEXT_PUBLIC_LOGO_FONT_WEIGHT=700
```

### 3. Test Your Changes

1. Save your `.env.local` file
2. Restart your development server: `pnpm dev`
3. Visit your app and see your logo update instantly

---

## Basic Logo Configuration

### Text Logo

The simplest and most flexible option:

```bash
# Logo Type
NEXT_PUBLIC_LOGO_TYPE=text

# Logo Text (1-50 characters)
NEXT_PUBLIC_LOGO_TEXT="MyApp"

# Font (must be from supported fonts list)
NEXT_PUBLIC_LOGO_FONT="Inter"

# Font Weight (100-900)
NEXT_PUBLIC_LOGO_FONT_WEIGHT=700

# Optional: Add an emoji icon
NEXT_PUBLIC_LOGO_ICON="🚀"

# Colors (for light and dark modes)
NEXT_PUBLIC_LOGO_TEXT_COLOR_LIGHT="#1a1a1a"
NEXT_PUBLIC_LOGO_TEXT_COLOR_DARK="#ffffff"
```

**Supported Fonts:**
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

### Image Logo

For existing logo files:

```bash
NEXT_PUBLIC_LOGO_TYPE=image

# Image URLs (absolute or relative)
NEXT_PUBLIC_LOGO_IMAGE_URL="/images/logo.svg"
NEXT_PUBLIC_LOGO_IMAGE_DARK_URL="/images/logo-dark.svg"

# Dimensions in pixels
NEXT_PUBLIC_LOGO_WIDTH=120
NEXT_PUBLIC_LOGO_HEIGHT=40
```

**Best Practices:**
- Use SVG format for scalability
- Provide separate light/dark mode versions
- Optimize file size (< 50KB recommended)
- Use absolute paths or CDN URLs

### SVG Logo

For inline SVG code:

```bash
NEXT_PUBLIC_LOGO_TYPE=svg
NEXT_PUBLIC_LOGO_SVG='<svg width="100" height="40">...</svg>'
```

---

## Enhanced Styling Features

### Gradient Text Effects

Transform your text logo with beautiful gradients.

#### Method 1: Preset Gradients (Recommended)

The easiest way to add gradients:

```bash
# Enable gradient
NEXT_PUBLIC_LOGO_GRADIENT_ENABLED=true

# Choose a preset
NEXT_PUBLIC_LOGO_GRADIENT_PRESET=purple-blue

# Optional: Enable animation
NEXT_PUBLIC_LOGO_GRADIENT_ANIMATE=true
```

**Available Presets:**

| Preset | Colors | Best For |
|--------|--------|----------|
| `purple-blue` | Purple → Blue | Professional SaaS (like MakerKit) |
| `sunset` | Red → Yellow → Red | Creative, Energetic brands |
| `ocean` | Light Blue → Dark Blue | Trustworthy, Calming brands |
| `neon` | Cyan → Magenta → Cyan | Gaming, Entertainment, Bold brands |
| `forest` | Dark Green → Light Green | Natural, Growth-focused brands |
| `fire` | Red → Orange | Passionate, Action-oriented brands |

#### Method 2: Custom Colors (Simple)

Define your own 2+ color gradient:

```bash
NEXT_PUBLIC_LOGO_GRADIENT_ENABLED=true
NEXT_PUBLIC_LOGO_GRADIENT_TYPE=linear
NEXT_PUBLIC_LOGO_GRADIENT_COLORS=#667eea,#764ba2
NEXT_PUBLIC_LOGO_GRADIENT_DIRECTION=to right
```

**Direction Options:**
- `to right` (default) - Left to right
- `to left` - Right to left
- `to bottom` - Top to bottom
- `to top` - Bottom to top
- `45deg` - Diagonal (any angle)
- `to bottom right` - Corner gradients

**Examples:**

```bash
# Horizontal blue gradient
NEXT_PUBLIC_LOGO_GRADIENT_COLORS=#3b82f6,#8b5cf6

# Vertical gold gradient
NEXT_PUBLIC_LOGO_GRADIENT_COLORS=#FFD700,#FFA500
NEXT_PUBLIC_LOGO_GRADIENT_DIRECTION=to bottom

# 3-color rainbow
NEXT_PUBLIC_LOGO_GRADIENT_COLORS=#FF0000,#00FF00,#0000FF
```

#### Method 3: Advanced Color Stops

Precise control over gradient positions:

```bash
NEXT_PUBLIC_LOGO_GRADIENT_ENABLED=true
NEXT_PUBLIC_LOGO_GRADIENT_TYPE=linear
NEXT_PUBLIC_LOGO_GRADIENT_STOPS=[{"color":"#FF0000","position":0},{"color":"#FFFF00","position":50},{"color":"#FF0000","position":100}]
NEXT_PUBLIC_LOGO_GRADIENT_DIRECTION=to right
```

**Use Cases:**
- Centered color bands
- Asymmetric gradients
- Multiple color transitions
- Precise brand color matching

#### Gradient Animation

Add smooth shifting animation:

```bash
NEXT_PUBLIC_LOGO_GRADIENT_ANIMATE=true
```

**Effect:**
- Gradient smoothly shifts left to right
- 3-second loop, infinite
- GPU-accelerated (smooth on all devices)
- Subtle, professional movement

**When to Use:**
- ✅ Landing pages (first impression)
- ✅ Modern SaaS products
- ✅ Creative/design tools
- ❌ Productivity tools (too distracting)
- ❌ Enterprise apps (too playful)

---

### Glow/Neon Effects

Add glowing shadows for dramatic effects.

#### Basic Glow

```bash
NEXT_PUBLIC_LOGO_GLOW_ENABLED=true
NEXT_PUBLIC_LOGO_GLOW_COLOR=#8b5cf6
NEXT_PUBLIC_LOGO_GLOW_INTENSITY=medium
```

#### Glow Intensity Levels

| Intensity | Effect | Best For |
|-----------|--------|----------|
| `subtle` | Light shadow | Professional apps with hint of glow |
| `medium` | Moderate glow | Balanced effect, most common |
| `strong` | Pronounced glow | Dramatic effect, creative apps |
| `neon` | Intense multi-layer | Cyberpunk, gaming, nightlife |

**Examples:**

```bash
# Subtle professional glow
NEXT_PUBLIC_LOGO_GLOW_ENABLED=true
NEXT_PUBLIC_LOGO_GLOW_COLOR=#3b82f6
NEXT_PUBLIC_LOGO_GLOW_INTENSITY=subtle

# Strong creative glow
NEXT_PUBLIC_LOGO_GLOW_ENABLED=true
NEXT_PUBLIC_LOGO_GLOW_COLOR=#ec4899
NEXT_PUBLIC_LOGO_GLOW_INTENSITY=strong

# Neon cyberpunk glow
NEXT_PUBLIC_LOGO_GLOW_ENABLED=true
NEXT_PUBLIC_LOGO_GLOW_COLOR=#00F5FF
NEXT_PUBLIC_LOGO_GLOW_INTENSITY=neon
```

#### Glow Animation

Add pulsing effect:

```bash
NEXT_PUBLIC_LOGO_GLOW_ANIMATE=true
```

**Effect:**
- Glow gently pulses in and out
- 2-second loop, infinite
- Creates "breathing" effect
- Adds life to static logos

**When to Use:**
- ✅ Gaming platforms
- ✅ Entertainment apps
- ✅ Creative tools
- ✅ Night mode emphasis
- ❌ Corporate/enterprise
- ❌ Accessibility-critical apps

#### Glow Color Strategy

**Match Your Brand:**
```bash
# Use primary brand color
NEXT_PUBLIC_LOGO_GLOW_COLOR=#your-primary-color
```

**Complement Your Gradient:**
```bash
# Gradient: Blue to Purple
NEXT_PUBLIC_LOGO_GRADIENT_COLORS=#3b82f6,#8b5cf6

# Glow: Purple accent
NEXT_PUBLIC_LOGO_GLOW_COLOR=#8b5cf6
```

**Contrast Effect:**
```bash
# White/light text with colored glow
NEXT_PUBLIC_LOGO_TEXT_COLOR_LIGHT=#ffffff
NEXT_PUBLIC_LOGO_GLOW_COLOR=#FF00FF
```

---

### Text Stroke/Outline

Add bold outlines around your text.

#### Basic Stroke

```bash
NEXT_PUBLIC_LOGO_STROKE_ENABLED=true
NEXT_PUBLIC_LOGO_STROKE_WIDTH=2
NEXT_PUBLIC_LOGO_STROKE_COLOR=#000000
```

#### Stroke Width Guide

| Width | Effect | Best For |
|-------|--------|----------|
| `0.5-1` | Subtle outline | Refined, elegant brands |
| `1-2` | Moderate outline | Most common, versatile |
| `2-3` | Bold outline | Sports, fitness, streetwear |
| `3-5` | Heavy outline | Extreme impact, special effects |

**Examples:**

```bash
# Subtle refined outline
NEXT_PUBLIC_LOGO_STROKE_ENABLED=true
NEXT_PUBLIC_LOGO_STROKE_WIDTH=1
NEXT_PUBLIC_LOGO_STROKE_COLOR=#333333

# Bold sports style
NEXT_PUBLIC_LOGO_STROKE_ENABLED=true
NEXT_PUBLIC_LOGO_STROKE_WIDTH=3
NEXT_PUBLIC_LOGO_STROKE_COLOR=#000000
```

#### Stroke + Gradient Combo

Create unique effects:

```bash
# White fill with gradient + dark outline
NEXT_PUBLIC_LOGO_TEXT_COLOR_LIGHT=#ffffff
NEXT_PUBLIC_LOGO_GRADIENT_ENABLED=true
NEXT_PUBLIC_LOGO_GRADIENT_COLORS=#FF0000,#FFA500
NEXT_PUBLIC_LOGO_STROKE_ENABLED=true
NEXT_PUBLIC_LOGO_STROKE_WIDTH=2
NEXT_PUBLIC_LOGO_STROKE_COLOR=#000000
```

**Effect:** Gradient fill inside black outline - perfect for sports brands!

#### High Contrast Strategy

```bash
# Dark text on light backgrounds
NEXT_PUBLIC_LOGO_TEXT_COLOR_LIGHT=#000000
NEXT_PUBLIC_LOGO_STROKE_COLOR=#ffffff
NEXT_PUBLIC_LOGO_STROKE_WIDTH=1

# Light text on dark backgrounds
NEXT_PUBLIC_LOGO_TEXT_COLOR_DARK=#ffffff
NEXT_PUBLIC_LOGO_STROKE_COLOR=#000000
NEXT_PUBLIC_LOGO_STROKE_WIDTH=1
```

---

### Custom Fonts

Load fonts beyond Google Fonts.

#### From Google Fonts (Custom URL)

```bash
# Find your font on fonts.google.com
# Click "Select this style" → "Embed" → Copy URL

NEXT_PUBLIC_LOGO_CUSTOM_FONT_URL=https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@700&display=swap
NEXT_PUBLIC_LOGO_CUSTOM_FONT_FAMILY=Roboto Mono
```

**Important:** Family name must match exactly!

#### Self-Hosted Fonts

```bash
# Host your font file (WOFF2 recommended)
NEXT_PUBLIC_LOGO_CUSTOM_FONT_URL=/fonts/my-custom-font.woff2
NEXT_PUBLIC_LOGO_CUSTOM_FONT_FAMILY=My Custom Font
```

**Setup:**
1. Place font file in `public/fonts/`
2. Create CSS `@font-face` rule in `globals.css`
3. Use family name from `@font-face`

#### Adobe Fonts / Typekit

```bash
NEXT_PUBLIC_LOGO_CUSTOM_FONT_URL=https://use.typekit.net/abc1234.css
NEXT_PUBLIC_LOGO_CUSTOM_FONT_FAMILY=Your Adobe Font Name
```

#### Font.com / Commercial Fonts

```bash
# Get embed code from font provider
NEXT_PUBLIC_LOGO_CUSTOM_FONT_URL=https://fonts.yourprovider.com/embed.css
NEXT_PUBLIC_LOGO_CUSTOM_FONT_FAMILY=Commercial Font Name
```

**Note:** Ensure you have proper licensing for commercial use!

---

### Animations

#### Gradient Animation

```bash
NEXT_PUBLIC_LOGO_GRADIENT_ENABLED=true
NEXT_PUBLIC_LOGO_GRADIENT_PRESET=purple-blue
NEXT_PUBLIC_LOGO_GRADIENT_ANIMATE=true
```

**Performance:**
- GPU-accelerated
- No JavaScript required
- < 1% CPU usage
- Works on all devices

**Customization:**
- Duration: 3 seconds (hardcoded, modify CSS to change)
- Easing: `ease` (smooth acceleration/deceleration)
- Loop: Infinite

#### Glow Animation

```bash
NEXT_PUBLIC_LOGO_GLOW_ENABLED=true
NEXT_PUBLIC_LOGO_GLOW_COLOR=#8b5cf6
NEXT_PUBLIC_LOGO_GLOW_INTENSITY=medium
NEXT_PUBLIC_LOGO_GLOW_ANIMATE=true
```

**Performance:**
- GPU-accelerated via `filter` property
- Smooth 60 FPS on modern devices
- Minimal impact on battery

**Customization:**
- Duration: 2 seconds (hardcoded, modify CSS to change)
- Easing: `ease-in-out` (smooth breathing effect)
- Loop: Infinite

#### Combining Both Animations

```bash
# Both animations run simultaneously
NEXT_PUBLIC_LOGO_GRADIENT_ANIMATE=true
NEXT_PUBLIC_LOGO_GLOW_ANIMATE=true
```

**Effect:**
- Gradient shifts while glow pulses
- Creates premium, luxurious feel
- Best for landing pages, splash screens
- Use sparingly - high visual impact

#### Accessibility

Animations automatically respect user preferences:

```css
/* Automatically disabled for users who prefer reduced motion */
@media (prefers-reduced-motion: reduce) {
  .logo-text {
    animation: none !important;
  }
}
```

**No configuration needed** - built into the CSS!

---

## Complete Configuration Reference

### All Environment Variables

```bash
# ===================================
# LOGO BASIC CONFIGURATION
# ===================================

# Logo Type: text, image, or svg
NEXT_PUBLIC_LOGO_TYPE=text

# Text Logo Options
NEXT_PUBLIC_LOGO_TEXT="YourApp"
NEXT_PUBLIC_LOGO_FONT="Inter"
NEXT_PUBLIC_LOGO_FONT_WEIGHT=700
NEXT_PUBLIC_LOGO_ICON="🚀"
NEXT_PUBLIC_LOGO_TEXT_COLOR_LIGHT="#1a1a1a"
NEXT_PUBLIC_LOGO_TEXT_COLOR_DARK="#ffffff"

# Image Logo Options
NEXT_PUBLIC_LOGO_IMAGE_URL="/images/logo.svg"
NEXT_PUBLIC_LOGO_IMAGE_DARK_URL="/images/logo-dark.svg"
NEXT_PUBLIC_LOGO_WIDTH=120
NEXT_PUBLIC_LOGO_HEIGHT=40

# SVG Logo Options
NEXT_PUBLIC_LOGO_SVG='<svg>...</svg>'

# ===================================
# GRADIENT EFFECT
# ===================================

NEXT_PUBLIC_LOGO_GRADIENT_ENABLED=true

# Preset Mode (easiest)
NEXT_PUBLIC_LOGO_GRADIENT_PRESET=purple-blue
# Options: sunset, ocean, neon, forest, fire, purple-blue

# OR Custom Colors Mode
NEXT_PUBLIC_LOGO_GRADIENT_TYPE=linear
# Options: linear, radial
NEXT_PUBLIC_LOGO_GRADIENT_COLORS=#667eea,#764ba2
NEXT_PUBLIC_LOGO_GRADIENT_DIRECTION=to right
# Options: to right, to left, to bottom, to top, 45deg, etc.

# OR Advanced Color Stops Mode
NEXT_PUBLIC_LOGO_GRADIENT_STOPS=[{"color":"#FF0000","position":0},{"color":"#FFFF00","position":50}]

# Animation
NEXT_PUBLIC_LOGO_GRADIENT_ANIMATE=true

# ===================================
# GLOW/SHADOW EFFECT
# ===================================

NEXT_PUBLIC_LOGO_GLOW_ENABLED=true
NEXT_PUBLIC_LOGO_GLOW_COLOR=#8b5cf6
NEXT_PUBLIC_LOGO_GLOW_INTENSITY=medium
# Options: subtle, medium, strong, neon
NEXT_PUBLIC_LOGO_GLOW_ANIMATE=true

# ===================================
# TEXT STROKE/OUTLINE
# ===================================

NEXT_PUBLIC_LOGO_STROKE_ENABLED=true
NEXT_PUBLIC_LOGO_STROKE_WIDTH=2
# Range: 0.5 - 5
NEXT_PUBLIC_LOGO_STROKE_COLOR=#000000

# ===================================
# CUSTOM FONTS
# ===================================

NEXT_PUBLIC_LOGO_CUSTOM_FONT_URL=https://fonts.googleapis.com/css2?family=YourFont
NEXT_PUBLIC_LOGO_CUSTOM_FONT_FAMILY=Your Font Name

# ===================================
# BRAND COLORS
# ===================================

NEXT_PUBLIC_BRAND_PRIMARY=#0066cc
NEXT_PUBLIC_BRAND_PRIMARY_DARK=#0052a3
NEXT_PUBLIC_BRAND_SECONDARY=#00cc66
NEXT_PUBLIC_BRAND_ACCENT=#ff6b00

# ===================================
# TYPOGRAPHY
# ===================================

NEXT_PUBLIC_FONT_HEADING=Inter
NEXT_PUBLIC_FONT_HEADING_WEIGHTS=600,700,800
NEXT_PUBLIC_FONT_BODY=Inter
NEXT_PUBLIC_FONT_BODY_WEIGHTS=400,500,600

# ===================================
# ICON STYLE
# ===================================

NEXT_PUBLIC_ICON_STYLE=outline
# Options: outline, solid
NEXT_PUBLIC_ICON_STROKE_WIDTH=2

# ===================================
# METADATA
# ===================================

NEXT_PUBLIC_BRAND_PERSONALITY=professional
# Options: professional, playful, minimal, bold, elegant

NEXT_PUBLIC_APP_CATEGORY=saas
# Options: fintech, saas, ecommerce, healthcare, education, social
```

---

## Step-by-Step Examples

### Example 1: Professional SaaS Logo (Like MakerKit)

**Goal:** Clean, modern gradient logo with subtle animation.

**Step 1: Start Simple**

```bash
# .env.local
NEXT_PUBLIC_LOGO_TYPE=text
NEXT_PUBLIC_LOGO_TEXT="FlowApp"
NEXT_PUBLIC_LOGO_FONT="Inter"
NEXT_PUBLIC_LOGO_FONT_WEIGHT=800
```

**Step 2: Add Professional Gradient**

```bash
# Add these lines
NEXT_PUBLIC_LOGO_GRADIENT_ENABLED=true
NEXT_PUBLIC_LOGO_GRADIENT_PRESET=purple-blue
```

**Step 3: Add Subtle Animation**

```bash
# Add this line
NEXT_PUBLIC_LOGO_GRADIENT_ANIMATE=true
```

**Step 4: Complete Brand Colors**

```bash
NEXT_PUBLIC_BRAND_PRIMARY=#667eea
NEXT_PUBLIC_BRAND_SECONDARY=#06b6d4
NEXT_PUBLIC_BRAND_ACCENT=#f97316
```

**Result:** Professional purple-to-blue gradient logo with smooth shifting animation, perfect for modern SaaS products!

---

### Example 2: Gaming Platform with Neon Glow

**Goal:** Bold, attention-grabbing logo with intense neon effect.

**Step 1: Bold Text**

```bash
NEXT_PUBLIC_LOGO_TYPE=text
NEXT_PUBLIC_LOGO_TEXT="GAMEZONE"
NEXT_PUBLIC_LOGO_FONT="Montserrat"
NEXT_PUBLIC_LOGO_FONT_WEIGHT=900
NEXT_PUBLIC_LOGO_ICON="⚡"
```

**Step 2: Neon Gradient**

```bash
NEXT_PUBLIC_LOGO_GRADIENT_ENABLED=true
NEXT_PUBLIC_LOGO_GRADIENT_PRESET=neon
NEXT_PUBLIC_LOGO_GRADIENT_ANIMATE=true
```

**Step 3: Intense Glow**

```bash
NEXT_PUBLIC_LOGO_GLOW_ENABLED=true
NEXT_PUBLIC_LOGO_GLOW_COLOR=#FF00FF
NEXT_PUBLIC_LOGO_GLOW_INTENSITY=neon
NEXT_PUBLIC_LOGO_GLOW_ANIMATE=true
```

**Step 4: Gaming Colors**

```bash
NEXT_PUBLIC_BRAND_PRIMARY=#00F5FF
NEXT_PUBLIC_BRAND_SECONDARY=#FF00FF
NEXT_PUBLIC_BRAND_ACCENT=#FFFF00
```

**Result:** Cyberpunk-style logo with cyan-magenta gradient and pulsing neon glow!

---

### Example 3: Sports Brand with Bold Outline

**Goal:** High-impact logo with strong outline, like Nike or Adidas.

**Step 1: Bold Typography**

```bash
NEXT_PUBLIC_LOGO_TYPE=text
NEXT_PUBLIC_LOGO_TEXT="POWERFIT"
NEXT_PUBLIC_LOGO_FONT="Montserrat"
NEXT_PUBLIC_LOGO_FONT_WEIGHT=900
NEXT_PUBLIC_LOGO_ICON="💪"
```

**Step 2: White Fill**

```bash
NEXT_PUBLIC_LOGO_TEXT_COLOR_LIGHT=#FFFFFF
NEXT_PUBLIC_LOGO_TEXT_COLOR_DARK=#FFFFFF
```

**Step 3: Bold Black Outline**

```bash
NEXT_PUBLIC_LOGO_STROKE_ENABLED=true
NEXT_PUBLIC_LOGO_STROKE_WIDTH=3
NEXT_PUBLIC_LOGO_STROKE_COLOR=#000000
```

**Step 4: Optional Fire Gradient Inside**

```bash
# Uncomment to add gradient fill
NEXT_PUBLIC_LOGO_GRADIENT_ENABLED=true
NEXT_PUBLIC_LOGO_GRADIENT_PRESET=fire
```

**Step 5: Sports Colors**

```bash
NEXT_PUBLIC_BRAND_PRIMARY=#dc2626
NEXT_PUBLIC_BRAND_SECONDARY=#1f2937
NEXT_PUBLIC_BRAND_ACCENT=#fbbf24
```

**Result:** Bold outlined logo perfect for sports, fitness, or lifestyle brands!

---

### Example 4: Luxury Brand with Gold Shimmer

**Goal:** Elegant logo with gold gradient and subtle shimmer.

**Step 1: Elegant Typography**

```bash
NEXT_PUBLIC_LOGO_TYPE=text
NEXT_PUBLIC_LOGO_TEXT="LUXE"
NEXT_PUBLIC_LOGO_FONT="Playfair Display"
NEXT_PUBLIC_LOGO_FONT_WEIGHT=900
NEXT_PUBLIC_LOGO_ICON="✨"
```

**Step 2: Gold Gradient**

```bash
NEXT_PUBLIC_LOGO_GRADIENT_ENABLED=true
NEXT_PUBLIC_LOGO_GRADIENT_TYPE=linear
NEXT_PUBLIC_LOGO_GRADIENT_COLORS=#C9A050,#FFD700,#C9A050
NEXT_PUBLIC_LOGO_GRADIENT_DIRECTION=to right
NEXT_PUBLIC_LOGO_GRADIENT_ANIMATE=true
```

**Step 3: Subtle Gold Glow**

```bash
NEXT_PUBLIC_LOGO_GLOW_ENABLED=true
NEXT_PUBLIC_LOGO_GLOW_COLOR=#FFD700
NEXT_PUBLIC_LOGO_GLOW_INTENSITY=medium
NEXT_PUBLIC_LOGO_GLOW_ANIMATE=true
```

**Step 4: Luxury Colors**

```bash
NEXT_PUBLIC_BRAND_PRIMARY=#C9A050
NEXT_PUBLIC_BRAND_SECONDARY=#6B46C1
NEXT_PUBLIC_BRAND_ACCENT=#E0B0A2
```

**Step 5: Elegant Typography**

```bash
NEXT_PUBLIC_FONT_HEADING=Playfair Display
NEXT_PUBLIC_FONT_HEADING_WEIGHTS=600,700,900
NEXT_PUBLIC_FONT_BODY=Lora
NEXT_PUBLIC_FONT_BODY_WEIGHTS=400,500,600
```

**Result:** Luxurious gold logo with subtle shimmer effect, perfect for premium brands!

---

### Example 5: Minimalist Tech Startup

**Goal:** Clean, simple logo with subtle modern touch.

**Step 1: Minimal Text**

```bash
NEXT_PUBLIC_LOGO_TYPE=text
NEXT_PUBLIC_LOGO_TEXT="nova"
NEXT_PUBLIC_LOGO_FONT="Inter"
NEXT_PUBLIC_LOGO_FONT_WEIGHT=600
```

**Step 2: Subtle Gradient (Optional)**

```bash
# Very subtle - just a hint of color
NEXT_PUBLIC_LOGO_GRADIENT_ENABLED=true
NEXT_PUBLIC_LOGO_GRADIENT_TYPE=linear
NEXT_PUBLIC_LOGO_GRADIENT_COLORS=#3b82f6,#6366f1
NEXT_PUBLIC_LOGO_GRADIENT_DIRECTION=to right
# No animation - keep it subtle
```

**Step 3: Minimal Colors**

```bash
NEXT_PUBLIC_BRAND_PRIMARY=#3b82f6
NEXT_PUBLIC_BRAND_SECONDARY=#64748b
NEXT_PUBLIC_BRAND_ACCENT=#0ea5e9
```

**Step 4: Clean Typography**

```bash
NEXT_PUBLIC_FONT_HEADING=Inter
NEXT_PUBLIC_FONT_HEADING_WEIGHTS=500,600,700
NEXT_PUBLIC_FONT_BODY=Inter
NEXT_PUBLIC_FONT_BODY_WEIGHTS=400,500
```

**Result:** Clean, minimal logo with subtle modern gradient - perfect for tech startups!

---

## Troubleshooting

### Logo Not Showing

**Problem:** Logo doesn't appear after configuration.

**Solutions:**

1. **Check environment variable prefix:**
   ```bash
   # ❌ Wrong
   LOGO_TEXT="MyApp"

   # ✅ Correct
   NEXT_PUBLIC_LOGO_TEXT="MyApp"
   ```

2. **Restart development server:**
   ```bash
   # Stop server (Ctrl+C)
   pnpm dev
   ```

3. **Clear Next.js cache:**
   ```bash
   rm -rf .next
   pnpm dev
   ```

4. **Check `.env.local` location:**
   - Must be in `apps/web/.env.local`
   - NOT in root directory

---

### Gradient Not Working

**Problem:** Gradient configured but not visible.

**Solutions:**

1. **Ensure gradient is enabled:**
   ```bash
   NEXT_PUBLIC_LOGO_GRADIENT_ENABLED=true
   ```

2. **Check logo type is text:**
   ```bash
   # Gradients only work with text logos
   NEXT_PUBLIC_LOGO_TYPE=text
   ```

3. **Verify color format:**
   ```bash
   # ❌ Wrong
   NEXT_PUBLIC_LOGO_GRADIENT_COLORS=blue,purple

   # ✅ Correct
   NEXT_PUBLIC_LOGO_GRADIENT_COLORS=#3b82f6,#8b5cf6
   ```

4. **Check preset name:**
   ```bash
   # ❌ Wrong
   NEXT_PUBLIC_LOGO_GRADIENT_PRESET=purpleblue

   # ✅ Correct
   NEXT_PUBLIC_LOGO_GRADIENT_PRESET=purple-blue
   ```

---

### Animation Not Playing

**Problem:** Animation configured but logo is static.

**Solutions:**

1. **Check animation flag:**
   ```bash
   # For gradient animation
   NEXT_PUBLIC_LOGO_GRADIENT_ANIMATE=true

   # For glow animation
   NEXT_PUBLIC_LOGO_GLOW_ANIMATE=true
   ```

2. **Verify effect is enabled:**
   ```bash
   # Can't animate gradient without gradient enabled
   NEXT_PUBLIC_LOGO_GRADIENT_ENABLED=true
   NEXT_PUBLIC_LOGO_GRADIENT_ANIMATE=true
   ```

3. **Check user motion preferences:**
   - Some users have "prefers-reduced-motion" enabled
   - Animations automatically disabled for accessibility
   - Test in incognito/private browsing mode

4. **Browser compatibility:**
   - Animations use modern CSS
   - Works on Chrome, Firefox, Safari, Edge
   - May not work on IE11 (deprecated)

---

### Glow Effect Too Weak/Strong

**Problem:** Glow intensity not right.

**Solutions:**

1. **Adjust intensity level:**
   ```bash
   # Too weak? Increase
   NEXT_PUBLIC_LOGO_GLOW_INTENSITY=strong

   # Too strong? Decrease
   NEXT_PUBLIC_LOGO_GLOW_INTENSITY=subtle
   ```

2. **Change glow color:**
   ```bash
   # Brighter color = more visible glow
   NEXT_PUBLIC_LOGO_GLOW_COLOR=#FFFFFF

   # Darker color = subtler glow
   NEXT_PUBLIC_LOGO_GLOW_COLOR=#333333
   ```

3. **For maximum glow:**
   ```bash
   NEXT_PUBLIC_LOGO_GLOW_INTENSITY=neon
   NEXT_PUBLIC_LOGO_GLOW_COLOR=#00FFFF
   NEXT_PUBLIC_LOGO_GLOW_ANIMATE=true
   ```

---

### Stroke Not Visible

**Problem:** Text stroke configured but not showing.

**Solutions:**

1. **Ensure stroke is enabled:**
   ```bash
   NEXT_PUBLIC_LOGO_STROKE_ENABLED=true
   ```

2. **Increase stroke width:**
   ```bash
   # Try larger width
   NEXT_PUBLIC_LOGO_STROKE_WIDTH=3
   ```

3. **Use contrasting color:**
   ```bash
   # Light text = dark stroke
   NEXT_PUBLIC_LOGO_TEXT_COLOR_LIGHT=#ffffff
   NEXT_PUBLIC_LOGO_STROKE_COLOR=#000000

   # Dark text = light stroke
   NEXT_PUBLIC_LOGO_TEXT_COLOR_LIGHT=#000000
   NEXT_PUBLIC_LOGO_STROKE_COLOR=#ffffff
   ```

4. **Check browser support:**
   - `-webkit-text-stroke` works in all modern browsers
   - May not work in very old browsers

---

### Custom Font Not Loading

**Problem:** Custom font specified but default font appears.

**Solutions:**

1. **Verify URL is accessible:**
   ```bash
   # Test in browser - should load CSS file
   https://fonts.googleapis.com/css2?family=YourFont
   ```

2. **Check font family name:**
   ```bash
   # Must match EXACTLY as shown in Google Fonts
   NEXT_PUBLIC_LOGO_CUSTOM_FONT_FAMILY=Roboto Mono
   # Not: "RobotoMono" or "roboto-mono"
   ```

3. **For self-hosted fonts:**
   ```bash
   # Ensure font file exists
   ls apps/web/public/fonts/your-font.woff2

   # Check path is correct
   NEXT_PUBLIC_LOGO_CUSTOM_FONT_URL=/fonts/your-font.woff2
   ```

4. **Check Network tab:**
   - Open browser DevTools → Network
   - Filter by "Fonts"
   - Verify font file loads without errors

---

### Performance Issues

**Problem:** Logo animations causing lag or high CPU.

**Solutions:**

1. **Disable animations:**
   ```bash
   NEXT_PUBLIC_LOGO_GRADIENT_ANIMATE=false
   NEXT_PUBLIC_LOGO_GLOW_ANIMATE=false
   ```

2. **Use subtle effects:**
   ```bash
   # Subtle glow uses less GPU
   NEXT_PUBLIC_LOGO_GLOW_INTENSITY=subtle
   ```

3. **Test on target devices:**
   - Animations are GPU-accelerated
   - Should run smoothly on modern devices
   - Consider disabling on mobile if needed

4. **Check browser extensions:**
   - Some ad blockers interfere with animations
   - Test in incognito mode

---

## Advanced Techniques

### Technique 1: Time-Based Gradient

Create gradient that changes based on time of day:

**Not directly supported, but you can:**

1. Create multiple `.env` files:
   - `.env.morning` - Warm sunrise colors
   - `.env.afternoon` - Bright daylight colors
   - `.env.evening` - Cool sunset colors
   - `.env.night` - Dark, calm colors

2. Use build-time script to copy appropriate file

3. Or implement client-side theme switching

---

### Technique 2: Responsive Logo Sizing

Logo automatically scales, but you can customize:

**In your CSS:**

```css
/* apps/web/styles/globals.css */
.logo-container {
  @media (max-width: 640px) {
    /* Mobile - smaller logo */
    font-size: 1.5rem;
  }

  @media (min-width: 641px) and (max-width: 1024px) {
    /* Tablet - medium logo */
    font-size: 2rem;
  }

  @media (min-width: 1025px) {
    /* Desktop - full size logo */
    font-size: 2.5rem;
  }
}
```

---

### Technique 3: Dark Mode Specific Effects

Different effects for light vs dark mode:

**Example: Strong glow in dark mode only**

```typescript
// apps/web/lib/branding-styles.ts

// In generateLogoStyle function, add:
if (config.logo.glow?.enabled) {
  // Different glow for dark mode
  const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;

  const intensity = isDarkMode ? 'strong' : 'subtle';
  const glowColor = isDarkMode ? '#00FFFF' : config.colors.primary;

  // Use adjusted values...
}
```

---

### Technique 4: Multiple Gradient Variations

Create different gradients for different pages:

**Setup:**

1. Create base gradient in `.env.local`
2. Override in specific pages with CSS variables
3. Use Tailwind classes for per-page styling

**Example:**

```tsx
// app/(marketing)/page.tsx
export default function LandingPage() {
  return (
    <div style={{
      '--logo-gradient-colors': 'linear-gradient(to right, #ff0000, #0000ff)'
    } as React.CSSProperties}>
      <AppLogo />
    </div>
  );
}
```

---

### Technique 5: Conditional Effects Based on Route

Show animations only on landing page:

```typescript
// apps/web/components/app-logo.tsx

'use client';

import { usePathname } from 'next/navigation';

export function ConditionalAnimatedLogo() {
  const pathname = usePathname();
  const isLandingPage = pathname === '/';

  return (
    <div className={isLandingPage ? 'animate-gradient' : ''}>
      <AppLogo />
    </div>
  );
}
```

---

### Technique 6: A/B Testing Logo Variations

Test different logo styles:

```typescript
// Use feature flags or analytics
const logoVariant = getVariant(); // 'A' or 'B'

const gradientPreset = logoVariant === 'A' ? 'purple-blue' : 'ocean';
```

---

### Technique 7: Logo Color Extraction

Automatically extract colors from logo image:

**Not built-in, but you can:**

1. Use tool like [Coolors](https://coolors.co/image-picker)
2. Upload your logo
3. Extract color palette
4. Use extracted colors in env vars:

```bash
NEXT_PUBLIC_BRAND_PRIMARY=#extracted-color-1
NEXT_PUBLIC_BRAND_SECONDARY=#extracted-color-2
NEXT_PUBLIC_BRAND_ACCENT=#extracted-color-3
```

---

## Quick Reference Card

### Most Common Configurations

**Professional SaaS:**
```bash
NEXT_PUBLIC_LOGO_GRADIENT_ENABLED=true
NEXT_PUBLIC_LOGO_GRADIENT_PRESET=purple-blue
NEXT_PUBLIC_LOGO_GRADIENT_ANIMATE=true
```

**Gaming/Entertainment:**
```bash
NEXT_PUBLIC_LOGO_GRADIENT_PRESET=neon
NEXT_PUBLIC_LOGO_GLOW_INTENSITY=neon
NEXT_PUBLIC_LOGO_GLOW_ANIMATE=true
```

**Sports/Fitness:**
```bash
NEXT_PUBLIC_LOGO_STROKE_ENABLED=true
NEXT_PUBLIC_LOGO_STROKE_WIDTH=3
NEXT_PUBLIC_LOGO_STROKE_COLOR=#000000
```

**Luxury/Premium:**
```bash
NEXT_PUBLIC_LOGO_GRADIENT_COLORS=#C9A050,#FFD700,#C9A050
NEXT_PUBLIC_LOGO_GLOW_INTENSITY=medium
NEXT_PUBLIC_LOGO_GLOW_ANIMATE=true
NEXT_PUBLIC_FONT_HEADING=Playfair Display
```

---

## Additional Resources

### Example Files

Check these files for complete working examples:

- `packages/branding/examples/gradient-modern.env` - Modern SaaS
- `packages/branding/examples/neon-glow.env` - Gaming/Entertainment
- `packages/branding/examples/outlined-bold.env` - Sports/Fitness
- `packages/branding/examples/animated-premium.env` - Luxury

### Documentation

- Main branding docs: `packages/branding/CLAUDE.md`
- AI branding guide: `packages/branding/CLAUDE.md` (for AI assistance)
- Component reference: `apps/web/components/app-logo.tsx`
- Styling utilities: `apps/web/lib/branding-styles.ts`

### Support

- Check existing examples first
- Review troubleshooting section
- Test in different browsers
- Use browser DevTools to inspect

---

## Tips for Success

1. **Start Simple:** Begin with basic text logo, add effects incrementally
2. **Test Frequently:** Check changes in browser after each addition
3. **Use Presets:** Start with gradient presets before custom colors
4. **Consider Accessibility:** Remember some users disable animations
5. **Optimize Performance:** Too many effects can slow down page load
6. **Match Your Brand:** Use effects that align with your brand personality
7. **Get Feedback:** Test logo with real users before finalizing
8. **Save Configurations:** Keep track of working configs in version control
9. **Document Choices:** Comment your `.env` file with reasoning
10. **Iterate:** Try different combinations to find perfect balance

---

## Next Steps

1. **Copy an example** from `packages/branding/examples/`
2. **Paste into** your `.env.local` file
3. **Customize** the values to match your brand
4. **Restart** your development server
5. **Refine** based on what you see
6. **Repeat** until perfect!

Happy branding! 🎨
