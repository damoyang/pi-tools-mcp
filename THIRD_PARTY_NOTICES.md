# Third-party notices

The JavaScript in `vendor/pi` is derived from [Pi v1.5.2](https://github.com/earendil-works/pi/tree/b4afdddf44e059c67ccf5097e5317d913521b470/packages/coding-agent), copyright (c) 2025 Mario Zechner. The upstream [MIT license](vendor/pi/LICENSE) applies to the vendored code.

The snapshot retains the coding tool executors and their Node.js helpers. The extraction removes terminal renderers, system-prompt metadata and source-map references. It supplies a standalone binary-cache configuration and HTTP user-agent string, and preserves the upstream image worker and its WebAssembly runtime dependency. The downstream changes also isolate concurrent search-binary downloads, check cancellation during grep setup, and remove the Bash-specific fallback command from oversized-line notices. Runtime npm packages are distributed under their respective licenses.

To regenerate the vendored modules from the published package, run the following from the repository root on a system with `tar`:

```sh
npm pack @earendil-works/pi-coding-agent@1.5.2
mkdir -p /tmp/pi-tools-mcp-upstream
tar -xzf earendil-works-pi-coding-agent-1.5.2.tgz -C /tmp/pi-tools-mcp-upstream
node scripts/vendor-pi.js /tmp/pi-tools-mcp-upstream/package
npm test
```

The upstream package has npm integrity `sha512-mUWI04rqF1Vd/m1q+Ps1XeWsTXEVvRUnsmRa83I3Dzua0Tx5bYS93imeqtIfrXf7PkkaR6ERz+AuQhIJlom5yA==`. The extraction script retains the existing license file. When changing the vendored version, review the upstream license and executor dependency graph, update the pin and remove stale files from the snapshot.
