# IntellAssist model per hospital

The AI model decides how good the answers are and what the AI bill is. This
page explains who chooses it and how it is used.

## Who chooses

- **Platform staff only** (BiomedIntel.ai Platform Super Administrators with
  two-step sign-in). On the **Platform** page, each hospital has an **AI model**
  list: App default, Haiku, Sonnet or Opus, and a Save button.
- **Hospital administrators cannot change it.** They see which model is in use
  on **IntellAssist, AI settings and usage**. The database enforces this too:
  a trigger on `organizations.ai_model` refuses anyone who is not a platform
  administrator, even if the application had a bug.

## How it is used

1. Each AI request looks up the hospital model.
2. If set, that model is sent to the provider. If not, the `AI_MODEL` setting
   on the server is used.
3. The model used is saved on every request (`ai_requests.model`) and in the
   audit log, so a later change never rewrites history.
4. A change applies from the next request. Nothing else changes: the same
   limits, the same safety checks, citations required, and advisory only.

## Choices

| Choice | Model ID            | When                                           |
| ------ | ------------------- | ---------------------------------------------- |
| Haiku  | `claude-haiku-5-5`  | Fastest and cheapest; simple faults            |
| Sonnet | `claude-sonnet-5-5` | Balanced; recommended starting point           |
| Opus   | `claude-opus-5-5`   | Strongest reasoning; about 5 times Sonnet cost |

To offer another model, add it to `lib/ai/models.ts`.

## Audit and usage

- Changing a hospital model writes `organization.ai_model_changed` (who, from,
  to). Saving the same value again writes nothing.
- The hospital AI settings page shows requests and tokens this month **by
  model**. Platform staff do not see hospital maintenance records or usage;
  by design they cannot see this per hospital. (Cost per hospital is read from
  the provider invoice or, later, a usage report.)

## Database change

Migration `20261024000400_organization_ai_model` adds one nullable column, a
format check and the trigger. It is add-only: no existing data changes.
