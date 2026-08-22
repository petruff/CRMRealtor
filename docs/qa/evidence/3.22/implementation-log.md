# Story 3.22 implementation log

| Surface | Search result | IDS decision | Reason |
|---|---|---|---|
| Activities task collection | Existing `ActivityWorkspace`, `sk-group`, action names and server actions found | ADAPT | One semantic table reflows into task cards; no duplicate task collection or mutation authority is created. |
| Task selection | Existing native checkboxes found without a target primitive | ADAPT | A labeled 44×44 wrapper preserves native state, names and keyboard behavior. |
| Google Calendar row action | Existing `formAction` plus submitter `name` emitted a React warning | ADAPT | Each task now has one external server-action form with hidden bounded IDs; the visible row button references it through `form`, preserving approval authority without an overridden submitter name. |
| Mobile shell utilities | Existing mobile header mounted every utility directly | ADAPT | Search remains immediate; Alerts, Settings, Workspaces, theme and POST sign-out move into one semantic disclosure with Escape/focus return. |
| Omnix launcher | Existing launcher and modal focus contracts found | ADAPT | Only the closed phone footprint changes; it is suppressed while More is open to prevent fixed-UI collision. |
| Activities status filter | Existing GET `status` select lacked an accessible label | ADAPT | Added one screen-reader label without changing query name, values or route behavior. |
| Responsive evidence | Story supplied receipt requirements but no prior 3.22 evidence directory existed | CREATE | Added a versioned JSON receipt plus index with explicit native-zoom/manual evidence boundaries. |

No new dependency, component framework, state manager, route, schema, provider, task status, background job or analytics event was introduced.

