# Inspection workflow

The system triggers the inspection workflow, Operations coordinates it, the owner authorises it, and the inspector carries it out. Operations means the property manager assigned to the property, with administrators able to do the same when a property has no manager.

Consent to inspect and confirmation of access are separate. An owner can consent and still need access arranged through a tenant, caretaker or facility manager. Consent is never permission to enter at any time.

## Steps

| Stage | Activity | Who | What the system records |
| --- | --- | --- | --- |
| 1 | Register the owner and property | Owner, administrator | Owner and property records |
| 2 | Confirm onboarding is complete by moving the property to `INSPECTION_PENDING` | Administrator | `inspectionReadyAt` |
| 3 | Notify Operations | System | A coordination task for the manager, due in 1 business day, and an email. With no manager, the administrators are emailed to assign one. |
| 4 | Request the owner's consent, if outstanding | Manager or administrator | `inspectionConsentRequestedAt`, an email to the owner |
| 5 | Record the owner's consent | Owner, or staff on the owner's behalf with a note | `inspectionConsent`, who recorded it, when, and the note |
| 6 | Agree a date and assign an inspector | Manager or administrator | The inspection, and the coordination task is closed |
| 7 | Confirm access | Manager or administrator | Who controls entry, whether the occupant authorised access, a note |
| 8 | Carry out the visit | Inspector | Starts only once access is confirmed |
| 9 | Submit the report | Inspector | The report and findings |

The owner can answer in the add-property form. If they have not, staff request it and record the answer.

## Consent

`inspectionConsent` is one of:

- `NOT_RECORDED`: no answer yet.
- `GRANTED`: the owner consents to an inspection, subject to a date and access agreed beforehand.
- `DISCUSSION_REQUESTED`: the owner wants to talk it through first.

A visit cannot be scheduled, by anyone, until the state is `GRANTED`. Consent cannot be withdrawn while a visit is `SCHEDULED`; cancel the visit first.

When staff record an answer on the owner's behalf they must say how and when the owner gave it (at least 10 characters). The owner is emailed a receipt.

Properties that were already waiting for inspection before this workflow existed start as `NOT_RECORDED`. Staff should record consent for them with a note. Consent is never filled in automatically.

## Access

Access is confirmed per visit, not per property, because it depends on the date. Moving the date clears the confirmation. For an occupied property the occupant must have authorised access. This system records that they did; it does not hold the tenancy agreement.

## Status and targets

`GET /properties` and `GET /properties/:id` return `inspectionReadiness` for properties in `INSPECTION_PENDING`:

| Stage | Meaning |
| --- | --- |
| `AWAITING_OWNER_CONSENT` | Consent is outstanding. This is not an overdue inspection. |
| `READY_TO_SCHEDULE` | Consent given, nothing booked. |
| `AWAITING_ACCESS_CONFIRMATION` | A visit is booked, access is not confirmed. |
| `READY_FOR_VISIT` | Access confirmed. The inspector acts next. |

`nextAction` says what happens next, who owns it (`OPERATIONS` or `INSPECTOR`), when it is due, and whether it is overdue. These are internal targets, in business days (Monday to Friday, Lagos time, public holidays not counted):

| Action | Target | Owner |
| --- | --- | --- |
| Request consent | 1 business day after the property is ready | Operations |
| Follow up on consent | 2 business days after the first request | Operations |
| Discuss when the owner asked to talk first | 1 business day after they asked | Operations |
| Schedule after consent | 1 business day after consent (or readiness, if later) | Operations |
| Confirm access | Before the visit time | Operations |
| Carry out the visit | 3 business days after the appointment | Inspector |
| Submit the report | 24 hours after the visit | Inspector |

Nothing sends reminders automatically yet. The targets are shown in the interface and the task list.

## Not covered

Automatic reminders and escalation, a dedicated Operations Officer role, manager review of the inspection report, public holidays, and the legal wording of tenant access agreements.
