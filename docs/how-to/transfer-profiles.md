# Configure buckets and transfer profiles

A transfer profile maps one name to one bucket and its settings. The action writes it into `configuration.yaml` under `FME_CONFIG_DIR` when `bucket` is set, and every `filemoverexpress` command takes the profile name as its first argument.

## Use multiple buckets

Call the action once per bucket with a different `transfer-profile`:

```yaml
- uses: aws-actions/configure-aws-credentials@v6
  with:
    role-to-assume: arn:aws:iam::123456789012:role/gha-media-upload
    aws-region: us-east-1

- uses: lowlysre/setup-filemoverexpress@v1
  with:
    transfer-profile: renders
    bucket: my-renders-bucket

- uses: lowlysre/setup-filemoverexpress@v1
  with:
    transfer-profile: logs
    bucket: my-logs-bucket
    region: eu-west-1
    storage-class: standard_ia

- shell: bash
  run: |
    filemoverexpress upload renders ./renders --prefix "builds/${GITHUB_RUN_ID}"
    filemoverexpress upload logs ./logs --prefix "builds/${GITHUB_RUN_ID}"
```

The second call:

- Finds the CLI in the tool cache, so there's no second download. Its `cache-hit` output is `true`
- Merges the `logs` profile into the same `configuration.yaml`. Other profiles and any settings File Mover Express has written stay as they are
- Replaces a profile with the same name if one exists, so rerunning a step with new inputs updates it in place

The resulting file, before File Mover Express adds its own defaults on the first command:

```yaml
protocols:
  s3:
    transferProfiles:
      renders:
        bucket: my-renders-bucket
        region: us-east-1
        storageClass: standard
        accelerated: false
        checksums:
          enabled: false
          algorithm: none
      logs:
        bucket: my-logs-bucket
        region: eu-west-1
        storageClass: standard_ia
        accelerated: false
        checksums:
          enabled: false
          algorithm: none
```

Profile names are 1 to 64 characters: letters, digits, `.`, `_`, and `-`, starting with a letter or digit. The default is `default`.

A transfer profile only names a bucket; credentials come from the environment or an AWS named profile. To reach buckets in different accounts, give each transfer profile its own `aws-profile`, as in [Two accounts in one job](./aws-credentials.md#two-accounts-in-one-job).

## Set the storage class

```yaml
- uses: lowlysre/setup-filemoverexpress@v1
  with:
    bucket: my-archive-bucket
    storage-class: deep_archive
```

| `storage-class`       | S3 storage class              | Readable right away |
| --------------------- | ----------------------------- | ------------------- |
| `standard` (default)  | S3 Standard                   | Yes                 |
| `intelligent_tiering` | S3 Intelligent-Tiering        | Yes                 |
| `standard_ia`         | S3 Standard-IA                | Yes                 |
| `onezone_ia`          | S3 One Zone-IA                | Yes                 |
| `glacier_ir`          | S3 Glacier Instant Retrieval  | Yes                 |
| `glacier`             | S3 Glacier Flexible Retrieval | No, restore first   |
| `deep_archive`        | S3 Glacier Deep Archive       | No, restore first   |
| `reduced_redundancy`  | Reduced Redundancy (legacy)   | Yes                 |

Values are case-insensitive and accept hyphens in place of underscores, so `STANDARD_IA` and `standard-ia` both work. The IA and Glacier classes bill a minimum storage duration and object size, so they suit files you keep, not short-lived build output.

Objects in `glacier` or `deep_archive` have to be restored before File Mover Express can download them. Use a separate transfer profile with `standard` for anything a later job reads back.

## Turn on checksums

```yaml
- uses: lowlysre/setup-filemoverexpress@v1
  with:
    bucket: my-media-bucket
    checksum-algorithm: xxh3
```

Any value other than `none` writes `checksums.enabled: true` and the algorithm into the transfer profile. File Mover Express then hashes each file before upload, stores the hash as object metadata, and uses it to decide whether a file changed. It keeps computed hashes in `checksum-cache.db` inside `FME_CONFIG_DIR`, which lasts for the job.

| `checksum-algorithm` | Notes                                                 |
| -------------------- | ----------------------------------------------------- |
| `none` (default)     | No hashing                                            |
| `md5-hex`            | MD5 as hex. The most widely recognized by other tools |
| `xxhash`             | xxHash                                                |
| `xxhash64`           | 64-bit xxHash                                         |
| `xxh3`               | XXH3. The fastest of the four on modern CPUs          |

Hashing reads every file once more before upload. On a runner with more than a couple of cores, raise `--max-active-checksums` so hashing doesn't hold up the transfer; see [Upload and download faster](./transfers.md#with-checksums-turned-on).

> [!NOTE]
> These checksums are File Mover Express metadata. They're separate from the S3 additional checksums (`x-amz-checksum-*`) that S3 itself validates.

## Use Transfer Acceleration

S3 Transfer Acceleration routes traffic through the nearest CloudFront edge location. It helps when the runner is far from the bucket's region, for example a runner in the US uploading to `ap-southeast-2`.

Acceleration is a bucket setting. Turn it on once, from an account with `s3:PutAccelerateConfiguration`; the bucket name can't contain dots:

```bash
aws s3api put-bucket-accelerate-configuration \
  --bucket my-media-bucket \
  --accelerate-configuration Status=Enabled
```

Then set `accelerate: true`, which writes `accelerated: true` into the transfer profile so File Mover Express sends requests to the `s3-accelerate` endpoint. The IAM permissions don't change. To measure the gain, write a second profile for the same bucket and time both:

```yaml
- uses: lowlysre/setup-filemoverexpress@v1
  with:
    transfer-profile: direct
    bucket: my-media-bucket

- uses: lowlysre/setup-filemoverexpress@v1
  with:
    transfer-profile: accelerated
    bucket: my-media-bucket
    accelerate: true

- shell: bash
  run: |
    time filemoverexpress upload direct ./sample --prefix speedtest/direct
    time filemoverexpress upload accelerated ./sample --prefix speedtest/accelerated
```

Restrictions:

- `accelerate` and `endpoint` are mutually exclusive. Acceleration only exists on Amazon S3, so the action fails if both are set
- Accelerated transfers cost more per GB than standard transfers. AWS doesn't charge the acceleration fee when it doesn't speed up a transfer
- The [Amazon S3 Transfer Acceleration Speed Comparison tool](https://s3-accelerate-speedtest.s3-accelerate.amazonaws.com/en/accelerate-speed-comparsion.html) shows the expected gain from a given location

## Encryption

The action doesn't expose an encryption setting. Set default encryption on the bucket (SSE-S3 or SSE-KMS) and every object File Mover Express writes inherits it. With a customer-managed KMS key, add `kms:Decrypt` and `kms:GenerateDataKey` on that key to the role's policy.
