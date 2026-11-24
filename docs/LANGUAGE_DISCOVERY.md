# Language Discovery

## Supported recognition targets

The static recognizer maps common extensions/manifests for JavaScript/Node.js, CommonJS, ES Modules, TypeScript, Python, Go, PHP, Java, Rust and Bash. It also recognizes common manifest files such as `package.json`, `requirements.txt`, `go.mod`, `composer.json`, `Cargo.toml` and `pom.xml`.

## Analysis outputs

- Language inventory by file and primary language (`mixed` where multiple source languages exist).
- Runtime family candidates (Node, Python 3, Go toolchain, PHP CLI, JVM, Rust toolchain, Bash).
- ESM/CommonJS/mixed module-system hints.
- Candidate entry points, named functions, explicit export candidates, imports/dependencies, environment variable names and known external-service indicators.

## Method and limitations

Analysis is static and regex/manifest based. To bound memory use, Part 1 scans at most 5,000 candidate files, 64 MiB of text and retains at most 8 MiB of snippets by default. Oversized or budget-skipped candidates are recorded in `analysisCoverage`; a partial scan must not be treated as a complete review. Text scanning includes environment files, common configuration/manifest formats and PEM/key files where they can be decoded as UTF-8. Credential matches are reported only by finding ID, file and line; secret values are never retained. It does not run compilers, import modules, inspect runtime objects or prove that a function is reachable. Function names and platform indicators are evidence candidates, not guaranteed capabilities. A language/runtime label is not a compatibility pass. Syntax/type-check and runtime validation must occur in a future isolated environment.

Unknown extensions are retained in the inventory as `unknown`, not discarded.
