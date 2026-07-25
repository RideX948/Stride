# RideX App - Development TODO

## Phase 1: Foundation & Design System
- [x] Configure theme colors (dark navy, cyan, green accents)
- [x] Update app branding (name, slug, logo)
- [x] Generate RideX app icon/logo
- [x] Set up navigation structure (passenger + driver flows)
- [x] Create shared components library

## Phase 2: Authentication
- [x] Login/Sign Up screen with tabs
- [x] Phone number input with country code
- [x] OTP verification (6-digit boxes)
- [x] Google sign-in integration (OAuth)
- [x] Auth state management
- [x] Secure token storage

## Phase 3: Role Selection & Onboarding
- [x] Role selection screen (Passenger / Driver)
- [x] Animated route preview on role screen
- [x] Onboarding flow for new users

## Phase 4: Passenger App
- [x] Home screen with map background
- [x] "Where to?" search bar
- [x] Destination input with recent places
- [x] Ride type selection (Economy / Comfort / Premium)
- [x] Fare estimation display
- [x] Book ride flow with tRPC mutation
- [x] Active ride tracking screen with progress simulation
- [x] Live ETA and distance display
- [x] Driver info card (name, rating, vehicle)
- [x] Call/Message/SOS action buttons
- [x] Ride completion & rating screen with tRPC mutation
- [x] Rating success state with auto-redirect
- [x] Passenger profile screen with logout
- [x] Ride history (activity screen)
- [x] Wallet balance & top up (UI)
- [x] Settings menu rows

## Phase 5: Driver App
- [x] Driver home screen with demand heat map
- [x] Online/Offline status toggle with tRPC mutation
- [x] Demand zone visualization (red/orange heat zones)
- [x] Incoming ride request popup with countdown timer
- [x] Auto-expire countdown (15 seconds)
- [x] Accept/Decline ride buttons
- [x] Incoming request screen with full ride details
- [x] Earnings dashboard with real tRPC data
- [x] Weekly earnings chart
- [x] Completed trips list
- [x] Payout history
- [x] Driver profile screen with working logout
- [x] Performance stats (rating, acceptance rate)
- [x] SOS/Emergency button

## Phase 6: Database Schema
- [x] Users table (passengers + drivers)
- [x] Rides table
- [x] Locations table
- [x] Payments table
- [x] Ratings table
- [x] Earnings table
- [x] Notifications table

## Phase 7: Backend API
- [x] Auth endpoints
- [x] Ride booking endpoints (rides.request)
- [x] Driver matching logic
- [x] Fare calculation
- [x] Earnings tracking (driver.earningsSummary)
- [x] Rating submission (rides.rate)
- [x] Driver online toggle (driver.toggleOnline)
- [x] Push notifications (notifications router)

## Phase 8: Real-time Features
- [x] Ride status progression simulation (tracking screen)
- [x] Driver-passenger messaging (UI)
- [x] SOS emergency button

## Phase 9: Polish & Production
- [x] App icon and splash screen
- [x] Loading states (ActivityIndicator on booking/rating)
- [x] Error handling (graceful fallback to demo mode)
- [x] TypeScript zero errors
