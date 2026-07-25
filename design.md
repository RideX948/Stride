# RideX Mobile App - Interface Design Plan

## Brand Identity

**App Name**: RideX  
**Tagline**: Your ride, your way  
**Target**: iOS & Android, portrait orientation, one-handed usage

---

## Color System

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `background` | #060c18 | #060c18 | Primary screen background |
| `surface` | #0f1a2e | #0f1a2e | Cards, panels |
| `primary` | #00c8ff | #00c8ff | Cyan — primary actions, route lines |
| `success` | #00e887 | #00e887 | Green — confirmations, driver mode |
| `error` | #ff4444 | #ff4444 | Red — decline, emergency |
| `warning` | #ff8844 | #ff8844 | Orange — demand zones |
| `foreground` | #ffffff | #ffffff | Primary text |
| `muted` | #8899aa | #8899aa | Secondary text |
| `border` | #1e3050 | #1e3050 | Card borders |

---

## Screen List

### Shared Screens
1. **Splash Screen** — Animated RideX logo on dark background
2. **Authentication Screen** — Login/Sign Up with phone OTP and social login
3. **Role Selection Screen** — Choose Passenger or Driver

### Passenger App Screens
4. **Passenger Home** — Map with "Where to?" search bar
5. **Destination Search** — Full-screen search with autocomplete
6. **Ride Options** — Economy / Comfort / Premium selection
7. **Ride Confirmation** — Fare breakdown, payment method, confirm
8. **Finding Driver** — Animated search state
9. **Active Ride** — Live tracking with driver info
10. **Ride Complete** — Rating and receipt
11. **Passenger Profile** — Profile, ride history, wallet, settings
12. **Ride History** — Full list of past rides
13. **Wallet** — Balance, top up, payment methods

### Driver App Screens
14. **Driver Home** — Demand map with earnings summary
15. **Incoming Request** — Accept/decline popup with countdown
16. **Active Trip** — Navigation view with passenger info
17. **Trip Complete** — Earnings summary
18. **Driver Earnings** — Dashboard with chart and history
19. **Driver Profile** — Profile, stats, settings

---

## Key User Flows

### Passenger Booking Flow
1. Auth screen → Role selection (Passenger) → Home map
2. Tap "Where to?" → Search destination → Select from list
3. View ride options (Economy/Comfort/Premium) → Select type
4. Confirm booking → Finding driver animation
5. Driver accepted → Active ride tracking
6. Arrive at destination → Rate driver → View receipt

### Driver Acceptance Flow
1. Auth screen → Role selection (Driver) → Driver home
2. Toggle Online → View demand map
3. Incoming request popup appears (10s countdown)
4. Accept → Navigate to pickup
5. Passenger picked up → Active trip navigation
6. Drop off → Trip complete → Earnings updated

---

## Navigation Structure

### Passenger Tab Bar
- **Home** (map icon) — Main booking screen
- **Activity** (clock icon) — Ride history
- **Wallet** (wallet icon) — Balance and payments
- **Profile** (person icon) — Account and settings

### Driver Tab Bar
- **Home** (home icon) — Demand map
- **Earnings** (chart icon) — Earnings dashboard
- **Trips** (car icon) — Trip history
- **Profile** (person icon) — Account and settings

---

## Component Design

### Map Component
- Dark grid background (#060c18 base)
- Subtle street grid (rgba white, 2-3% opacity)
- Cyan dotted route line with glow effect
- Green destination marker with pulse animation
- Blue current location marker
- Red/orange demand heat zones (driver mode)

### Ride Type Cards
- Glassmorphic dark cards (rgba white 5% opacity)
- Economy: gray accent, standard car icon
- Comfort: cyan accent, "POPULAR" badge, highlighted border
- Premium: purple accent, luxury car icon
- Selected state: glowing border + scale up

### Bottom Sheet
- Slides up from bottom with handle indicator
- Dark background with rounded top corners (24px)
- Dismissible by swipe down

### Buttons
- Primary CTA: Full-width, gradient cyan→blue, 56px height, 16px radius
- Danger: Red background (decline, emergency)
- Success: Green background (accept, confirm)
- Ghost: Transparent with border

### OTP Input
- 6 individual boxes, 48x56px each
- Rounded corners (12px)
- Cyan border on active box with glow
- Auto-advance on digit entry

---

## Animation Guidelines

- Page transitions: 300ms ease-out slide
- Bottom sheet: 350ms cubic-bezier spring
- Countdown timer: Circular progress, color shifts red at 5s
- Route line: Animated dash offset for "moving" effect
- Demand zones: Breathing pulse every 3s
- Button press: scale(0.97) 80ms
- Card entrance: fade + slide up 200ms
