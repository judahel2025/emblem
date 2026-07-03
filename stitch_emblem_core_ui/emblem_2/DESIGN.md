---
name: Emblem
colors:
  surface: '#fff8f6'
  surface-dim: '#e5d7d3'
  surface-bright: '#fff8f6'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#fff1ed'
  surface-container: '#faebe7'
  surface-container-high: '#f4e5e1'
  surface-container-highest: '#eedfdc'
  on-surface: '#211a18'
  on-surface-variant: '#53433e'
  inverse-surface: '#372f2c'
  inverse-on-surface: '#fceeea'
  outline: '#86736d'
  outline-variant: '#d9c2bb'
  surface-tint: '#8f4c36'
  primary: '#8c4a34'
  on-primary: '#ffffff'
  primary-container: '#aa614a'
  on-primary-container: '#fffbff'
  inverse-primary: '#ffb59e'
  secondary: '#7a564b'
  on-secondary: '#ffffff'
  secondary-container: '#fdcdbe'
  on-secondary-container: '#79554a'
  tertiary: '#00685e'
  on-tertiary: '#ffffff'
  tertiary-container: '#298177'
  on-tertiary-container: '#f4fffc'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdbd0'
  primary-fixed-dim: '#ffb59e'
  on-primary-fixed: '#3a0b00'
  on-primary-fixed-variant: '#723521'
  secondary-fixed: '#ffdbd0'
  secondary-fixed-dim: '#ebbcae'
  on-secondary-fixed: '#2e150c'
  on-secondary-fixed-variant: '#603f34'
  tertiary-fixed: '#9ef2e5'
  tertiary-fixed-dim: '#82d5c9'
  on-tertiary-fixed: '#00201c'
  on-tertiary-fixed-variant: '#005048'
  background: '#fff8f6'
  on-background: '#211a18'
  surface-variant: '#eedfdc'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.04em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.2'
  title-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '500'
    lineHeight: '1.4'
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  label-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.0'
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 8px
  container-max: 1200px
  gutter: 24px
  margin-mobile: 20px
  margin-desktop: 40px
---

## Brand & Style
The design system is engineered to evoke a sense of "Quiet Intelligence." It targets a sophisticated audience that values precision, high-end hardware aesthetics, and the seamless integration of AI into a luxury lifestyle. The brand personality is authoritative yet discreet, moving from a dark, cinematic aesthetic to a warm, refined light-mode experience that feels like premium stationery or high-end architectural materials.

The design style is a hybrid of **Minimalism** and **Glassmorphism**, specifically tailored for a light-mode-first experience. It utilizes balanced typography against soft, neutral backgrounds to create a focused, high-clarity environment. Texture is introduced through subtle depth and "The Orb"—a central, glowing manifestation of the AI that serves as the heartbeat of the interface.

## Colors
The palette is rooted in warm neutrals and clay-inspired tones to provide a sophisticated, organic feel.

- **Background**: The base is a soft, warm neutral (#FFF8F6) that provides a comfortable canvas for interaction.
- **Surfaces**: Secondary containers and sidebars use a light terracotta-tinted neutral (#F9EBE7), creating a subtle tiered hierarchy without needing heavy borders.
- **Accents**: A refined Terracotta (#AD644D) is reserved strictly for primary actions, status indicators, and the AI's active state.
- **Typography**: A deep, desaturated charcoal (#231917) is used for primary text to ensure high legibility while maintaining a soft, premium feel against the warm background.

## Typography
This design system utilizes **Inter** for its core readability and neutral, premium feel. To add a technical edge, **Geist** is introduced for labels and mono-spaced data points, emphasizing the AI's precision.

Headlines should use tight letter-spacing to feel "locked-in" and architectural. Body text is given generous line-height to ensure a comfortable reading experience for long-form AI responses. For mobile, display sizes scale down aggressively to ensure the conversational interface remains the primary focus.

## Layout & Spacing
The layout follows a **Fluid Grid** philosophy with wide internal margins to create a sense of exclusivity and "breathing room." 

- **Desktop**: A 12-column grid with a 1200px max-width, centered in the viewport. Sidebars for history or settings are fixed at 280px and utilize a glassmorphic blur to sit "above" the main content.
- **Mobile**: A single-column flow with a 20px safe-area margin. 
- **Rhythm**: All spacing is derived from an 8px base unit (8, 16, 24, 32, 48, 64). Elements like input bars and action cards should use 24px internal padding to maintain the premium, spacious aesthetic.

## Elevation & Depth
Depth is created through **Glassmorphism** and tonal-based hierarchy rather than heavy traditional shadows.

1.  **Level 0 (Base)**: Warm neutral background.
2.  **Level 1 (Cards)**: Subtle surface containers (#F9EBE7) with a 1px stroke of `rgba(83, 67, 63, 0.1)`.
3.  **Level 2 (Overlays)**: Semi-transparent surfaces (80% opacity) with a 20px backdrop blur and a soft terracotta glow if the AI is "thinking."
4.  **Shadows**: When used, shadows must be "Ambient Glows"—instead of black shadows, use low-opacity terracotta (`#AD644D` at 5%) for primary buttons to make them appear as if they are resting naturally on the surface.

## Shapes
The shape language is sophisticated and modern, avoiding the "bubbly" look of consumer social apps while remaining approachable. 

The standard corner radius is **8px** (rounded-DEFAULT). Small components like tags or checkboxes use **4px** (soft). Large containers, such as the main chat input or featured cards, use **24px** (rounded-xl) to emphasize the premium build of the interface. The "Orb" and primary action buttons are fully pill-shaped (rounded-full) to provide a distinct contrast to the structured, rectangular grid.

## Components

- **The Orb**: The signature component. A circular gradient element using the primary terracotta and tertiary teal with a multi-layered Gaussian blur (40px+). It should pulsate slowly during AI processing.
- **Primary Buttons**: Pill-shaped, #AD644D background, light text for maximum legibility. No borders; use a soft tinted outer glow on hover.
- **Input Fields**: Large (64px height) with a 24px corner radius. Background is #F9EBE7 with a subtle 1px border at 10% opacity. Focus state changes the border to the primary terracotta.
- **Approval Gate**: For AI-generated actions that require confirmation, use a split card. The "Approve" side uses the accent terracotta; the "Decline" side uses a ghost-style neutral border.
- **Glass Cards**: Use for non-critical information like "Recent History." Background: `rgba(249, 235, 231, 0.6)`, Backdrop-filter: `blur(12px)`.
- **Minimalist Icons**: 2px stroke weight, non-filled, using the #53433F desaturated brown.