# Design rules (portal and mobile app)

Calm and plain. Each screen has one thing that stands out, and it stands out by contrast with everything around it, not by decoration.

## Tokens

| Token | Value | Use |
|---|---|---|
| `bg` | `#FFFFFF` | every screen |
| `ink` | `#14140F` | text, rules, primary button fill |
| `muted` | `#55554D` | secondary text, struck-through regular price |
| `line` | `#D9D9D2` | dividers, input borders |
| `accent` | `#FFD23F` | one element per screen at most |
| `danger` | `#B3261E` | errors and destructive confirmation only |

- Text on `accent` is always `ink`. Never white on yellow.
- No other colors. No gradients, no shadows, no tinted cards.

## Type

- Web: Schibsted Grotesk (400, 700, 800). Mobile: the same via `@expo-google-fonts/schibsted-grotesk`, or the system font if that is a problem in Expo Go.
- Sizes: 13 (fine print), 16 (body), 20 (item titles), 32 (the screen's main figure), 44 (pickup code only).
- Weight carries emphasis: 800 for the one main figure, 700 for titles, 400 for the rest. No italics, no all-caps labels, no letter-spaced headings.

## Layout

- Spacing steps: 4, 8, 16, 24, 40.
- Lists are rows separated by a 1px `line`, not cards. Corner radius 6 on buttons and inputs, 0 elsewhere.
- One column. Portal content max width 640px, centered.
- Touch targets at least 44px high.
- Icons only where a word would not fit (back, close). No emoji, no illustrations.

## Contrast: what stands out on each screen

| Screen | The one emphasized thing | How |
|---|---|---|
| Sign up / sign in (both) | the form's one primary button | nothing else filled; the other mode is a text link under it |
| Deals map (mobile) | the selected store | markers are `ink`; the selected one is `accent` with a row for its deal at the bottom of the screen |
| Notifications (mobile) | unread items | unread title in 700, read in 400 `muted`. No colored dots |
| Deal list (mobile) | deal price | 20/800 `ink`, beside the regular price in 13 `muted` struck through |
| Deal detail (mobile) | deal price, then the Reserve button | price 32/800; button is the only filled element |
| Reservation (mobile) | pickup code | 44/800 on an `accent` block; nothing else on the screen is colored |
| New listing (portal) | the text box | the only bordered element above the fold |
| Draft review (portal) | fields the merchant must fill | missing fields get an `accent` background; filled fields have none |
| Today (portal) | a suggestion if there is one, otherwise reservations waiting for pickup | the suggestion is one row on an `accent` background with Accept and Dismiss; the waiting count is 32/800 |
| Summary (portal) | amount recovered tonight | 32/800, with "If discarded: $0.00" directly under it in 16 `muted` |

If two things on a screen compete, make one of them smaller.

## Buttons

- Primary: `ink` fill, white text. One per screen.
- Secondary: no fill, 1px `ink` border.
- Destructive actions (cancel deal, cancel reservation) are secondary buttons that ask for confirmation.
- Disable a button while its request is in flight.

## States

Every screen that loads data has four states: loading (plain text "Loading…"), empty, error, loaded.

- Empty deal list: "No deals right now. Most go up in the late afternoon."
- Error: show the API's `message` as is, with a "Try again" button.
- Location denied: the list loads sorted by ending soon, with one line "Turn on location to sort by distance." The map centers on downtown State College.
- Distance: "0.3 mi". Hide it when `distance_m` is null.
- A suggestion's message is shown as the API sends it. Under it, in 13 `muted`: "Based on reservations so far."
- A blocked customer sees the API's message on the reserve screen and no Reserve button.
- Sold out: the row stays visible in `muted` with "Sold out" in place of the price.

## Copy

- Short, literal, sentence case. No exclamation marks.
- Say what happens: "Reserve", "Approve and publish", "Mark as picked up".
- Times as "until 6:00 PM". Prices as "$4.00".
- The estimate on a draft is labeled "Estimate, assuming 60% sells".
- Never "leftover", "expiring", "waste", "about to be thrown out". Use "available today", "limited quantity", "until 6:00 PM".
- Allergen field label: "Allergens (you must confirm)". The reservation screen shows the merchant's allergen list and "Ask the store if you have an allergy."
