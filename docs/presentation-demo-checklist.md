# Presentation Demo Checklist

## Clean Install Rehearsal
- Start with a fresh user profile (`app.sqlite` + Electron store removed).
- Launch the app and confirm `Presentation mode` is enabled by default.
- Verify the sidebar is focused on the core flow (Run, Knowledge, Train, Readiness).
- Confirm seeded demo workspace content exists:
  - one starter conversation (`Presentation kickoff`)
  - demo wiki sources (`Demo domain brief`, `Demo training checklist`)
  - ontology stats are non-empty
  - at least one metrics sample exists in history
- Validate the guided flow:
  - open Run and verify runtime guidance
  - open Knowledge and show seeded context
  - open Train and show domain/evidence setup
  - open Readiness and walk through feature gate checks

## Presentation Script (8-12 Minutes)
1. Explain focused navigation and why advanced views are hidden by default.
2. Show instant value on first launch (pre-seeded chat/wiki/ontology/metrics).
3. Demonstrate the end-to-end workflow:
   - runtime startup
   - knowledge capture/graph context
   - training setup
   - readiness verification
4. Toggle `Show advanced surfaces` to prove depth remains available.
5. Close with confidence signals: deterministic startup data + regression tests.

## Regression Gate Before Demo
- `npm run typecheck`
- `npm test -- src/main/services/demoSeed.spec.ts src/main/storeDefaults.spec.ts src/main/services/integrationServer.spec.ts src/main/services/trainOrchestrator.axolotl.spec.ts src/shared/uiRole.spec.ts`
