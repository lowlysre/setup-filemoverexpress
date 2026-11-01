# Contributing

Bug reports, fixes, and docs improvements are welcome. Problems with the `filemoverexpress` CLI itself belong in [awslabs/filemoverexpress](https://github.com/awslabs/filemoverexpress/issues).

This project follows the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).

## Development setup

You need Node.js 24 (`devEngines.runtime` in `package.json`) and npm.

```sh
npm ci
npm run all
```

| Script                                    | What it runs                                            |
| ----------------------------------------- | ------------------------------------------------------- |
| `npm run format` / `npm run format:check` | Prettier                                                |
| `npm run lint`                            | oxlint with type-aware rules (`.oxlintrc.json`)         |
| `npm run typecheck`                       | `tsc --noEmit`                                          |
| `npm test`                                | vitest with coverage                                    |
| `npm run build`                           | esbuild bundle to `dist/index.js` (`scripts/build.mjs`) |
| `npm run all`                             | all of the above, in that order                         |
| `npm run docs:dev` / `npm run docs:build` | VitePress site in `docs/`                               |

## Commit dist/

Runners execute `dist/index.js` straight from the repository, so `dist/` is committed. Run `npm run build` and commit the result with every change to `src/` or to dependencies. CI's Check dist/ job rebuilds and fails on any difference, and uploads the expected `dist/` as an artifact.

## Tests

Unit tests live in `__tests__/` and run with `npm test`.

The E2E workflow (`.github/workflows/e2e.yml`) runs the real action with `uses: ./` on every hosted runner image: Linux, macOS, and Windows, each on x64 and arm64. It covers:

- install, outputs, and a second run served from the tool cache
- version specs (`1.0.0`, `v1.1.0`, `1.0`, `1.x`, `^1.0.0`, `latest`) and version files
- an upload and download round trip against [moto](https://github.com/getmoto/moto), a local S3 mock, with the same `AWS_*` variables aws-actions/configure-aws-credentials exports
- the AWS named-profile path that configure-aws-credentials uses with its `aws-profile` input
- inputs that have to fail the step

It also runs weekly to catch upstream release changes. To run the round trip locally:

```sh
pip install "moto[server]==5.2.5" boto3
moto_server -H 127.0.0.1 -p 5050 &
export AWS_ACCESS_KEY_ID=testing AWS_SECRET_ACCESS_KEY=testing AWS_REGION=us-east-1
python -c "import boto3; boto3.client('s3', endpoint_url='http://127.0.0.1:5050').create_bucket(Bucket='fme-e2e')"
```

Then point a transfer profile at it with `bucket: fme-e2e` and `endpoint: http://127.0.0.1:5050`.

> [!NOTE]
> `filemoverexpress upload` and `validate-credentials` exit 0 even when transfers or validation fail. Tests check the log for `ERROR` and `FATAL` lines and verify results in the bucket.

## Workflows

- Every remote `uses:` is pinned to a full commit SHA with its release tag in a comment. Dependabot proposes updates weekly: minor and patch bumps together in one pull request per ecosystem, majors in another.
- Every job starts with step-security/harden-runner in audit mode, which records outbound network calls on Linux, macOS, and Windows runners.
- CI runs actionlint and zizmor on every pull request. CodeQL scans the workflows and TypeScript on pull requests, pushes to `main`, and weekly.
- The Docs workflow builds the site on pull requests that touch it, and deploys it to GitHub Pages on pushes to `main`.

### Required checks

The `main` ruleset requires two checks: `CI / are-we-good` and `E2E / are-we-good`. Each is the last job of its workflow and rolls up every other job's result with lowlydba/are-we-good, so adding or renaming a job doesn't change the ruleset. Both workflows run on every pull request with no path filters, since a required check that never reports blocks the merge.

## Pull requests

- Keep each pull request to one change
- Update `README.md` and `docs/` when an input, output, or behavior changes
- Label it for the release notes: `breaking-change`, `enhancement`, `bug`, `documentation`, or `dependencies`

## Releasing

1. Merge the changes to `main` with `dist/` up to date.
2. Publish a GitHub release with a new `vX.Y.Z` tag on `main`.
3. The Release workflow checks the tag format, confirms the commit is on `main` and that `dist/` matches a fresh build, then moves the major tag (`v1`) to that commit.

Prereleases don't move the major tag. To repoint it by hand, run the Release workflow from the Actions tab with an existing `vX.Y.Z` tag.
