# Authenticate with configure-aws-credentials

[aws-actions/configure-aws-credentials](https://github.com/aws-actions/configure-aws-credentials) gets the credentials, and File Mover Express reads them at transfer time. The action only reads the region and never touches credentials. [Credentials and interop](../explanation/credentials.md) explains the full chain.

## Assume a role with OIDC

```yaml
permissions:
  id-token: write
  contents: read

jobs:
  upload:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - uses: aws-actions/configure-aws-credentials@v6
        with:
          role-to-assume: arn:aws:iam::123456789012:role/gha-media-upload
          aws-region: us-east-1

      - uses: lowlysre/setup-filemoverexpress@v1
        with:
          bucket: my-media-bucket
          validate-credentials: true

      - run: filemoverexpress upload default ./renders --prefix "builds/${GITHUB_RUN_ID}"
```

In its default mode, configure-aws-credentials exports `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_REGION`, and `AWS_DEFAULT_REGION`. The CLI reads the credentials, and the action reads the region for the transfer profile, so `region` doesn't need repeating.

## Step order

| You set                      | Order                                                                  |
| ---------------------------- | ---------------------------------------------------------------------- |
| `validate-credentials: true` | configure-aws-credentials first. Validation needs credentials.         |
| `bucket` without `region`    | configure-aws-credentials first, so `AWS_REGION` exists.               |
| `bucket` and `region`        | Either order. Credentials only need to exist before the transfer step. |
| No `bucket` (install only)   | Either order.                                                          |

When validation fails and the action finds no credential variables at all, its error message tells you to run configure-aws-credentials first.

The action takes the region from the `region` input, then `AWS_REGION`, then `AWS_DEFAULT_REGION`, then the effective profile in the AWS config file. If `bucket` is set and none of these resolves, the step fails. [How the action finds the region](../explanation/credentials.md#how-the-action-finds-the-region) has the details.

## Use a named profile

Set `aws-profile` on configure-aws-credentials and it writes credentials and region to the shared AWS files instead of exporting credential variables. The action has an input with the same name and meaning:

```yaml
- uses: aws-actions/configure-aws-credentials@v6
  with:
    role-to-assume: arn:aws:iam::123456789012:role/gha-media-upload
    aws-region: us-east-1
    aws-profile: media

- uses: lowlysre/setup-filemoverexpress@v1
  with:
    bucket: my-media-bucket
    aws-profile: media
```

- configure-aws-credentials writes `[media]` to `~/.aws/credentials` and `[profile media]` with `region = us-east-1` to `~/.aws/config`, then exports `AWS_PROFILE=media`
  - It honors `AWS_SHARED_CREDENTIALS_FILE` and `AWS_CONFIG_FILE` if they're set
  - It doesn't export `AWS_REGION` or `AWS_DEFAULT_REGION` in this mode unless you also set `output-env-credentials: true`
- The action reads the region from `[profile media]`, then writes `profile: media` into the transfer profile
- File Mover Express loads the `media` profile at transfer time

You can leave `aws-profile` off the action. It still resolves the region from the profile in `AWS_PROFILE`, and the CLI's AWS SDK still honors `AWS_PROFILE`. The difference is what lands in the config file:

| Action input         | Transfer profile | Credential source at transfer time                                    |
| -------------------- | ---------------- | --------------------------------------------------------------------- |
| `aws-profile: media` | `profile: media` | Always the `media` profile, even if credential variables are also set |
| Not set              | No `profile` key | AWS SDK default chain: credential variables first, then `AWS_PROFILE` |

Set the input when a transfer profile has to stick to one account no matter what later steps export.

## Two accounts in one job

Each configure-aws-credentials call writes its own profile, and each call to the action writes a transfer profile pointing at one of them:

```yaml
- uses: aws-actions/configure-aws-credentials@v6
  with:
    role-to-assume: arn:aws:iam::123456789012:role/gha-media-reader
    aws-region: us-east-1
    aws-profile: source

- uses: aws-actions/configure-aws-credentials@v6
  with:
    role-to-assume: arn:aws:iam::210987654321:role/gha-archive-writer
    aws-region: eu-west-1
    aws-profile: archive

- uses: lowlysre/setup-filemoverexpress@v1
  with:
    transfer-profile: source
    bucket: my-media-bucket
    aws-profile: source
    region: us-east-1

- uses: lowlysre/setup-filemoverexpress@v1
  with:
    transfer-profile: archive
    bucket: partner-archive-bucket
    aws-profile: archive
    region: eu-west-1

- name: Copy through the runner
  shell: bash
  run: |
    filemoverexpress download source ./staging masters/
    cd staging
    filemoverexpress upload archive masters
```

> [!IMPORTANT]
> Set `region` on each call when the profiles live in different regions. The first call exports `AWS_REGION` when it's unset, and `AWS_REGION` outranks the config file for every later call, so the second transfer profile would get the first profile's region.

To switch accounts sequentially instead, run configure-aws-credentials again in default mode. It replaces the credential variables, and the next `filemoverexpress` command uses the new role without any change to the transfer profile.

## Run transfers longer than an hour

configure-aws-credentials requests one-hour role sessions by default. The credentials it exports are static, so File Mover Express can't refresh them, and a transfer still running when the session expires fails partway through with expired-token errors.

Set `role-duration-seconds` to cover the whole transfer plus some margin, and give the transfer step a shorter `timeout-minutes` so a stalled transfer fails with a clear timeout:

```yaml
- uses: aws-actions/configure-aws-credentials@v6
  with:
    role-to-assume: arn:aws:iam::123456789012:role/gha-media-upload
    aws-region: us-east-1
    role-duration-seconds: 21600 # 6 hours

- uses: lowlysre/setup-filemoverexpress@v1
  with:
    bucket: my-media-bucket

- name: Upload
  timeout-minutes: 340
  shell: bash
  run: |
    filemoverexpress upload default ./masters 2>&1 | tee fme.log
    if grep -qE $'^(\033\\[[0-9;]*m)*(ERROR|FATAL)' fme.log; then exit 1; fi
```

The role has to allow it. Raise its maximum session duration, up to 12 hours:

```bash
aws iam update-role --role-name gha-media-upload --max-session-duration 21600
```

Limits that still apply:

- Role chaining (assuming a role from credentials that came from another role) caps sessions at one hour regardless of the setting
- A GitHub-hosted job stops after 6 hours, so longer sessions only help on self-hosted runners
- The session clock starts when configure-aws-credentials runs, so request credentials right before the transfer step, not at the start of a long job

For very large uploads, split the work across jobs, each with its own configure-aws-credentials step. To resume after a failure, rerun the job with fresh credentials. Add `--force` to send every file again, including ones already in the bucket; the CLI's help describes it as forcing transfers "regardless of filters or conflicts".
