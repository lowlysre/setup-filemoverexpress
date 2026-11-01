# Pin or range versions

The `filemoverexpress-version` input picks which File Mover Express release to install. It's empty by default, which means `latest`.

## Pin an exact version

Use an exact version when you want the same CLI on every run:

```yaml
- uses: lowlysre/setup-filemoverexpress@v1
  with:
    filemoverexpress-version: '1.1.1'
```

A leading `v` is accepted, so `v1.1.1` resolves to the same release. Upstream tags don't use the prefix.

## Accept patch or minor updates

Any semver range works. The action picks the highest release that satisfies it:

| Value           | Matches                   |
| --------------- | ------------------------- |
| `1.1`           | `1.1.x`                   |
| `1.x`, `^1.0.0` | Any `1.y.z`               |
| `>=1.0 <2`      | Any `1.y.z`               |
| `latest`        | The newest stable release |

Quote the value. Unquoted, YAML reads `1.10` as the number `1.1`.

## Read the version from a file

Keep the version next to your code so local tooling and CI agree:

```yaml
- uses: lowlysre/setup-filemoverexpress@v1
  with:
    filemoverexpress-version-file: .filemoverexpress-version
```

The action strips `#` comments and blank lines, then reads the first remaining line:

```text
# .filemoverexpress-version
1.1.1
```

An asdf or mise `.tool-versions` file works too. The action uses the `filemoverexpress` line and ignores the rest:

```text
filemoverexpress 1.1.1
nodejs 24.11.0
```

If both inputs are set, `filemoverexpress-version` wins and the action logs a warning.

## Pick up new releases on self-hosted runners

With a range like `1.x`, the action reuses any satisfying version in the tool cache. Set `check-latest: true` to ask the API for the newest match instead. [Caching](../explanation/caching.md#when-the-cache-is-used) shows how each request resolves.

```yaml
- uses: lowlysre/setup-filemoverexpress@v1
  with:
    filemoverexpress-version: '1.x'
    check-latest: true
```

## Include prereleases

```yaml
- uses: lowlysre/setup-filemoverexpress@v1
  with:
    filemoverexpress-version: '1.x'
    allow-prerelease: true
```

## Check what got installed

The `filemoverexpress-version` output holds the resolved version:

```yaml
- id: fme
  uses: lowlysre/setup-filemoverexpress@v1
  with:
    filemoverexpress-version: '1.x'
- run: echo "Installed File Mover Express ${FME_VERSION}"
  env:
    FME_VERSION: ${{ steps.fme.outputs.filemoverexpress-version }}
```

## Pin the action itself

Version ranges control the CLI. To pin the action, reference a full commit SHA and keep the tag as a comment so Dependabot can update it:

```yaml
- uses: lowlysre/setup-filemoverexpress@<full-commit-sha> # v1.0.0
```
