# IrrigoPro Design Guidelines - Mobile-First System

## Design Philosophy
**Approach:** Mobile-first, touch-optimized interface designed for field technicians working outdoors. Every element prioritizes thumb reachability, glanceable information, and one-handed operation.

**Visual Language:** Sleek, modern glassmorphism with water-inspired color palette. Clean surfaces with subtle depth, smooth animations, and generous white space.

## Color System

### Primary Palette (Water-Inspired)
- **Primary Blue:** `#0EA5E9` (sky-500) - Main actions, active states
- **Primary Dark:** `#0284C7` (sky-600) - Pressed states
- **Primary Light:** `#38BDF8` (sky-400) - Highlights, gradients
- **Teal Accent:** `#14B8A6` (teal-500) - Secondary actions

### Neutral Palette
- **Background:** `#F8FAFC` (slate-50) - Page backgrounds
- **Surface:** `#FFFFFF` - Cards, modals
- **Surface Elevated:** `rgba(255,255,255,0.8)` - Glassmorphism cards
- **Border:** `#E2E8F0` (slate-200) - Subtle dividers
- **Text Primary:** `#0F172A` (slate-900) - Headings
- **Text Secondary:** `#64748B` (slate-500) - Body text
- **Text Muted:** `#94A3B8` (slate-400) - Captions

### Semantic Colors
- **Success:** `#10B981` (emerald-500) - Completed, approved
- **Warning:** `#F59E0B` (amber-500) - Pending, attention
- **Danger:** `#EF4444` (red-500) - Errors, urgent
- **Info:** `#3B82F6` (blue-500) - Information

### Gradients
- **Hero Gradient:** `linear-gradient(135deg, #0EA5E9 0%, #14B8A6 100%)`
- **Card Glow:** `linear-gradient(135deg, rgba(14,165,233,0.1) 0%, rgba(20,184,166,0.05) 100%)`
- **Glass Overlay:** `linear-gradient(135deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.7) 100%)`

## Typography Scale

### Mobile-Optimized Hierarchy
```
Display:    32px / 700 / -0.02em  (Hero headings)
H1:         24px / 700 / -0.01em  (Page titles)
H2:         20px / 600 / 0        (Section headers)
H3:         18px / 600 / 0        (Card titles)
Body Large: 17px / 400 / 0        (Primary content)
Body:       15px / 400 / 0        (Standard text)
Caption:    13px / 500 / 0.01em   (Labels, metadata)
Micro:      11px / 500 / 0.02em   (Badges, timestamps)
```

### Font Stack
```css
font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
```

## Spacing System

### Base Unit: 4px
```
xs:   4px   (Micro gaps)
sm:   8px   (Tight spacing)
md:   12px  (Standard gaps)
lg:   16px  (Section spacing)
xl:   24px  (Major sections)
2xl:  32px  (Page margins)
3xl:  48px  (Hero spacing)
```

### Touch Targets
- **Minimum tap size:** 48px × 48px
- **Button height:** 52px (large), 44px (default), 36px (compact)
- **Icon buttons:** 48px × 48px
- **List item height:** 72px minimum
- **Inter-element spacing:** 12px minimum

## Component Patterns

### Cards - Glassmorphism Style
```css
.card-glass {
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 20px;
  box-shadow: 
    0 4px 6px -1px rgba(0, 0, 0, 0.05),
    0 10px 15px -3px rgba(0, 0, 0, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
}
```

### Task Cards (Work Orders, Billing Sheets)
- **Height:** Auto, minimum 120px
- **Padding:** 20px
- **Border radius:** 20px
- **Status indicator:** Left border accent (4px) or top badge
- **Layout:** 
  - Top: Customer name + Status badge
  - Middle: Address, description (2 lines max)
  - Bottom: Date/time + Quick action button

### Metric Tiles
- **Size:** Full-width on mobile, 1/2 or 1/3 on tablet+
- **Content:** Large number (32px bold), label below (13px)
- **Icon:** Top-right, 24px, muted color
- **Background:** Subtle gradient based on metric type

### Action Sheets (Bottom Drawers)
```css
.action-sheet {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: white;
  border-radius: 24px 24px 0 0;
  padding: 8px 20px 32px;
  box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.15);
  max-height: 90vh;
  overflow-y: auto;
}
```
- **Handle:** 40px × 4px centered bar, slate-300
- **Safe area:** Account for iOS home indicator

### Floating Action Button (FAB)
```css
.fab {
  position: fixed;
  bottom: 100px; /* Above bottom nav */
  right: 20px;
  width: 60px;
  height: 60px;
  border-radius: 18px;
  background: linear-gradient(135deg, #0EA5E9 0%, #0284C7 100%);
  box-shadow: 
    0 8px 24px rgba(14, 165, 233, 0.4),
    0 2px 8px rgba(0, 0, 0, 0.1);
}
```

### Bottom Navigation
- **Height:** 72px + safe area
- **Background:** Glassmorphism (white/80%, blur 20px)
- **Icons:** 28px, with labels below (11px)
- **Active state:** Primary color icon + subtle background pill
- **Center button:** Elevated 60×60 pill for primary action

### Forms - Mobile Optimized
- **Input height:** 52px
- **Border radius:** 14px
- **Label:** Above input, 13px semibold, slate-600
- **Focus state:** 2px primary ring, subtle glow
- **Spacing:** 20px between fields
- **Keyboard handling:** Inputs scroll into view, sticky submit button

### Buttons
```css
/* Primary - Large touch target */
.btn-primary {
  height: 52px;
  padding: 0 28px;
  border-radius: 14px;
  font-weight: 600;
  font-size: 16px;
  background: linear-gradient(135deg, #0EA5E9 0%, #0284C7 100%);
  color: white;
  box-shadow: 0 4px 14px rgba(14, 165, 233, 0.35);
}

/* Secondary */
.btn-secondary {
  height: 52px;
  padding: 0 28px;
  border-radius: 14px;
  background: white;
  border: 2px solid #E2E8F0;
  color: #0F172A;
}

/* Ghost - for inline actions */
.btn-ghost {
  height: 44px;
  padding: 0 16px;
  border-radius: 12px;
  background: transparent;
  color: #0EA5E9;
}
```

### Status Badges
```css
/* Pill style with subtle backgrounds */
.badge {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 12px;
  border-radius: 14px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.badge-pending { background: #FEF3C7; color: #B45309; }
.badge-active { background: #DBEAFE; color: #1D4ED8; }
.badge-complete { background: #D1FAE5; color: #047857; }
.badge-urgent { background: #FEE2E2; color: #DC2626; }
```

## Animation Specifications

### Transitions
- **Default:** 200ms ease-out
- **Quick:** 150ms ease-out (micro-interactions)
- **Smooth:** 300ms cubic-bezier(0.4, 0, 0.2, 1) (page transitions)

### Micro-interactions
- **Button press:** scale(0.97) on touch
- **Card tap:** opacity 0.9 + subtle scale(0.99)
- **Swipe hint:** translateX animation on touch start

### Page Transitions
- **Enter:** Fade in + slide up 20px
- **Exit:** Fade out + slide down 10px

### Loading States
- **Skeleton:** Shimmer animation (1.5s infinite)
- **Spinner:** Primary color, 24px, subtle rotation

## Layout Patterns

### Page Structure
```
┌─────────────────────────────┐
│  Status Bar (transparent)   │
├─────────────────────────────┤
│  Header (sticky, glass)     │
│  - Title left               │
│  - Actions right            │
├─────────────────────────────┤
│                             │
│  Content Area               │
│  (scrollable)               │
│  - 20px horizontal padding  │
│  - 16px vertical gaps       │
│                             │
├─────────────────────────────┤
│  FAB (if applicable)        │
├─────────────────────────────┤
│  Bottom Nav (fixed, glass)  │
│  + Safe Area                │
└─────────────────────────────┘
```

### Grid System
- **Mobile:** Single column, full-width cards
- **Tablet (768px+):** 2-column grid for cards
- **Desktop (1024px+):** 3-4 column grid, max-width container

### Content Hierarchy
1. Most critical info at top (today's work)
2. Quick actions within thumb reach (bottom third)
3. Secondary info below fold
4. Historical/reference data at bottom

## Responsive Breakpoints
```css
/* Mobile-first */
sm: 640px   /* Large phones, landscape */
md: 768px   /* Tablets */
lg: 1024px  /* Desktop */
xl: 1280px  /* Wide screens */
```

## Accessibility
- **Color contrast:** Minimum 4.5:1 for text
- **Touch targets:** 48px minimum
- **Focus indicators:** Visible 2px rings
- **Motion:** Respect prefers-reduced-motion
- **Screen reader:** Semantic HTML, ARIA labels

## Dark Mode (Future)
Reserved for future implementation with inverted color tokens.
