# empireNigeria MVP readiness report

Prepared 17 October 2026 for the development meeting. Launch target: 28 October 2026.

How to read this report. Each claim carries one of three evidence levels:

- **Verified**: I ran it or read the code and it works as described.
- **Reported**: the team told us it works, but it has not been re-demonstrated for this report.
- **Not verified**: no evidence either way. These are the items to close before launch.

Scope exclusions agreed with the product owner: payments and subscriptions are intentionally not built yet, and a security and infrastructure review is out of scope for this report.

## 1. Feature completion

"Complete" means the screen exists, calls the real API, and has no known blocking defect. "Tested" means automated tests cover it. All 60 frontend routes call the real backend. The earlier demo and sample-data services were unreachable and have been deleted.

| Area | Status | Automated tests | Notes |
| --- | --- | --- | --- |
| Public site (home, about, services, contact) | Complete | None | Contact form now sends email through the API (new, see section 4). Social links are empty. |
| Registration, email verification, login, logout, token refresh | Complete | Backend unit tests, frontend validation tests | Owner and Guest self-register. Live email delivery is not verified (section 2). |
| Password reset (3 steps) | Complete | Backend unit tests | Depends on email delivery. |
| Staff invitations (property manager, inspector, contractor) | Complete | Backend unit tests | Admin invites, resend, revoke. Depends on email delivery. |
| Roles and permissions (6 roles) | Complete | Backend unit tests | Guards check the role and re-check the user on every request. No endpoint exists to suspend a user. |
| Profile and avatar | Complete | Partial | Garbled characters on this page are fixed. |
| Owner dashboard | Complete | Unit test | The maintenance tile now counts open maintenance requests. It showed property occupancy before. |
| Add, edit and view property (multi-step) | Complete | Backend unit tests | Photos and documents upload straight to storage with type and size checks. |
| Admin property review and manager assignment | Complete | Backend unit test added | Allowed status moves are now enforced in the API and the UI. |
| Inspections (schedule, start, report, evidence) | Complete | Backend unit tests | Completing an inspection does not change the property status. |
| Maintenance (request, assign, quote, approve, progress, close) | Complete | Backend unit tests | Quote approval by owner is implemented. |
| Documents | Complete | Frontend unit tests | Documents are the property files. |
| Occupancy | Complete | Backend unit tests | |
| Financials (recorded expenses, quotes, booking value) | Partial | Frontend unit tests | Shows recorded expenses and expected values only. Received income is unavailable until payments exist. |
| Reports | Complete | Backend unit tests | |
| Stay marketplace (list, detail, availability) | Complete | Backend unit tests | Listings without a photo show a placeholder. |
| Stay listing management and admin publishing | Complete | Backend unit tests | |
| Bookings (request, confirm, decline, cancel, complete) | Complete | Backend unit tests | No payment is collected. |
| Property manager, inspector and contractor portals | Complete | Partial | |
| Admin: users, dashboard, audit log | Complete | Backend unit tests | |
| Admin: payments page | Placeholder | None | Empty by design until payments are built. |
| Subscriptions and payments | Not started | None | Intentional. See section 4. |

### Implemented but not tested
- Public marketing pages and the new contact form have no automated tests on the page side.
- The frontend has 54 unit tests and 17 Playwright tests. Neither set covers the admin review screen, the new loading and empty states, or the Stay and booking management screens.
- The backend has 114 unit tests with mocked storage, database and email. It has no HTTP-level end-to-end tests.

### Known defects and gaps (as of this report)
Fixed in this round, pending deployment:

- Garbled characters on the profile page (`Youâ€™re`, `Â·`).
- Misaligned review buttons, and buttons that offered impossible status changes.
- Stock house photos shown while real photos loaded.
- Several pages used unstyled buttons and forms.
- The booking pages flashed "No bookings yet" while loading.
- The contact form claimed to send but did nothing, and showed a placeholder phone number.

Still open:

- No owner email when a property is approved or changes are requested.
- No way to suspend a user from the app.
- Completing an inspection does not move the property forward.
- Visual QA of the changed screens has not been done in a browser. The Playwright run started for this report did not finish.
- Currency text in one backend audit message uses `NGN` instead of `₦` (cosmetic).

## 2. Technical readiness

| Item | Status | Evidence |
| --- | --- | --- |
| Public website | Reported live at empirenigeria.com | Not re-checked for this report |
| Frontend hosting | Vercel config present (`vercel.json`) | Verified in repo |
| API hosting | Render, `empirenigeria-api.onrender.com` | Configured in the frontend environment file |
| Database | Neon Postgres, 11 migrations | Verified in repo |
| File storage | Supabase private buckets, signed URLs | Verified in repo |
| Email | Resend | **Not verified.** An earlier acceptance run recorded a 403 because the sender domain was not verified. Confirm the domain is verified and send a real test. |
| Authentication and permissions | Implemented | Verified in code and unit tests |
| Property submission, image upload, admin approval end to end | **Reported working** by several team members | Not re-demonstrated for this report. Capture it in UAT (section 3) so the evidence exists. |
| Build and tests | Frontend builds, 54 unit tests pass, lint clean. Backend builds, 114 unit tests pass. | Verified on 17 October |

Outstanding hosting items to confirm (not a security review): whether the API runs on a plan that avoids cold starts, whether database and storage backups are enabled in the Neon and Supabase dashboards, and a written rollback step for each deploy.

## 3. Testing plan

### Journeys to test
Run each on desktop and on a phone, with a fresh account.

1. **Owner**: register, verify email, log in, add a property with photos and documents, see it as Submitted, edit it, see the review decision, see the photo load and fall back correctly.
2. **Admin**: log in, open the review queue, start review, request changes, then approve after the owner resubmits. Assign a property manager.
3. **Inspection**: admin schedules, inspector starts, adds evidence and report, owner views the report.
4. **Maintenance**: owner raises a request, admin assigns a contractor, contractor quotes, owner approves, contractor completes, admin closes.
5. **Stay**: owner lists an approved short-let property, admin publishes, guest searches, requests a booking, owner confirms, guest sees the status.
6. **Staff onboarding**: admin invites a manager, inspector and contractor, each accepts and logs in.
7. **Account recovery**: password reset end to end.
8. **Public site**: every page and link, the contact form arrives in the info inbox with the visitor as reply-to.
9. **Characters and layout**: no garbled text anywhere, no horizontal scroll at 375px, review buttons wrap.

### Resources needed
- 2 testers (one on iPhone or Android, one on desktop) for 3 days.
- 1 developer for fixes, available daily.
- Test accounts for all six roles, a verified Resend sender, and a clean staging or seeded production dataset.
- A shared defect list (the team's tracker) with severity labels.

### Defect resolution targets
| Severity | Definition | Fix within |
| --- | --- | --- |
| Blocker | Journey cannot be completed, or data is lost | 1 day |
| Major | Journey completes with a wrong result or confusing state | 2 days |
| Minor | Cosmetic or wording | Batched, before freeze if time allows |

## 4. Outstanding MVP requirements

### Essential before launch
1. **Confirm email delivery in production.** Registration, reset and invitations all depend on it.
2. **Run the end-to-end journeys above once more with evidence** (screenshots or a short recording), since the current confirmation is verbal.
3. **Visual check of the screens changed in this round** on desktop and phone.
4. **Set `CONTACT_TO_EMAIL`** on Render (defaults to info@empirenigeria.com) and confirm that inbox is monitored.
5. **Confirm real contact details.** The phone number is now 0808 781 2341. Confirm the email address, office location and opening hours shown on the contact page.

### Strongly recommended, small
- Email the owner when a property is approved or changes are requested.
- Make completing an inspection move the property to the next review step, or document that it is manual.

### Can wait until after launch
- Suspend or reactivate users from the admin screen.
- Social media links.
- Share image for link previews.
- Cleaner chart axis labels and further layout polish.

### Subscriptions and payments (for agreement)
Nothing exists today, by design. Stay bookings and maintenance quotes record amounts but collect no money, and the financials page says so. Proposed priority: **after launch**, as phase 2.

A suggested scope for agreement at the meeting:

- Decide who pays whom first: owner subscription for property care, guest payment for Stay, or contractor payment for maintenance.
- Choose a provider that supports Nigerian cards and bank transfer (for example Paystack or Flutterwave), plus card support for diaspora owners.
- Build: plans and prices, checkout, a webhook that confirms payment, receipts, a payments table, access rules for unpaid accounts, and the admin payments screen.
- Realistic effort: 2 to 3 weeks including provider onboarding, which has its own approval wait.
- Launch alternative if revenue is needed on day one: admin marks an owner account as subscribed after an offline bank transfer. Roughly 2 days of work and no provider dependency.

## 5. Launch readiness

### Proposed schedule
| Dates | Work |
| --- | --- |
| Sat 17 to Mon 19 Oct | Review and deploy this round of fixes. Confirm email delivery and `CONTACT_TO_EMAIL`. Visual check on desktop and phone. |
| Tue 20 to Thu 22 Oct | Structured testing of all journeys. Log defects with severity. Fix blockers and majors as they appear. |
| Fri 23 to Sun 25 Oct | User acceptance testing with real owners and the admin team. Fix remaining majors. |
| Mon 26 Oct | Defect freeze. Final deploy to production, smoke test of the journeys. |
| Tue 27 Oct | Go or no-go meeting. Backups and rollback confirmed. |
| Wed 28 Oct | Launch. |

### Risks to 28 October
| Risk | Likelihood | Effect | Mitigation |
| --- | --- | --- | --- |
| Email not delivering (sender domain) | Medium | Nobody can register or reset a password | Verify the domain and send real test emails this week |
| End-to-end flow broke during this round of changes | Medium | Late rework | Run the journeys on the deployed build before UAT |
| Too few testers or late UAT feedback | Medium | Defects found after freeze | Book testers now, start Tuesday |
| Scope creep from payments | High if raised late | Missed date | Agree at the meeting that payments are phase 2 |
| Cold starts or slow first load on the API host | Low to medium | Poor first impression | Confirm the Render plan, add a keep-alive check |
| No tested rollback | Low | Long outage if a deploy fails | Write down the previous deploy and how to restore it |

### Decisions needed at the meeting
1. Payments and subscriptions: phase 2, or the offline-subscription alternative for launch?
2. Who are the two testers and the UAT group, and are they booked from 20 October?
3. Owner approval emails: in or out of the launch scope?
4. Who owns the info@empirenigeria.com inbox that now receives contact enquiries?
