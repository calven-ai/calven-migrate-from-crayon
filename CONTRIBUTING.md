# Contributing

Run `npm test` before a pull request. It needs Node.js 20 or later and no install step: the tool has no dependencies.

The tests run against `test/fake-crayon.mjs`, a simulated Crayon server. Keep test data fictional: no Crayon screenshots, logos, help text or real answers in this repository.

If a real Crayon export behaves differently from the simulation, open an issue with `manifest.json`, `coverage.md` or the output of `calven-migrate-from-crayon inspect`. None of them contains answer content.
