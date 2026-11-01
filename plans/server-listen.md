# Server listen configuration

Rename `HEDRA_SERVER_PORT` to `HEDRA_SERVER_LISTEN_PORT` and add
`HEDRA_SERVER_LISTEN_IP`, defaulting to `0.0.0.0`, as requested.

- Keep the port default at `3000` and its accepted range at `1`–`65535`.
- Store the settings as `serverListenPort` and `serverListenIp` in loaded config.
- Validate the listen IP as an IPv4 or IPv6 address using Zod, with the existing
  `ConfigurationError` behaviour for invalid values.
- Set `Hedra.port` and `Hedra.hostname` from the settings so Bun uses them when
  serving a default-exported app. Preserve existing routing behaviour.
- Follow the existing environment precedence and blank-value fallback rules.
- Update callers and document the environment variables in the hello-world example.
  The renamed variable replaces the old name without a compatibility alias.

Use the existing configuration, `Hedra`, and process-entrypoint test seams to
verify defaults, trimmed overrides, blank-value fallback, invalid ports and IPs,
and startup with the configured listen address. Run `bun run check` and an
independent read-only review before requesting approval to merge into `main`.
