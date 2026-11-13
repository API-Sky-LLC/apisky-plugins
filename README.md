# Skyline plugins

Agent plugins for Skyline and other agent clients that read the same layout: skills, rules, commands,
subagents and an optional MCP requirement, each packed as one folder with one manifest.

A plugin is a directory under `plugins/`. Clients read `.skycoder-plugin/marketplace.json` and each
`plugins/<slug>/.skycoder-plugin/plugin.json`; the Legion skill store additionally reads the signed
`index.json` at the repository root.

## Plugins

| Plugin | Contents | License |
|---|---|---|
| [`engineering-basics`](plugins/engineering-basics/) | Repo analysis, commit style, a review command | MIT |
| [`github`](plugins/github/) | Signed-in GitHub: repos, issues, pull requests, Actions, security, projects · MCP `github` | MIT |
| [`slack`](plugins/slack/) | Signed-in Slack: search, read, post, canvases, files, lists · MCP `slack` | MIT |
| [`static-binary-analysis`](plugins/static-binary-analysis/) | Read a program file, then patch a copy. Native C/C++ in place; .NET can be rebuilt | MIT |
| [`graphify`](plugins/graphify/) | Build a code knowledge graph, then query it instead of grepping · MCP `graphify` | MIT |
| [`kicad`](plugins/kicad/) | Board review, routing, DFM, footprint audit, fab package · MCP `kicad` | MIT |
| [`qa-playwright`](plugins/qa-playwright/) | Intent-first end-to-end scenarios · MCP `playwright` | Apache-2.0 |
| [`security-audit`](plugins/security-audit/) | Repo security audit: secrets, injection, OWASP Top 10 | MIT |
| [`us-court-filings`](plugins/us-court-filings/) | Filing structure, local rules, table of authorities, filing review | MIT |

## Repository layout

```
plugins/<slug>/
  .skycoder-plugin/plugin.json   manifest (name == folder name, semver version)
  skills/<name>/SKILL.md         skill with YAML frontmatter (name, description)
  rules/<name>.mdc               rule (frontmatter: description, alwaysApply, globs)
  commands/<name>.md             slash command
  agents/<name>.md               subagent
  .mcp.json                      MCP servers the plugin requires (never auto-started)
.skycoder-plugin/marketplace.json  marketplace list (generated)
index.json / index.json.sig        signed catalog for the Legion skill store (generated)
scripts/                           build, sign and key-generation helpers
docs/maintaining.md                how to add a plugin, sign, and publish
docs/publishing.md                 who publishes what, and who needs the signing key
```

Maintaining the registry — adding a plugin, regenerating and signing the index, the CI publish gate and
the review rules — is documented in [docs/maintaining.md](docs/maintaining.md). Where a plugin gets
published from (a pull request, or an in-app submission with no git and no key) is in
[docs/publishing.md](docs/publishing.md).

## License

MIT. See [LICENSE](LICENSE).
