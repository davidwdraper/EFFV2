# ideas-and-features.md (Compression)

This doc represents the evolving user-facing + UX + engagement feature set.

---

## Abbreviations

- GF (geofence)
- TBT
- WPA
- - (MVP)
- # (future)

---

## APP DISPLAY

### Display Constraints

- Portrait only (MVP)
- Three regions: Dashboard, Content, Footer
- Desktop = centered mobile portrait

---

## DASHBOARD

### Dashboard Variants

1. Anonymous user
2. Signed-in w/ GF on
3. Signed-in w/ GF off

### Dashboard Elements (MVP + Future)

- Global active users
- County active users
- Live events near user
- Credit balance (tachometer)
- Remaining credits for fee offset
- Venue count (if inside venue)
- Mail icon w/ unread
- GF trip counter
- # Newsfeed marquee
- Reliability score
- # Dashboard skins & animation

### Hamburger Menu

- Add Event
- Invite
- Acts
- Places
- Users
- Settings
- About
- Contact
- FAQs

---

## USERS

### 1. Anonymous Users (MVP)

- No login required
- Ads shown
- Limited filters
- No GF
- No credits
- Menu disabled

### 2. Viber (signed-in)

- No fee
- Ads in footer only
- Earn credits
- Join groups (but not create)
- GF enabled

### 3. Prem Viber

- Full functionality
- No ads
- Credits can offset fees
- Can become lifetime free
- Reliability index initialized to zero
- Invite system w/ credit rewards

---

## PLACES (Venues)

- Must exist before Events
- Employees can be linked
- # Web portal in future

---

## GEOFENCING (GF)

### Core

- Foundational feature
- Requires device location
- Many UI behaviors gated on GF
- GF trips are persisted (eventId, timestamp, optional userId)

### Aggregation

- Monthly + lifetime trip counts

### UX

- # Splash screens per trip
- # Time-in-venue tracking
- # Travel notifications
- # Badges, credits
- # Group attendance notifications
- # Act → attendee messaging
- # Attendee → act messages
- # Merch credits

---

## CREDITS

### Earning Credits

- Engagement time
- UI clicks
- Invites accepted
- Act added → event created
- GF trips
- Group GF bonus
- Verifications
- Doubts
- Photo adds & votes

### Credit Lifecycle

- Each credit logged as a record
- Batched send
- 60-day lifespan (rounded up)
- Can offset subscription fees
- Can gift to Acts

### Credit Economics

- Dollar value floats with revenue
- Users cannot redeem for cash

---

## CROWD SOURCING (Data Reliability)

### Seedable Entities

- Acts
- Places
- Events

### Reliability System

- Data starts as “not verified”
- Buttons: Verify / Doubt
- Scores: +1 / -1 / thresholds
- Auto-hide with low score
- Act members can auto-verify
- Reliability rewards/punishments
- Profanity & tone filtering

---

## DATA VIEWING

### Purpose

- Show events that matter to user

### Display Modes

- List
- Map

### Radius Rules

- Default 5 miles
- Prem Vibers can change radius
- Act/Place selector overrides radius

### Filters

- Event type
- Subtype
- Act
- Place

### Event Cards

- RSVP system with reliability influence

---

## MESSAGING

### Channels

1. Push notifications
2. DM (user ↔ user, groups WPA)
3. Footer messages
4. Dashboard marquee

### Message List View

- 30-day retention
- Bold unread
- Popup detail

---

## CREDIT GIFTING

- Used to:

  1. Pay subscription
  2. Gift Acts

- Lifetime rules for credits
- Monthly payout to Acts (TBT provider)

---

## MILESTONES

- Achievements displayed
- Act ranking (top 5 gifting)
- Dashboard marquee announcements

---

## STARTUP PLAN

- Region scraping (Burbank first)
- Parallel scraping + MVP dev
- Venue sponsorship pre-launch
- Prem Lite for early adopters
- Early users can earn lifetime Prem
- Act onboarding after scraping phase
