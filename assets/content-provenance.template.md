# Local Content Provenance

Copy this file into a broad game project at discovery time. Add one row for
every meaningful model, texture, font, audio file, shader source, icon, or
procedural content family. Static audits cannot prove how a local file was
obtained; this inventory is the human-reviewed evidence.

Allowed source categories: `procedural`, `project-local`, `user-supplied`, and
`deferred`.

| Content key | Runtime path | Source category | Original/local source | License/ownership | Integration notes |
| --- | --- | --- | --- | --- | --- |
| hero | procedural factory | procedural | `src/assets/createHero.ts` | project-authored | shared geometry/material roles |
| example-local-model | `/assets/models/example.glb` | user-supplied | user attachment name | confirm with user | replace this example row |

Declaration:

- No asset search, download, hotlink, MCP call, hosted generator, provider SDK,
  remote API, or cloud runtime was used for this content set.
- Any user-supplied third-party file retains its source and license notes.
- Every runtime path is stable, local, and included in production-preview QA.

Reviewed by:
Date:
