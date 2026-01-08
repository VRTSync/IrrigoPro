# IrrigoPro Design Guidelines

## Design Approach
**System:** Material Design principles adapted for productivity tools, customized with irrigation industry aesthetics. Focus on efficiency, data clarity, and mobile-first workflows.

**Visual Direction:** Clean, professional interface inspired by modern field service apps (ServiceTitan, Jobber) with water/nature imagery establishing trust and industry relevance.

## Core Design Elements

### Typography
- **Primary Font:** Inter (Google Fonts) - excellent legibility on mobile devices
- **Hierarchy:**
  - H1: 32px/bold (mobile: 24px) - Dashboard headers
  - H2: 24px/semibold (mobile: 20px) - Section titles
  - H3: 18px/semibold (mobile: 16px) - Card headers
  - Body: 16px/regular (mobile: 16px) - Main content
  - Small: 14px/regular - Labels, captions
  - Button text: 16px/medium

### Layout System
**Spacing Units:** Tailwind units of 3, 4, 6, 8, 12, 16
- Mobile padding: p-4, p-6
- Desktop containers: px-8, py-12
- Card spacing: p-4 (mobile), p-6 (desktop)
- Touch target minimum: h-11 (44px), w-11 for icon buttons

**Responsive Breakpoints:**
- Mobile-first design: base (0-768px)
- Desktop enhancement: md: (768px+)

### Component Library

**Hero Section:**
- Full-width hero with high-quality irrigation imagery (sprinkler system, lush green lawn with water droplets)
- Height: 60vh (mobile), 70vh (desktop)
- Overlay: Dark gradient (bottom to top, opacity 0.6)
- Content: Centered white text with blurred background button (backdrop-blur-md, bg-white/20)
- CTA: "Get Started" - rounded-full, min-h-11, px-8

**Navigation:**
- Desktop: Horizontal top bar, logo left, menu items center, user profile right
- Mobile: Bottom fixed bar with 4-5 icons, active state with primary blue indicator, safe-area-inset-bottom for iOS
- Height: 64px (desktop), 56px + safe area (mobile)

**Data Display - Dual Layout:**
- Desktop: Full-width tables with sticky headers, alternating row backgrounds (bg-gray-50), hover states
- Mobile: Cards with rounded-xl corners, shadow-sm, p-4, vertical stack of key info, tap to expand pattern
- Job cards include: status badge (top-right), client name (text-lg/semibold), address, scheduled date/time, action button (bottom)

**Forms & Inputs:**
- Rounded-lg borders, h-11 minimum
- Focus: ring-2 ring-primary (#3B82F6)
- Labels: text-sm, text-gray-700, mb-2
- Error states: ring-red-500, text-red-600 helper text
- Dropdowns: Chevron icons, full-width on mobile

**Buttons:**
- Primary: bg-primary (#3B82F6), text-white, rounded-lg, min-h-11, px-6
- Secondary: border-2 border-primary, text-primary
- Success: bg-green-500 (accent actions)
- Disabled: opacity-50, cursor-not-allowed

**Status Badges:**
- Rounded-full, px-3, py-1, text-sm/medium
- Scheduled: bg-blue-100, text-blue-800
- In Progress: bg-yellow-100, text-yellow-800
- Completed: bg-green-100, text-green-800
- Overdue: bg-red-100, text-red-800

**Dashboard Widgets:**
- Grid layout: grid-cols-1 (mobile), md:grid-cols-2 lg:grid-cols-3 (desktop)
- Cards: bg-white, rounded-xl, shadow-md, p-6
- Stat cards: Large number (text-3xl/bold), label below (text-sm/gray-600), icon top-right

**Modals/Overlays:**
- Mobile: Full-screen slide-up with rounded top corners (rounded-t-3xl)
- Desktop: Centered, max-w-2xl, rounded-xl, backdrop blur
- Header with close button (h-11, w-11)

## Images Section

**Hero Image:**
- Large hero image: Professional irrigation system in action - close-up of sprinkler head with water droplets catching sunlight against vibrant green lawn
- Placement: Full-width background, object-cover, positioned center
- Treatment: Subtle dark overlay for text readability

**Dashboard Enhancement:**
- Empty state illustrations: Simple line art water/irrigation themed graphics for when no jobs scheduled
- Profile placeholders: Circular avatar containers (w-10, h-10 for lists, w-16, h-16 for profiles)

## Animations
Minimal, performance-focused:
- Page transitions: Slide animations for mobile navigation (150ms)
- Card interactions: Subtle scale on tap (scale-[0.98])
- Loading states: Skeleton screens (pulse animation) rather than spinners

## Mobile-Specific Patterns
- Pull-to-refresh on job lists
- Swipe actions on cards (swipe left: complete, swipe right: edit)
- Floating action button for quick job creation (bottom-right, mb-20 to clear nav bar)
- Large tap areas for calendar date selection (min h-11, w-full)
- Bottom sheet patterns for filters/sorting