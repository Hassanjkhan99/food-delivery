# Restaurant Console — User Journeys & Flows

Surface for restaurant owners and kitchen staff. Route group `apps/web/src/app/restaurant/`
(root `/restaurant` redirects to `/restaurant/orders`). Shares one backend with
[customer](customer.md) and [rider](rider.md); the order lifecycle & realtime channels live in the
[shared reference](README.md#shared-reference-the-order-lifecycle-the-spine-that-connects-all-three-apps).

- [App mindmap](#app-mindmap)
- [Roles & access](#roles--access)
- [Page-by-page reference](#page-by-page-reference)
- [Key journeys](#key-journeys)
- [Cross-role hand-offs](#cross-role-hand-offs)
- [QA checklist](#qa-checklist)
- [Gaps & open issues](#gaps--open-issues)

---

## App mindmap

```mermaid
mindmap
  root((Restaurant console))
    Operations
      Orders board /orders
        Accept + prep ETA
        Reject + reason
        Start preparing
        Mark ready
        Assign rider
        Mark collected (pickup)
        86 an item
        Busy mode buffer
        Print kitchen ticket
      Today /today (KPIs)
    Menu
      Menu /menu
        Categories / items
        Modifier groups + options
        Combos / meal deals
        Photos, badges, availability
        Publish draft to live
        Layout mode
      Import /menu/import
        Upload photo/PDF
        Transcribe items
        CSV preview + import
    Onboarding
      Onboarding /onboarding
      Verification KYC /verification
    Business
      Branding /branding (theme)
      Campaigns /campaigns (featured / deal)
      Promo codes /promo-codes
      Analytics /analytics
      Reviews /reviews (reply)
    Money
      Wallet /wallet (balance, ledger, payout)
      Settlements /settlements (CSV, eIMS)
    People
      Riders /riders (invite roster)
      Staff /staff (owner-only)
      Support /support (tickets)
    Settings /settings
      Accepting toggle
      Hours
      Commercials (min order, fee, radius)
      Shared-rider policy
```

---

## Roles & access

| Role               | Can see                                                                |
| ------------------ | ---------------------------------------------------------------------- |
| `restaurant_owner` | Everything                                                             |
| `restaurant_staff` | **Orders + Today only** (menu, money, staff, settings hidden)          |
| `admin`            | Approval queues (restaurant, KYC, campaign, rider) — see admin console |

Nav is gated in `layout.tsx` (`isOwner ? NAV : NAV.filter(staff)`) and resolvers assert
`restaurantMember` / `assertBranchMember`. Menu editing/import, branch hours, and rider invite are now
**owner-enforced at the resolver** via `assertBranchOwner` (and the menu pages block staff on direct
URL), so nav-hiding is no longer the only barrier for those ([#204](https://github.com/Hassanjkhan99/food-delivery/issues/204)).
⚠️ A full audit of the remaining owner-only surfaces (branding/theme, campaigns, promo-codes, and the
read-only wallet/settlements/analytics/reviews views) is still open under
[#204](https://github.com/Hassanjkhan99/food-delivery/issues/204) — treat those as "hidden from staff
in the sidebar" until their resolvers assert ownership. Unbuilt-restaurant users are redirected to
onboarding.

---

## Page-by-page reference

Legend: **Q** query, **M** mutation, **S** subscription.

### 1. Orders board — `/restaurant/orders`

**Purpose:** Live kitchen queue — the operational heart of the console.

**Layout:** 6 lanes — **Scheduled → New → Preparing → Ready → Out → Recent**.

| Element / action                      | Operation                                                    | Backend effect                                                                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Load board                            | **Q** `boardOrders(branchId, statuses)`                      | Orders grouped into lanes                                                                                                                                                                      |
| Live new-order push                   | **S** `branchOrderFeed(branchId)`                            | Refetch on any change; 30s fallback poll                                                                                                                                                       |
| New-order alarm                       | `useOrderAlarm` (client)                                     | Sound + tab flash + banner when pending count rises                                                                                                                                            |
| **Accept** (AcceptSheet → prep chips) | **M** `acceptOrder(id, prepEtaMinutes)`                      | `pending_acceptance → accepted`; ETA set; 🔗 customer sees "Accepted"                                                                                                                          |
| **Reject** (RejectSheet → reason)     | **M** `rejectOrder(id, reason)`                              | `→ rejected`; refund path                                                                                                                                                                      |
| Start preparing                       | **M** `startPreparing(id)`                                   | `accepted → preparing`                                                                                                                                                                         |
| **Mark ready**                        | **M** `markReady(id)`                                        | `preparing → ready_for_pickup` **only** (not valid directly from `accepted`). Does **not** create a DeliveryTask — dispatch is a separate step below. For pickup orders, shows the pickup code |
| Assign rider (dropdown, delivery)     | **M** `assignRider(orderId, riderId)`                        | Creates/assigns the `DeliveryTask` to a roster rider → `rider_assigned`; 🔗 [rider job](rider.md#job-lifecycle). (Offer-based dispatch uses `offerTask` / `generateSharedOffers`.)             |
| Mark collected (pickup)               | **M** `markCollected(id)`                                    | Pickup terminal                                                                                                                                                                                |
| 86 an item (EightySixSheet)           | **M** `setItemAvailability(itemId, available:false, until?)` | Item hidden from customer menu + cart validation; optional auto-restore                                                                                                                        |
| Restock a 86'd item                   | **M** `setItemAvailability(itemId, available:true)`          | Staff-accessible "86'd items" panel (from **Q** `branchUnavailableItems`) flips indefinitely-86'd items back on without the owner-only menu page                                               |
| Busy mode +10/20/30/clear             | **M** `setBusyMode(branchId, bufferMinutes)`                 | Buffer added to all prep ETAs customer sees                                                                                                                                                    |
| Print ticket                          | client `printKitchenTicket`                                  | —                                                                                                                                                                                              |

**Card shows:** code, payment badge (COD/PAID), total, customer name, fulfillment + scheduled badge,
items, per-line unavailability preference, customer phone (if "contact me"), note, "no cutlery" flag.

**Guards/states:** **only** the no-restaurant case shows the onboarding link — `myRestaurants` returns
the caller's restaurants regardless of approval status, so a `pending_approval` owner still sees the
live board shell (⚠️ no distinct "Complete onboarding / awaiting approval" board state today); paused →
red "Not accepting orders" badge; empty lanes show "(0)".

```mermaid
stateDiagram-v2
    [*] --> New : branchOrderFeed (customer placeOrder)
    New --> Preparing : acceptOrder + startPreparing
    New --> Recent : rejectOrder / auto_expired
    Preparing --> Ready : markReady
    Ready --> Recent : markCollected (pickup)
    Ready --> Out : assignRider / offerTask → task → rider accepts
    Out --> Recent : rider delivered
```

### 2. Today — `/restaurant/today`

**Q** `todaySummary(branchId)` → Orders count, Revenue (accepted), Acceptance %, Top items (5).
Polls every 30s. Empty → "No items sold yet today."

### 3. Menu — `/restaurant/menu`

**Purpose:** Edit the **draft** menu, then publish it live.

| Action                            | Operation                                                         |
| --------------------------------- | ----------------------------------------------------------------- |
| Load draft                        | **Q** `draftMenu(branchId)`                                       |
| Category upsert / (delete via UI) | **M** `upsertCategory`                                            |
| Item upsert / delete              | **M** `upsertMenuItem` / `deleteMenuItem`                         |
| Item availability                 | **M** `setItemAvailability`                                       |
| Item photo                        | **M** `setMenuItemPhoto` (after `presignUpload`→`finalizeUpload`) |
| Modifier group upsert / delete    | **M** `upsertModifierGroup` / `deleteModifierGroup`               |
| Modifier option upsert / delete   | **M** `upsertModifierOption` / `deleteModifierOption`             |
| Combo upsert / delete             | **M** `upsertCombo` / `deleteCombo`                               |
| Combo items                       | **M** `addComboItem` / `removeComboItem` / `setComboAvailability` |
| Layout mode                       | **M** `updateMenuLayout(branchId, layoutJson)`                    |
| **Publish**                       | **M** `publishMenu(branchId)` → clones draft to live              |

**Guard:** modifiers/combos require the item to be **saved first**. ⚠️ `setBranchHours` /
`submitOnboarding` relation-return bug tracked in
[#151](https://github.com/Hassanjkhan99/food-delivery/issues/151).

### 4. Menu import — `/restaurant/menu/import`

| Action                           | Operation                                                                        |
| -------------------------------- | -------------------------------------------------------------------------------- |
| Upload photo/PDF reference       | **M** `registerMenuSourceDoc(branchId, assetId, kind)` (+ `menuSourceDocs` list) |
| Transcribe item / quick category | **M** `upsertMenuItem` / `upsertCategory`                                        |
| CSV preview                      | **M** `previewMenuCsv(assetId)` (validates rows)                                 |
| CSV import                       | **M** `importMenuCsvToDraft(branchId, assetId)` → `{created, updated}`           |

⚠️ Automatic OCR of photo/PDF menus is **not built** —
[#177](https://github.com/Hassanjkhan99/food-delivery/issues/177),
[#23](https://github.com/Hassanjkhan99/food-delivery/issues/23).

### 5. Onboarding — `/restaurant/onboarding`

**M** `submitOnboarding(name, addressText, lat, lng, minOrderMinor, deliveryFeeMinor,
deliveryRadiusM)` → creates restaurant + branch (`pending_approval`). Location is pinned to
`DEFAULT_LOCATION` in the pilot. Success → "Set up my menu" CTA (menu editable before approval).

### 6. Verification (KYC) — `/restaurant/verification` (owner-only)

**Q** `restaurantKyc(restaurantId)`; **M** `submitKyc(...ownerName, ownerCnic, bankAccountName,
bankIban, cnicAssetId)`. Status: submitted → approved/rejected (admin). **KYC is now enforced as a
payout gate** — `requestPayout` throws `kyc_not_approved` unless `RestaurantKyc.status === "approved"`,
in addition to the owner / single-pending / Rs 1,000-minimum checks
([#203](https://github.com/Hassanjkhan99/food-delivery/issues/203); broader PRA/tax pack
[#18](https://github.com/Hassanjkhan99/food-delivery/issues/18)).

### 7. Settings — `/restaurant/settings`

| Action              | Operation                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pause/resume        | **M** `setAcceptingOrders(branchId, accepting)`                                                                                                   |
| Hours (per day)     | **M** `setBranchHours(branchId, hours[])`                                                                                                         |
| Name + cuisine tags | **M** `updateRestaurantProfile(restaurantId, name, cuisineTags)`                                                                                  |
| Commercials         | **M** `updateBranchCommercials(branchId, minOrderMinor, deliveryFeeMinor, deliveryRadiusM)`                                                       |
| Shared-rider policy | **M** `setSharedRiderPolicy(restaurantId, sharingEnabled, maxActiveJobs, maxIncrementalDelaySec, maxPickupMeters, codTrustThreshold, vetoActive)` |

⚠️ Hours **enforcement** (block ordering when closed) is [#19](https://github.com/Hassanjkhan99/food-delivery/issues/19) / [#63](https://github.com/Hassanjkhan99/food-delivery/issues/63).

### 8. Analytics — `/restaurant/analytics`

**Q** `restaurantAnalytics(branchId, days)` → KPIs (orders, revenue, AOV, avg accept time, repeat %),
charts (by day-of-week, by hour, revenue/day, accept-time trend), top/bottom items, cancellation
reasons.

### 9. Reviews — `/restaurant/reviews`

**Q** `restaurantReviews(restaurantId, limit, offset)`; **M** `respondToRating(ratingId, body)` (public
reply). 🔗 Ratings originate from [Customer › rate order](customer.md#8-order-tracking--ordersid).
⚠️ Deeper analytics + review responses epic [#61](https://github.com/Hassanjkhan99/food-delivery/issues/61).

### 10. Branding — `/restaurant/branding`

**Q** theme via `branchBySlug`; **M** `updateTheme(restaurantId, primaryColor, accentColor,
backgroundColor, textColor, fontKey, cardStyle, heroEffect, logoAssetId, heroAssetId)`. Live preview +
WCAG-AA contrast warning. Theme renders on the [customer restaurant page](customer.md#3-restaurant-detail--rslug).

### 11. Campaigns — `/restaurant/campaigns`

**Q** `myCampaigns`, `featuredSlotRate`, `walletBalance`; **M** `createCampaign` → `submitCampaign`
(wallet-balance-gated) → admin approves → `approveCampaign`/`rejectCampaign`; `cancelCampaign`. Types:
featured slot (home feed) / deal badge.

### 12. Promo codes — `/restaurant/promo-codes`

**Q** `restaurantVouchers`; **M** `createRestaurantVoucher(...type: percentage/fixed/free_delivery)`,
`setRestaurantVoucherActive`. Restaurant-funded; applied at [customer checkout](customer.md#6-checkout--checkout).

### 13. Riders — `/restaurant/riders`

**Q** `branchRiders(branchId)`; **M** `inviteRider(branchId, name, phone)`. Roster shows online status,
type, verification, trust score. Invited riders sign in via OTP and appear in the
[rider app](rider.md). Assignment happens on the [orders board](#1-orders-board--restaurantorders).

### 14. Wallet — `/restaurant/wallet`

**Q** `walletBalance`, `walletStatement`, `payoutHistory`; **M** `requestPayout(restaurantId)`
(min Rs 1,000, one pending at a time). Negative balance explained (COD platform fees > card earnings).

### 15. Settlements — `/restaurant/settlements`

**Q** `settlementReportCsv(restaurantId, from, to)`, `eimsInvoiceCsv(branchId, from, to)` → CSV
downloads. ⚠️ PRA/eIMS compliance pack [#18](https://github.com/Hassanjkhan99/food-delivery/issues/18).

### 16. Staff — `/restaurant/staff` (owner-only)

**Q** `restaurantStaff`; **M** `inviteStaff(restaurantId, phone, name)`, `removeStaff`. Staff get
Orders + Today access only.

### 17. Support — `/restaurant/support` (owner-only)

**Q** `restaurantTickets(restaurantId)`; **M** `respondToTicket(ticketId, body)` (**owner-only** — the
reply is customer-visible, so staff can't publish one). 🔗 Tickets come from
[Customer › order help](customer.md#10-order-help--helporderid). The reply (`restaurantResponse`) **is
now surfaced to the customer** on `/help/[orderId]` (the `OrderHelp` query reads `restaurantResponse` /
`restaurantRespondedAt` and renders a "Reply from the restaurant" block)
([#205](https://github.com/Hassanjkhan99/food-delivery/issues/205)).

---

## Key journeys

### Order fulfilment (accept → hand to rider)

```mermaid
flowchart TD
    NEW([New order lane<br/>branchOrderFeed]) --> DEC{Accept?}
    DEC -->|Reject + reason| REJ[rejectOrder → refund] --> RECENT([Recent])
    DEC -->|Accept + prep ETA| ACC[acceptOrder]
    ACC --> PREP[startPreparing]
    PREP --> RDY[markReady → ready_for_pickup]
    RDY --> MODE{Fulfillment}
    MODE -->|Pickup| COL[Show pickup code → markCollected] --> RECENT
    MODE -->|Delivery| DISP{Dispatch creates DeliveryTask}
    DISP -->|offerTask| RIDER[🔗 rider acceptTask]
    DISP -->|manual| ASSIGN[assignRider from roster]
    RIDER --> OUT([Out lane])
    ASSIGN --> OUT
    OUT -->|rider delivered| RECENT
```

### Onboarding → live → payout-eligible

```mermaid
flowchart LR
    ON[submitOnboarding<br/>pending_approval] --> MENU[Build draft menu<br/>+ import]
    MENU --> APPROVE{Admin approveRestaurant}
    APPROVE -->|approved| LIVE[Accept orders]
    LIVE --> KYC[submitKyc]
    KYC --> KREV{Admin reviewKyc}
    KREV -->|approved| PAYOUT[requestPayout enabled]
    KREV -->|rejected| KYC
```

---

## Cross-role hand-offs

| Restaurant action                      | Triggers                                 | Where                                                                                                                 |
| -------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `acceptOrder` / `rejectOrder`          | `orderStatus`                            | 🔗 [Customer tracking](customer.md#8-order-tracking--ordersid)                                                        |
| `markReady` (delivery)                 | order `→ ready_for_pickup` (no task yet) | 🔗 [Customer tracking](customer.md#8-order-tracking--ordersid)                                                        |
| `assignRider` / `offerTask` (dispatch) | creates DeliveryTask → `riderJobFeed`    | 🔗 [Rider offer/home](rider.md#job-lifecycle) & [job detail](rider.md#2-job-detail--active-delivery--riderjobstaskid) |
| `setItemAvailability` (86)             | menu updated                             | 🔗 [Customer menu / cart validation](customer.md#3-restaurant-detail--rslug)                                          |
| `respondToRating`                      | public reply published                   | 🔗 [Customer reviews](customer.md#4-restaurant-reviews--rslugreviews) (shown to customers)                            |
| `respondToTicket`                      | reply shown to the customer              | 🔗 [Customer order help](customer.md#10-order-help--helporderid)                                                      |
| `inviteRider`                          | rider account created                    | 🔗 [Rider app](rider.md)                                                                                              |

---

## QA checklist

**Orders board (highest priority — this is live money)**

- [ ] New order fires sound + banner and lands in "New" with an accept countdown.
- [ ] Accept applies busy-mode buffer to the ETA the customer sees.
- [ ] Reject with a reason refunds the customer and moves to "Recent".
- [ ] `markReady` moves the order to `ready_for_pickup`; **dispatch is a separate step** — `assignRider`
      (or `offerTask`) creates the delivery task and it appears as a rider offer within seconds.
- [ ] Pickup order shows a pickup code and `markCollected` closes it (no rider involved).
- [ ] Manual `assignRider` works when no auto-offer is accepted.
- [ ] 86-ing an item removes it from the live customer menu immediately and (if `until`) restores it.
- [ ] Board recovers state after a dropped subscription (30s poll).
- [ ] Staff role sees only Orders + Today.

**Menu**

- [ ] Draft edits are not visible to customers until `publishMenu`.
- [ ] Can't attach a modifier/combo item to an unsaved item.
- [ ] CSV preview flags bad rows; import reports created/updated counts.

**Onboarding / KYC / money**

- [ ] Menu editable while `pending_approval`; ordering blocked until approved.
- [ ] Payout requires **approved KYC** + balance ≥ Rs 1,000 + only one pending payout; a restaurant
      without approved KYC gets `kyc_not_approved` ([#203](https://github.com/Hassanjkhan99/food-delivery/issues/203)).
- [ ] Staff (non-owner) cannot open the menu / import pages by direct URL, and menu/hours/rider-invite
      mutations reject non-owners ([#204](https://github.com/Hassanjkhan99/food-delivery/issues/204)).
- [ ] Settlement + eIMS CSVs download for a date range (empty range = valid empty CSV).

---

## Gaps & open issues

| Area                                                                                                             | Status      | Issue                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Menu OCR (photo/PDF → items)                                                                                     | not built   | [#177](https://github.com/Hassanjkhan99/food-delivery/issues/177), [#23](https://github.com/Hassanjkhan99/food-delivery/issues/23)   |
| Mutation-return relation resolves fail (`submitOnboarding.branches`, `setBranchHours.hours`) + COD wallet sanity | **bug**     | [#151](https://github.com/Hassanjkhan99/food-delivery/issues/151)                                                                    |
| Console v2 (live kitchen control)                                                                                | P0 umbrella | [#46](https://github.com/Hassanjkhan99/food-delivery/issues/46)                                                                      |
| Hours enforcement + holiday/pause schedule                                                                       | P1          | [#19](https://github.com/Hassanjkhan99/food-delivery/issues/19)                                                                      |
| Block ordering from closed branches                                                                              | **bug**     | [#63](https://github.com/Hassanjkhan99/food-delivery/issues/63)                                                                      |
| Modifier group editor depth                                                                                      | P1          | [#20](https://github.com/Hassanjkhan99/food-delivery/issues/20)                                                                      |
| Combos / meal deals / item offers                                                                                | P1          | [#53](https://github.com/Hassanjkhan99/food-delivery/issues/53)                                                                      |
| Vendor review responses + deeper analytics                                                                       | P2          | [#61](https://github.com/Hassanjkhan99/food-delivery/issues/61)                                                                      |
| Dispatch policy controls (dedicated vs external riders)                                                          | epic        | [#103](https://github.com/Hassanjkhan99/food-delivery/issues/103)                                                                    |
| PRA / tax compliance (eIMS, Raast QR)                                                                            | P0          | [#18](https://github.com/Hassanjkhan99/food-delivery/issues/18)                                                                      |
| Promoted deals / featured placements (Campaign UI depth)                                                         | P1          | [#22](https://github.com/Hassanjkhan99/food-delivery/issues/22)                                                                      |
| Uploads off ephemeral /tmp → object storage                                                                      | gated       | [#142](https://github.com/Hassanjkhan99/food-delivery/issues/142), [#193](https://github.com/Hassanjkhan99/food-delivery/issues/193) |
| KYC not enforced at payout                                                                                       | **fixed**   | [#203](https://github.com/Hassanjkhan99/food-delivery/issues/203)                                                                    |
| Owner-only surfaces reachable by URL (menu/hours/roster gated; branding/campaigns/promo/reads pending)           | **partial** | [#204](https://github.com/Hassanjkhan99/food-delivery/issues/204)                                                                    |
| Restaurant ticket replies not shown to the customer                                                              | **fixed**   | [#205](https://github.com/Hassanjkhan99/food-delivery/issues/205)                                                                    |

> **Note on scheduled orders:** the "Scheduled" lane and `scheduledFor` exist, but **auto-promotion to
> "New" at `scheduledFor − leadTime` is a noted TODO in `orderService.ts`** — staff must accept
> manually. Tracked under [#54](https://github.com/Hassanjkhan99/food-delivery/issues/54).
