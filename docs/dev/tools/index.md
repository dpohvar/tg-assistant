# Historical standalone probes

These scripts were used before and during initial implementation. They are preserved in their original form to support the archived reports. They are not imported by the service, are not production sandbox implementations, and are not automatically included in `npm test`.

| Artifact | Purpose |
|---|---|
| [prepare-runtime-check.py](prepare-runtime-check.py) | Prepare a bounded synthetic filesystem fixture |
| [codex-runtime-check.mjs](codex-runtime-check.mjs) | Probe native App Server behavior in an explicitly supplied test environment |
| [save-image-probe.mjs](save-image-probe.mjs), [tests](save-image-probe.test.mjs) | Early generated-image export adapter |
| [telegram-check.py](telegram-check.py) | Live Telegram API probe using a local token file |
| [telegram_discussion_probe.py](telegram_discussion_probe.py), [tests](telegram_discussion_probe_test.py) | Saved discussion traversal prototype |
| [telegram_carousel_probe.py](telegram_carousel_probe.py) | Live rich-media edit probe |
| [Croner package](croner-check/package.json), [adapter](croner-check/zoned-cron.mjs), [adapter tests](croner-check/adapter.test.mjs) | Early cron/DST investigation |
| [Alpine Dockerfile](alpine-check/Dockerfile) | Early SSH test-container image, requiring separately supplied vendor and public-key files |

Several scripts assume their former `tools/` position or a prepared `.runtime-check` directory. Relocation does not make them ready to run. Do not add real token files, authorization, private SSH keys, vendor binaries, or test outputs here. Use the maintained integration suite in [test/integration](../../../test/integration), bounded live probes in [test/live](../../../test/live), and the current [operations guide](../../operations.md) for present validation.
