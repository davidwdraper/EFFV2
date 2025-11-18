This document is where the NowVibin brainstorming and ideas are logged
It is a random mix of ideas, design concepts, future branch offs.
Everything and anything that comes to mind.

ABREVIATIONS

Herein for brevitty we'll use abbreviations, defined here:
GF: geofence
TBT: to be determined (in the future)
WPA: when privacy allows (some functionality is privacy controlled)
\*: a line starting with '\*' is MVP functionality
\#: not MVP functionality if showing up within an MVP '\*' section

APP DISPLAY

- \*The app will only display in portrait mode. The reason is to keep the display consistent and not confuse how the act functions by the users that may change orientation.
- \*The display will have 3 regions regardless of physical display size.
- On large computer and laptop displays, the display will remain mobile first and remain in a centered portrait mode. This could change in future versions.

1. Dashboard (20%)
2. Content Area (60%)
3. Footer (20%)

#Dashboard
\*There will be 3 versions of the dashboard:

1. For anon users. Just a header area limited to branding and a hamburger menu.
2. Signed-in user with GF on: Full dashboard as define below.
3. Signed-in user with GF off. Dashboard visible, but mostly grayed out. A light overlay message will display enable "Enable Location Services to View" as a link. Note that everywhere throughout the app, there will be subtle messaging encouraging that GF remain on.

\*The dashboard will include but is not limited to:

- Total global users currently using the app (see below for definition of active using). This guage will not show until active users exceeds 200. Once 200 is achieved, it will always display thereafter for consistency.
- Total users currently using the app within the user's county
- Total live events within user's radius
- Total earned credit balance (see credit section). This guage will centered and larger than the rest like a tachometer in a race care. It will continually increase as a user interacts with the app.
- If a paid prem user member (non-lifer) remaining credits needed for zero balance monthly fee.
- If in a venue, count of other vibers (this may temporarily remove other guages). Visible heat guage.
- Mail icon with unread messages badge
- GF trip counter
- \#The bottom of the dashbard will have a horizontally scrolling one line newsfeed marquee. The marquee will be used for acknowloging Viber accomplishments, usage milestones, thank you's, etc. It will continuosly scroll and when the FIFO message queue gets to a certain size, messages will be removed based on a queue TTL.
- Viber's reliability score.
- \#Prem users will have the ability change the dashboard skins, that can change dial guages to bars, or digits, etc., along with different background styles.
- \#Dashboard guages will be designed with color gradients that can change realtime based on value.
- \#Dashboard guages will have a quick double pulse and color highlight when milestone values are hit.
- A standard hamburger menu providing access to (and not limited to):
  - Add Event
  - Invite a Viber
  - Acts
  - Places
  - Users
  - Settings
  - About
  - Contact
  - FAQs
- The menu items will show as large entries on a popup card for easy selection

\*USERS
Three types of users:

1. Anon users.

- Anyone who downloads the app and runs it will have an immediate view of events near them. No action required - no friction (there are caveats explained under event viewing).
- The page footer will be used for display ads.
- Interstitual ads will appear no more than one per 15 minutes of active app time per day.
- Usage hints will be spinkled between ads in the page footer. i.e., hinting at becoming a signed-in user.
- The hamburger menu is disabled.
- No configuration such as search radius will be available, except for act type and genre selectors.
- No credit accumlation.
- No GF functionality.

2. Viber

- All mention of users or members (same thing) will be Vibers. (user = Viber = member).
- Has to sign up with a minimum of name and email.
- No fees but the bottom footer will remain showing ads (but no interstituals)
- Some functionality will be limited - (i.e., no group creation)
- Can earn credits. Because there are no fees, all credits must be directed towards acts or lost.
- If a Viber upgrades to paid account, earned credits transfer over.
- Can be a member of a groups, but can't create a group.
- Can enable GF.

3. Prem Viber

- Same as a Viber, but no ads, and full functionality.
- $9.99 per month (could change) billed via Google or Apple (phone dependent)
- Credits can be fully or partially applied to offset the monthly fee.
- Credits value will be set to enable average engaged users to offset their entire monthly fee. The reason being is that app usage promotes app growth.
- Through special promotions and credit earning milestones, a user can become a Prem Viber lifer, with no fees for life.
- All non-anon Vibers start with a reliability index of zero. As there reliability improves, the data they enter is considered more reliable. Reliability discussed below.
- Users can, via email or text, send invites to their friends to join NowVibin. The acceptence of an invite entails the invitee creating an account. Each new Viber is seeded 50 credits, when accepting a friend invite, they get an additional 50 credits. If the invited user trips a GF within 60 days, the inviter gets another one-time additional 50 credits. This encourages participation. This bonus is subtly mentioned, along with timeout reminders, to the recipient.

\*PLACES

- Also referred to as venues, but venue is too restrictive a term within the app
- A physical location that may host an Event
- Must exist before an Event can be created.
- Place employees can be associated to the Place as NowVibin users.
- \#Will have an HTML web portal they can sign into for managing Events

\*GEOFENCING (GF)

- GF is foundational functionality and will be highly promoted.
- Will require Location Services turned on within their phone.
- If GF is not enabled, regardless of status (Viber or Prem Viber), much functionality will be disabled.
- User privacy respected if requested.
- At a minimum, eventId (includes Place and Act) and timestamp is persisted to DB. userId included if privacy setting allowed. Note that even though the userId may not be persisted, the user's GF count is incremented, and the earned credits are recorded.
- GF tripping counts are aggregated per user per month and a lifetime total.
- \#GF tripping will produce randomly different screen splashes and a Welcome to <VenueName> message. If the user is active, the message indicates a realtime event. If the user isn't active at the GF tripping time, the splash still occurs at the start of the next session speaks in past tense.
- \#Total time in a venue after GF trip is recorded. If no exit event fires, 60 minutes will be recorded as default. This value will eventually be replaced with average vist time gathered via analytics.
- Only one version of GF logic will be written to align with Apple's 22 fence restrictions.
- \#When a Viber is travelling, a push notification will notify when new events come into the established readius view (see below). Each notification will have a prevalent button to stop the travel notifications if not desired.
- \#WPA, Vibers will accumulate badges and credits for GF tripping.
- \#WPA, Vibers that own or belong to groups that follow an act that the Viber is currently attenting, will be notified.
- \#Acts will be messaged with total GF counts after each event, and encouraged to promote their fans for greater GF tournouts to continue the flywheel spinning.
- \#Vibers who tripped GFs, will be messaged in the page footer once the Act they attended has been notified.
- \#Acts will be encouraged to send a out a thankyou to the GF attendees, or opt for an auto-send.
- \#GF tripping earns users merch credits, which are seperate than credits used for gifting the Acts. They will be used to exchange for merch.

\*CREDITS

- Credits is foundational functionality and fuels the Act funnel.
- Credits are earned by (and when):
  - A Viber is engaged with app (app engagement defined below) - 1 credit per 15 minutes.
  - A click of any UI element (2sec timer guard) - 1 credit per click
  - Inviting a friend who accepts and signs up - 20 credits.
  - Entering an act that results in an Event - 50 credits (12 month TTL before revoked if no event - also results in Act removal)
  - Tripping a GF - 20 credits
  - Tripping a GF with a group crew - 5 credits per crew member. Crew also gets their own 5 credits each over-and-above their own GF trip. This rewards group attendance.
  - Verifying a user entered Act or Event - 3 credits
  - Questioning a user entered Act or Event - 2 credits
  - Adding a photo to an act or event record - 2 credits per photo.
  - Voting on a photo (photes are pruned based on voting) - 1 credit per vote (6 max per day)
- Each earned credit creates a backend Credit record, with userId, reason, token count, datetime.
- Each earned credit results in dashboard updates (non-anom only)
- Credits can be applied to prem-user monthly fees.
- Residual fees, or any number can be gifted to Acts. Members that are paying their fees and in good standing can choose to gift all the credits, and pay their fees over-and-above.
- At the beginning of a user session, the credit display will be initialized from the backend.
- Credits earned as a result of UI events be displayed on the credit guage realtime.
- Credits earned will be batched and sent to the server once per 15 seconds. The send response will be used to reset the count in case backend processing has altered it.
- Credits will have a dollar value, but are not redeemable by Users. The value floats based on the business monthly net revenue and the outstanding earned credits. The comapny will set at its sole discretion what perscentage of profit turned into token value - typically it won't be less than 10%.

\*CROWD SOURCING

- Any Viber or Prem Viber can seed (enter): Act, Place and Event data.
- All data is entered with a reliability score. The starting reliability of data entered is proportional to the user's reliability entering it.
- Personal reliability scores are earned, not assigned.
- When data is considered totally accurate it's designated reliable.
- If an Act member or Place member enters an Event, its immediatly considered reliable, everything else starts out as 'not verified'.
- For 'not verified' data, the data has a 'Verify' and 'Doubt' button beside it. There is also a reliability analog guage.
- Once three users click 'Verify', the data is considered reliable and no further action is required. At which point he 'Verify' and 'Doubt' buttons are removed.
- Each 'Verify' click is +1, and each 'Doubt' click is -1.
- If the reliability becomes <= -2, the data is hidden and the user responsible for entering it is messaged.
- Entering data that becomes reliable, increases a user's reliablilty score by +5.
- Clicking a 'Verify' button on data that ultimately is not reliable (false positive), decreases a users reliability by 1.
- Clicking a 'Doubt' button on data that ultimately becomes reliable (false negative), decreases a users reliability by 1.
- Correctly clicking 'Verify' or 'Doubt' result in +1 for a user's reliablity.
- Users who become -5 on reliability can no longer enter data, verify or doubt that of others.
- Users with a reliability of >= 10, can enter data that is immediatly considered reliable, and the 'Verify' and 'Doubt' buttons do not show.
- Users can associate themselves as Act members. The assoication is tagged with a 'Verify' and 'Doubt' button. If someone falsly assoicates themselves with an Act, they are suspended pending a review.
- Members of an Act, can flag an Event as reliable, removing the need for the 'Verify' and 'Doubt' buttons.
- All free text entered will be checked for profanity and tone. Anything not passing, won't be shown and the user that entered it will be notified with the reason. This will lower the user's reliability score by 1.
  Tone checking will remove political, religous, hate and any other controversial societal topics.

DATA VIEWING

- The reason for NowVibin's existene is the displaying of Events that may be of interest to the user.
- Events can be anything that is scheduled (non-routine) for their patrons interest. This can be any kind of live entertainment, activities or specials. (i.e., a band gig or a re-curring happy hour). Retail sales, general one-off sales, don't qualify.
- Events will be shown as a list or a map.
- Events will be shown within a 5 mile radius from the user's current phone location.
- For Prem Vibers, the location can be set to other locations for travel planning.
- The 5 mile radius can be zoomed in or out for Prem Vibers. In highly congested entertainment corridors, Events within 1/4 mile will be possible for finding Places with walking access.
- At the top of the display, for either list or map views, there will be a display row with:
  - Event Type Selector (Live music, comedy, theatre, bowling, etc.. Default is all)
  - Event Subtype Selector (i.e., if Live music is seleted, it will be a genre selector. Default is all.)
  - Act Selector (find a specific Act - this disables the radius restriction)
  - Place Selector (find a specific Place - this disables the radius restriction)
- All selectors will be a popup card for easy selection as appossed to a dropdown control.
- List view Events are sorted by date (most current first, followed by distance from origin).
- Map view Events are shown as pins on map. Zooming in will be enabled for for normal Viber users. There is a calendar icon in top right corner of the map to pick an Event date. Only current date forward are selectable.
- An Event item on a list will show a small Act and/or Place icon, Place name, Act name, Place address, Event date & time, plus a message if provided.
- If an Event is clicked from the list view, a detailed Event card is displayed.
- On a map, the event is represented by an icon. If the icon is clicked, the same Event card is displayed as for the list view.
- Each event card will have an RSVP button. This button does not hold the user accountable for attending, but shows the Event managers the general interest for the event. The reliability of the RSVP is the average of each user's reliability attendance score. Users that click RSVP and trip the Event's GF, get 50 extra credits plus a reliability increase.

MESSAGING

- There are four ways for messaging:

1. OS push notifications. System generated. Individual or grouped.
2. DM with envelope icon and unread message count badge. Both system and user-to-user, or user-to-group - WPA.
3. Main page footer messages. System generated.
4. Dashboard horizontal scrolling newsfeed marquee.

- After selecting the envelop icon, a message card show in date descending order all the message subject lines for the past 30 days. Messages older than 30 days are deleted. Unread message subject lines are bold. When clicked, the message appears in a popup, and the subject line goes to non-bold.

CREDIT GIFTING

- Credits are used to:

1. Pay Prem Viber fees
2. Gift Acts

- A user can offset as much of the monthly Prem Viber fee as he/she wishes, or gift it all to Acts.
- If a user collects enough credits to cover his full $9.99 fee, NowVibin will gift the credit back to the User so that it can be applied to Act gifting.
- When credits are earned, they are timestamped. They have a lifetime of 60 days, rounded up to the next month end.
- Credits not utilzied are lost after their lifetime expires.
- Credits gifted to Acts is aggregated and payed monthly using a TBT money transfer service providing an API.

MILESTONES

- The app will be big on acknowledging and displaying accomplishments. When an Act is in the top 5 for gifting within a county region, it will show on the Acts display card, and in the dashboard marquee.
- more to come

STARTUP

- Pre-startup, data scraping will target the initial startup region, which will most likely be Burbank, CA.
- Scraping will work in parallel with MVP development.
- After MVP and before launch, Places will be approached to help fund the credit system for 90 days prior to profit.
- Worst case scenario for credit system funding will be helping the local Acts. Sponsores will get recognition.
- User that sign up within the first 90 days will become Prem Lite Vibers. That provides them all the privilege of a Prem Viber without the cost.
- If they sign up within the first 90 days, and earn 200 credits within 60 days, they become lifetime Prem Vibers with no fees.
- Based on scraping results, Acts will be contacted and encouraged to join and bring on their fan base.
