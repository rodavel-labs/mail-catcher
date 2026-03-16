# Deployment Guide

ses-inbox deploys to AWS using [SST v4](https://sst.dev) (built on Pulumi).

## Prerequisites

- AWS account with credentials configured (`AWS_PROFILE` or environment variables)
- [Bun](https://bun.sh) installed
- A domain or subdomain you control for receiving emails

> **Important:** If you are **not** using Route 53 for DNS and want a custom API domain, you must provision and validate an ACM certificate **before** deploying. The certificate must be in `us-east-1`, match your `API_DOMAIN` exactly, and show status **Issued**. If the certificate is still pending validation, the deploy will fail with `reading ACM Certificates: empty result`. See [Step 2](#step-2-provision-acm-certificate-external-dns-only) for details.

## Step 1: Configure environment variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

### Required

| Variable | Description |
| --- | --- |
| `AWS_PROFILE` | AWS CLI profile to use |
| `AWS_REGION` | SES inbound region: `us-east-1`, `us-west-2`, or `eu-west-1` |
| `SES_DOMAIN` | Domain for receiving emails (e.g. `receive.yourdomain.com`) |

### Optional

| Variable | Description |
| --- | --- |
| `HOSTED_ZONE_ID` | Route 53 hosted zone ID — enables automatic DNS and certificate management |
| `API_DOMAIN` | Custom domain for the API (e.g. `api.inbox.yourdomain.com`) |

**How they interact:**

- `HOSTED_ZONE_ID` set → DNS records (MX, TXT) and ACM certificates are created and validated automatically
- `HOSTED_ZONE_ID` omitted → you manage DNS externally; deploy outputs a `.sst/dns-records.zone` file to import
- `API_DOMAIN` set + `HOSTED_ZONE_ID` → custom domain with automatic DNS and certificate
- `API_DOMAIN` set without `HOSTED_ZONE_ID` → custom domain using a pre-provisioned ACM certificate (looked up by domain at deploy time)
- `API_DOMAIN` omitted → API is served at the default Lambda Function URL

> **Use a subdomain** (e.g. `receive.yourdomain.com`) rather than your root domain. This avoids conflicts with existing MX records for your primary email.

## Step 2: Provision ACM certificate (external DNS only)

**Skip this step if you are using Route 53 (`HOSTED_ZONE_ID` is set).**

If you set `API_DOMAIN` without `HOSTED_ZONE_ID`, you need a validated ACM certificate before deploying. The domain on the certificate must match `API_DOMAIN` exactly.

### 2a. Request the certificate

The certificate must be in the same region defined in your `.env` (`AWS_REGION`), which must be one of the three SES inbound regions:

- `us-east-1` (US East - N. Virginia)
- `us-west-2` (US West - Oregon)
- `eu-west-1` (Europe - Ireland)

```bash
aws acm request-certificate \
  --domain-name api.inbox.yourdomain.com \
  --validation-method DNS \
  --region $AWS_REGION
```

Save the `CertificateArn` from the output.

### 2b. Get the validation CNAME

```bash
aws acm describe-certificate \
  --certificate-arn <arn-from-above> \
  --query "Certificate.DomainValidationOptions[0].ResourceRecord" \
  --region $AWS_REGION
```

Add the returned CNAME record in your DNS provider.

### 2c. Wait for the certificate to be issued

```bash
aws acm describe-certificate \
  --certificate-arn <arn-from-above> \
  --query "Certificate.Status" \
  --region $AWS_REGION
```

**Do not proceed to Step 3 until the status is `ISSUED`.** A pending certificate will cause the deploy to fail.

## Step 3: Deploy

```bash
bun run deploy:dev       # dev stage
bun run deploy:prod      # production stage
```

SST uses **stages** to isolate environments. Each stage creates its own set of resources:

- S3 bucket for raw `.eml` files (8-day lifecycle)
- DynamoDB tables for email metadata (7-day TTL) and API keys
- API Lambda (Hono HTTP handler)
- Ingest Lambda (S3 event handler that parses emails into DynamoDB)
- SES domain identity and receipt rules
- CloudFront distribution + Router (only when `API_DOMAIN` is set)
- DNS records in Route 53 (only when `HOSTED_ZONE_ID` is set)

## Step 4: Configure DNS records (external DNS only)

**Skip this step if you are using Route 53 (`HOSTED_ZONE_ID` is set).**

After deployment, a BIND zone file is generated at `.sst/dns-records.zone` containing all required DNS records.

**Cloudflare:** Go to your domain → DNS → Records → Import and Export → Upload `.sst/dns-records.zone`. After importing, ensure the API CNAME record has **Proxy status** set to **DNS only** (grey cloud). Proxying through Cloudflare will cause **Error 1016** because CloudFront must terminate TLS directly for the custom domain.

**Other providers:** Open the file and add the records manually. It contains:

- **TXT** record on `_amazonses.<domain>` — SES domain verification (do not remove)
- **MX** record on `<domain>` — routes inbound email to SES
- **CNAME** record for `<api-domain>` → CloudFront distribution (only when `API_DOMAIN` is set)

### Verify DNS propagation

```bash
dig MX receive.yourdomain.com
dig TXT _amazonses.receive.yourdomain.com
```

### Verify SES

Go to [SES → Verified Identities](https://console.aws.amazon.com/ses/home#/verified-identities) to confirm your domain shows as **Verified**.

## Step 5: Verify the deployment

Once DNS is propagated, verify the API is reachable:

```bash
curl https://<your-api-url>/health
```

The `apiUrl` is printed in the deploy output and saved to `.sst/outputs.json`. It will be your custom domain if `API_DOMAIN` is configured, otherwise the Lambda Function URL.

## Data retention

- **DynamoDB entries** expire after **7 days** (automatic TTL)
- **S3 raw emails** expire after **8 days** (lifecycle rule)
- The 1-day buffer ensures S3 objects are cleaned up after their DynamoDB index entries expire

## Teardown

```bash
bun run remove:dev       # Remove dev stage (deletes all resources)
```

- `dev` stage — all resources are deleted on removal
- `prod` stage — resources are **retained** on removal (safety measure to prevent data loss). To fully delete, remove resources manually in the AWS Console or change the removal policy in `sst.config.ts`

## Troubleshooting

### Emails not arriving

1. **Check DNS records** — verify MX and TXT records are correctly set using `dig`
2. **Check SES verification** — ensure the domain is verified in the SES Console
3. **Check the region** — SES inbound only works in `us-east-1`, `us-west-2`, `eu-west-1`
4. **Check the S3 bucket** — look for `.eml` files under the `incoming/` prefix
5. **Check the Ingest Lambda logs** — CloudWatch logs will show parsing errors

### API returns empty results

1. **Check the inbox name** — it's the local part of the email address (before `@`), case-insensitive
2. **Wait for processing** — there's a small delay between email arrival and API availability
3. **Use long-poll** — add `?wait=true` to wait for emails to arrive

### Deploy fails

1. **Check your AWS region** — must be `us-east-1`, `us-west-2`, or `eu-west-1`
2. **Check AWS credentials** — ensure your `AWS_PROFILE` has the necessary permissions
3. **SES receipt rule conflict** — only one active receipt rule set is allowed per AWS account per region. If you have an existing rule set, you may need to deactivate it first

### `reading ACM Certificates: empty result`

The ACM certificate lookup failed. This means no issued certificate was found for your `API_DOMAIN`. Verify:

1. The certificate domain matches `API_DOMAIN` exactly
2. The certificate is in the same region as your deployment (`AWS_REGION`)
3. The certificate status is **Issued**, not Pending Validation

```bash
aws acm list-certificates --region $AWS_REGION \
  --query "CertificateSummaryList[?DomainName=='api.inbox.yourdomain.com']"
```

### Deploy hangs on deleting `ApiRouterCdnSslCertificate`

This can happen when switching from Route 53 to external DNS. SST tries to delete the certificate it previously created, but CloudFront may hold onto it. If the delete hangs for more than 5 minutes, cancel the deploy and retry. If it persists, remove the router first:

```bash
bun x sst remove --stage dev --target ApiRouter
```

Then redeploy.
