# Your first upload

This tutorial takes a repository with no AWS access to a workflow that uploads a build output to S3 with [File Mover Express](https://github.com/awslabs/filemoverexpress). It uses GitHub's OIDC provider, so no long-lived AWS keys end up in repository secrets.

By the end you have:

- An IAM role that only your repository's `main` branch can assume
- A permissions policy scoped to one bucket
- A workflow that installs the CLI, validates access, uploads a directory, and fails if any file doesn't transfer

## Before you start

You need:

- An AWS account and an S3 bucket. This tutorial calls it `my-media-bucket` in `us-east-1`; substitute your own name and region everywhere
- The AWS CLI on your workstation, signed in as someone who can create IAM roles
- A GitHub repository you can push to. This tutorial calls it `octo-org/media-pipeline`

## 1. Trust GitHub's OIDC provider

AWS has to trust tokens from GitHub before any workflow can assume a role. Each account needs this once. Skip this step if `token.actions.githubusercontent.com` already shows up in IAM under Identity providers.

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com
```

## 2. Create the role

Save this trust policy as `trust.json`. The `sub` condition limits the role to workflows running on `main` in one repository; replace `123456789012` with your account ID and `octo-org/media-pipeline` with your repository.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:octo-org/media-pipeline:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

Create the role:

```bash
aws iam create-role \
  --role-name gha-media-upload \
  --assume-role-policy-document file://trust.json
```

## 3. Grant least-privilege S3 access

File Mover Express lists the bucket, reads objects (`HeadObject` and `GetObject` both need `s3:GetObject`), writes objects, and cleans up multipart uploads. Save this as `s3.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListBucket",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::my-media-bucket"
    },
    {
      "Sid": "ReadWriteObjects",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"],
      "Resource": "arn:aws:s3:::my-media-bucket/*"
    }
  ]
}
```

Attach it to the role:

```bash
aws iam put-role-policy \
  --role-name gha-media-upload \
  --policy-name filemoverexpress-s3 \
  --policy-document file://s3.json
```

`s3:PutObject` covers `CreateMultipartUpload`, `UploadPart`, and `CompleteMultipartUpload`, so large files need nothing extra. If the bucket uses a customer-managed KMS key, also allow `kms:Decrypt` and `kms:GenerateDataKey` on that key.

## 4. Write the workflow

Create `.github/workflows/upload.yml`:

```yaml
name: Upload to S3

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  id-token: write # lets configure-aws-credentials request an OIDC token
  contents: read

jobs:
  upload:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - name: Build something to upload
        shell: bash
        run: |
          mkdir -p renders/frames
          date -u > renders/built-at.txt
          echo "${GITHUB_SHA}" > renders/frames/commit.txt

      - uses: aws-actions/configure-aws-credentials@v6
        with:
          role-to-assume: arn:aws:iam::123456789012:role/gha-media-upload
          aws-region: us-east-1

      - uses: lowlysre/setup-filemoverexpress@v1
        with:
          bucket: my-media-bucket
          validate-credentials: true

      - name: Upload
        shell: bash
        run: |
          filemoverexpress upload default renders --prefix "builds/${GITHUB_RUN_ID}" 2>&1 | tee fme.log
          if grep -qE $'^(\033\\[[0-9;]*m)*(ERROR|FATAL)' fme.log; then
            echo "::error::File Mover Express reported transfer errors"
            exit 1
          fi
```

Each step does one job:

- configure-aws-credentials exchanges the OIDC token for one-hour session credentials and exports them with `AWS_REGION`
- The action installs and verifies the CLI, then writes a transfer profile named `default` for `my-media-bucket`. It picks up the region from `AWS_REGION`, and `validate-credentials: true` fails the step if the role can't list the bucket
- The upload step uses `tee` and `grep` because the CLI exits 0 even when files fail to transfer. [Exit codes](../explanation/exit-codes.md) explains why

> [!TIP]
> The examples use major-version tags for readability. In your own workflows, pin every third-party action to a full commit SHA with the tag as a comment, for example `uses: lowlysre/setup-filemoverexpress@<full-sha> # v1.0.0`.

## 5. Run it

Commit the workflow and push to `main`. In the run log, the setup step ends with lines like:

```text
INFO   [2026-11-01 08:39:58] Validated credentials for default
```

The upload step lists each file as it transfers and then reports the job as completed.

## 6. Check the bucket

Relative paths keep their directory structure under the prefix, so the objects land at:

```bash
aws s3 ls "s3://my-media-bucket/builds/" --recursive
```

```text
2026-11-01 13:40:02         29 builds/1234567890/renders/built-at.txt
2026-11-01 13:40:02         41 builds/1234567890/renders/frames/commit.txt
```

## Next steps

- [Download those objects](../how-to/transfers.md#download-a-prefix) in a later job, or [tune throughput](../how-to/transfers.md#tune-throughput) for large media
- [Run transfers longer than an hour](../how-to/aws-credentials.md#run-transfers-longer-than-an-hour), past the default session length
- Read the [security model](../explanation/security.md) for what the action verifies before it runs anything
