---
name: Emblem
colors:
  surface: '#f9f9f9'
  surface-dim: '#dadada'
  surface-bright: '#f9f9f9'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f3f4'
  surface-container: '#eeeeee'
  surface-container-high: '#e8e8e8'
  surface-container-highest: '#e2e2e2'
  on-surface: '#1a1c1c'
  on-surface-variant: '#434656'
  inverse-surface: '#2f3131'
  inverse-on-surface: '#f0f1f1'
  outline: '#737688'
  outline-variant: '#c3c5d9'
  surface-tint: '#004ced'
  primary: '#003ec7'
  on-primary: '#ffffff'
  primary-container: '#0052ff'
  on-primary-container: '#dfe3ff'
  inverse-primary: '#b7c4ff'
  secondary: '#5e5e5e'
  on-secondary: '#ffffff'
  secondary-container: '#e2e2e2'
  on-secondary-container: '#646464'
  tertiary: '#952200'
  on-tertiary: '#ffffff'
  tertiary-container: '#bf3003'
  on-tertiary-container: '#ffddd5'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dde1ff'
  primary-fixed-dim: '#b7c4ff'
  on-primary-fixed: '#001452'
  on-primary-fixed-variant: '#0038b6'
  secondary-fixed: '#e2e2e2'
  secondary-fixed-dim: '#c6c6c6'
  on-secondary-fixed: '#1b1b1b'
  on-secondary-fixed-variant: '#474747'
  tertiary-fixed: '#ffdbd2'
  tertiary-fixed-dim: '#ffb4a1'
  on-tertiary-fixed: '#3c0800'
  on-tertiary-fixed-variant: '#891e00'
  background: '#f9f9f9'
  on-background: '#1a1c1c'
  surface-variant: '#e2e2e2'
typography:
  display:
    fontFamily: Geist
    fontSize: 48px
    fontWeight: '600'
    lineHeight: '1.1'
    letterSpacing: -0.04em
  display-mobile:
    fontFamily: Geist
    fontSize: 36px
    fontWeight: '600'
    lineHeight: '1.1'
    letterSpacing: -0.03em
  headline-lg:
    fontFamily: Geist
    fontSize: 32px
    fontWeight: '500'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '500'
    lineHeight: '1.3'
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Geist
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
    letterSpacing: '0'
  body-md:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
    letterSpacing: '0'
  label-md:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.2'
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 8px
  container-max: 1280px
  gutter: 24px
  margin-desktop: 48px
  margin-mobile: 20px
  stack-xs: 4px
  stack-sm: 12px
  stack-md: 24px
  stack-lg: 48px
  stack-xl: 80px
---

## Brand & Style

The design system is engineered to evoke a sense of high-performance precision and intellectual clarity. It is tailored for professional power users who value speed, intentionality, and a tool-like aesthetic that stays out of their way until needed.

The visual style is **High-End Minimalism** blended with **Modern Glassmorphism**. It utilizes expansive whitespace, rigorous grid alignment, and subtle translucency to create an environment that feels both lightweight and structurally sound. The emotional response is one of "calm authority"—a premium workspace where every interaction is crisp, purposeful, and free of visual friction.

## Colors

The palette is restricted to a high-contrast monochromatic base with a single, high-energy functional accent.

- **Primary (Electric Blue):** Used exclusively for primary actions, active states, and focus indicators. It provides a sharp "signal" against the neutral backdrop.
- **Secondary (Pure Black):** Reserved for primary text, iconography, and high-emphasis borders to ensure maximum legibility.
- **Neutral (Pure White):** The foundation of the layout, providing the expansive, clean surfaces required for a minimalist aesthetic.
- **Surface & Borders:** Interactive elements use a semi-transparent glass effect to maintain depth without adding visual weight. Borders are kept thin (1px) and low-opacity to define structure without cluttering the view.

## Typography

This design system utilizes **Geist** for its technical precision and balanced geometric construction. The typographic hierarchy is driven by contrast in weight and tight letter-spacing for larger scales.

Use `display` and `headline-lg` for impactful entry points. For density-heavy views, lean on `body-md` and `label-sm`. All caps should be reserved strictly for `label-sm` to maintain a professional, architectural feel.

## Layout, Spacing & Motion

The layout follows a **Fluid Grid** model with a 12-column structure on desktop. Emphasis is placed on vertical "stacks" of information, utilizing generous white space (`stack-lg` and `stack-xl`) to separate distinct logical sections.

**Motion Principles:**
Motion is a core identity of the design system. 
- **Cursor Tracking:** Interactive cards and buttons should employ a subtle 3D tilt or light-refraction effect that tracks the user's cursor with a slight lag (`0.1s`).
- **Transitions:** Use `duration-smooth` with `easing-standard` for all state changes. 
- **Reveals:** New content sections should slide up slightly (4px-8px) while fading in to emphasize the vertical hierarchy.

## Elevation & Depth

Depth is communicated through **Glassmorphism** and layering rather than heavy shadows.

- **Level 0 (Base):** Pure white background.
- **Level 1 (Floating):** Background blur (20px) with a semi-transparent white fill (`rgba(255, 255, 255, 0.7)`). These surfaces feature a 1px solid border (`rgba(0, 0, 0, 0.08)`).
- **Level 2 (Active/Hover):** Increase backdrop blur to 40px and add a very soft, diffused ambient shadow: `0 20px 40px rgba(0, 0, 0, 0.04)`.

Avoid opaque stacked layers; always use transparency to maintain the "light-filled" feel of the interface.

## Shapes

The design system uses **Soft (Level 1)** roundedness to balance the clinical feel of the typography with a touch of modern approachability. 

- Default elements (Inputs, Buttons): `0.25rem` (4px).
- Cards/Containers: `0.5rem` (8px).
- Modals/Large Sheets: `0.75rem` (12px).

This subtle curvature ensures the UI feels "engineered" rather than "organic," reinforcing the premium productivity narrative.

## Components

- **Buttons:** 
  - *Primary:* Electric Blue background, white text, 4px radius. On hover, a subtle inner glow or slight scale-up (1.02x).
  - *Ghost:* No background, 1px subtle border. On hover, background fills with 5% black.
- **Input Fields:** Minimalist design with only a bottom border (2px) or a very light 4-sided stroke. Focus state transitions the border color to Electric Blue with a `duration-fast`.
- **Cards:** Use Level 1 Elevation (Glassmorphic). Content should be padded with `stack-md`. Implement cursor-tracking light reflections on the surface for high-end polish.
- **Chips/Labels:** High-contrast (Black text on 5% black background) with `label-sm` typography. 
- **Lists:** Clean rows separated by 1px light borders. Active items use a vertical 2px Electric Blue "indicator" on the far left.
- **Micro-Interactions:** Checkboxes and Radio buttons should animate with a "spring" effect when toggled, using the `primary_color_hex` for the filled state.