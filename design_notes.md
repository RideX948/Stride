# RideX UI Design Notes

## Color Palette
- Background: #060c18 (dark navy)
- Surface: #0f1a2e
- Surface2: #162035
- Primary (Passenger): #00c8ff (cyan blue)
- Primary (Driver): #00e887 (green)
- Foreground: #ffffff
- Muted: #8899aa
- Border: #1e3050
- Warning: #f59e0b
- Error: #ff4444
- Purple accent: #8844ff (Premium)

## Screens Built
### Passenger App
1. auth.tsx - Login/SignUp with OTP + social login
2. role-select.tsx - Choose Passenger or Driver
3. (passenger)/home.tsx - Map + destination + ride types
4. (passenger)/booking.tsx - Detailed ride options with fare
5. (passenger)/tracking.tsx - Live ride tracking
6. (passenger)/rating.tsx - Post-ride rating
7. (passenger)/activity.tsx - Ride history
8. (passenger)/wallet.tsx - Wallet + payments
9. (passenger)/profile.tsx - Profile + settings

### Driver App
1. (driver)/home.tsx - Demand heatmap + earnings + online toggle
2. (driver)/earnings.tsx - Weekly chart + trips + payouts
3. (driver)/trips.tsx - Trip history with filters
4. (driver)/profile.tsx - Driver profile + vehicle + settings
5. (driver)/incoming-request.tsx - Accept/decline popup with countdown

## Navigation Flow
auth.tsx → role-select.tsx → (passenger) or (driver)

## Key Design Patterns
- Glassmorphism cards with frosted glass effect
- Glowing neon lines for routes (cyan/green)
- Dark map with grid overlay
- Demand heatmap (red/orange gradients)
- Countdown ring for incoming requests
- Animated route lines with dots
