terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "domain" {
  description = "The address the site answers on."
  type        = string
  default     = "bando.toom.as"
}

# The address the site answered on until 2026-08-26. It is kept alive on its
# own CloudFront distribution, which 301s every request to var.domain, so
# links and bookmarks published before the move still work. Retiring it means
# deleting aws_cloudfront_distribution.legacy and its two Route53 records --
# nothing else here depends on it.
variable "legacy_domain" {
  description = "Retired address, permanently redirected to var.domain."
  type        = string
  default     = "bando.toom.as"
}

# The zone that holds the LEGACY domain, and only that. var.domain lives under
# toom.as, whose zone is not managed here -- see the certificate section below.
variable "zone_name" {
  description = "Route53 zone holding var.legacy_domain."
  type        = string
  default     = "toom.as"
}

# Bucket names are global and permanent, so both buckets keep the names they
# were created with in April 2026, before the domain moved. Neither is public:
# the site bucket is CloudFront-only via OAC and the log bucket is written by
# the log-delivery service, so the stale domain in the name never appears in a
# URL. Renaming them would mean copying 387 MB, re-pointing the deploy
# workflow's S3_BUCKET variable and re-issuing the OAC, for a cosmetic gain.
variable "bucket_name" {
  description = "Site bucket. Keeps its original name; see the comment above."
  type        = string
  default     = "bando.toom.as"
}

variable "aws_profile" {
  description = "AWS shared-config profile; leave null to use ambient env credentials"
  type        = string
  default     = null
  nullable    = true
}

variable "github_oidc_sub" {
  description = <<-EOT
    Exact OIDC subject claim allowed to assume the deploy role. GitHub's
    current default embeds owner and repo IDs (resource-reuse protection);
    read the live value with:
    gh api repos/<owner>/<repo>/actions/oidc/customization/sub --jq .sub_claim_prefix
  EOT
  type        = string
  default     = "repo:lightheaded@3413870/bando-map@1330907098:ref:refs/heads/main"
}

# Stamped on every taggable resource via default_tags; per-resource tags add
# Component (site | sync) so Cost Explorer can split hosting from the backend.
locals {
  tags = {
    Project   = "bando-map"
    ManagedBy = "terraform"
  }
}

provider "aws" {
  region  = "eu-north-1"
  profile = var.aws_profile

  default_tags {
    tags = local.tags
  }
}

# CloudFront certificates must live in us-east-1.
provider "aws" {
  alias   = "us_east_1"
  region  = "us-east-1"
  profile = var.aws_profile

  default_tags {
    tags = local.tags
  }
}

data "aws_route53_zone" "main" {
  name = var.zone_name
}

# ---------- S3 (private, CloudFront-only via OAC) ----------

resource "aws_s3_bucket" "site" {
  bucket = var.bucket_name
  tags   = { Component = "site" }
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontOAC"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.site.arn}/*"
      Condition = {
        StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.site.arn }
      }
    }]
  })
}

# ---------- Certificates ----------
# Two of them, because the site answers on two names whose DNS is served by two
# different providers.
#
# THE LIVE CERTIFICATE IS VALIDATED OUTSIDE THIS REPOSITORY. The toom.as zone
# is not terraformed here, so this configuration cannot publish the validation
# record itself. Its value is the cert_validation_record output at the bottom of
# this file. Issuing this certificate is therefore a three-step apply:
#
#   1. terraform apply -target=aws_acm_certificate.site
#   2. terraform output -json cert_validation_record
#      -> publish that name and value as a CNAME in the zone
#   3. terraform apply
#
# Step 2 is needed only when the certificate is CREATED. ACM re-uses the same
# validation record for renewals, so a renewal needs nothing. Replacing the
# resource -- adding a SAN, changing the domain -- issues a NEW record, and the
# apply then sits waiting up to 45 minutes until it is published. If an apply
# hangs on aws_acm_certificate_validation.site, that is why.

resource "aws_acm_certificate" "site" {
  provider          = aws.us_east_1
  domain_name       = var.domain
  validation_method = "DNS"
  tags              = { Component = "site" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate_validation" "site" {
  provider        = aws.us_east_1
  certificate_arn = aws_acm_certificate.site.arn
  validation_record_fqdns = [
    for dvo in aws_acm_certificate.site.domain_validation_options :
    trimsuffix(dvo.resource_record_name, ".")
  ]
}

# The legacy certificate covers the retired address only, and stays in Route53
# where that zone still lives. It is what lets the redirect distribution
# terminate TLS, so a visitor on an old link gets the 301 instead of a
# certificate warning.

resource "aws_acm_certificate" "legacy" {
  provider          = aws.us_east_1
  domain_name       = var.legacy_domain
  validation_method = "DNS"
  tags              = { Component = "site" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "legacy_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.legacy.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  }
  zone_id = data.aws_route53_zone.main.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 300
  records = [each.value.record]
}

resource "aws_acm_certificate_validation" "legacy" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.legacy.arn
  validation_record_fqdns = [for r in aws_route53_record.legacy_cert_validation : r.fqdn]
}

# ---------- CloudFront ----------

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = var.bucket_name
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "bando-map"
  default_root_object = "index.html"
  aliases             = [var.domain]
  price_class         = "PriceClass_100"
  http_version        = "http2and3"
  tags                = { Component = "site" }

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    target_origin_id       = "s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    # AWS managed CachingOptimized policy
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  }

  # SPA: unknown paths (S3+OAC answers 403) fall back to the app shell.
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 60
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.site.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# ---------- Redirect for the retired address ----------
# A second distribution rather than a second alias on the live one, for two
# reasons. The live distribution keeps a hot path with no function on it, and
# retiring the old address one day is then a delete of this block instead of
# surgery on the distribution that serves everybody.

resource "aws_cloudfront_function" "legacy_redirect" {
  name    = "bando-map-legacy-redirect"
  runtime = "cloudfront-js-2.0"
  comment = "301 the retired address to the live one, path and query preserved"
  publish = true
  code    = templatefile("${path.module}/legacy-redirect.js", { target = var.domain })
}

resource "aws_cloudfront_distribution" "legacy" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "bando-map redirect (${var.legacy_domain})"
  aliases         = [var.legacy_domain]
  price_class     = "PriceClass_100"
  http_version    = "http2and3"
  tags            = { Component = "site" }

  # CloudFront refuses to serve one name from two distributions, so the live
  # distribution has to drop this alias before this one can claim it. Nothing
  # else here creates that ordering.
  depends_on = [aws_cloudfront_distribution.site]

  # Declared because a distribution must have an origin, and never reached:
  # the viewer-request function answers every request itself. No OAC, and the
  # bucket policy grants only the live distribution.
  origin {
    domain_name = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id   = "unused"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id       = "unused"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    # AWS managed CachingDisabled. The response depends on the path and the
    # query, and computing it costs a fraction of a cent per million requests.
    cache_policy_id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.legacy_redirect.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.legacy.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# ---------- DNS ----------
# Only the retired address is served from here. The live address is a CNAME in
# a zone this configuration does not manage -- see the certificate section above.

resource "aws_route53_record" "legacy_a" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.legacy_domain
  type    = "A"
  alias {
    name                   = aws_cloudfront_distribution.legacy.domain_name
    zone_id                = aws_cloudfront_distribution.legacy.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "legacy_aaaa" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.legacy_domain
  type    = "AAAA"
  alias {
    name                   = aws_cloudfront_distribution.legacy.domain_name
    zone_id                = aws_cloudfront_distribution.legacy.hosted_zone_id
    evaluate_target_health = false
  }
}

# ---------- GitHub Actions OIDC deploy role ----------

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  # GitHub rotates between two signing certs — list both thumbprints.
  thumbprint_list = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
  ]
}

resource "aws_iam_role" "github_deploy" {
  name = "bando-map-github-deploy"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = var.github_oidc_sub
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_deploy" {
  name = "deploy-site"
  role = aws_iam_role.github_deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.site.arn
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.site.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["cloudfront:CreateInvalidation"]
        Resource = aws_cloudfront_distribution.site.arn
      }
    ]
  })
}

# ---------- Cost guard ----------
# CloudFront's permanent free tier covers 1 TB/month egress; this is the
# backstop that emails before a runaway bill. Set alert_email to enable.

variable "alert_email" {
  description = "Email for the monthly cost-budget alert; null disables the budget"
  type        = string
  default     = null
  nullable    = true
}

variable "budget_limit_usd" {
  type    = number
  default = 15
}

# Tags only show up in Cost Explorer once activated as cost-allocation tags.
# AWS lists a tag key for activation only after billing has seen it on a
# resource (up to 24h after the tagging apply), so this is opt-in: flip it on
# in a later apply once the keys appear, or activate them once by hand in
# Billing → Cost allocation tags.
variable "activate_cost_allocation_tags" {
  type    = bool
  default = false
}

resource "aws_ce_cost_allocation_tag" "keys" {
  for_each = var.activate_cost_allocation_tags ? toset(["Project", "Component"]) : toset([])
  tag_key  = each.value
  status   = "Active"
}

resource "aws_budgets_budget" "monthly" {
  count        = var.alert_email == null ? 0 : 1
  name         = "monthly-cost-guard"
  budget_type  = "COST"
  limit_amount = tostring(var.budget_limit_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }
}

# ---------- Outputs ----------

output "bucket" {
  value = aws_s3_bucket.site.bucket
}

output "distribution_id" {
  value = aws_cloudfront_distribution.site.id
}

output "deploy_role_arn" {
  value = aws_iam_role.github_deploy.arn
}

output "url" {
  value = "https://${var.domain}"
}

output "legacy_url" {
  value = "https://${var.legacy_domain}"
}

# The CNAME that must exist in the zone for the live certificate to validate.
# Empty braces mean the certificate is already issued and the record is in place.
output "cert_validation_record" {
  description = "ACM validation CNAME for var.domain; publish it in the zone."
  value = {
    for dvo in aws_acm_certificate.site.domain_validation_options :
    trimsuffix(dvo.resource_record_name, ".") => trimsuffix(dvo.resource_record_value, ".")
  }
}

# The CNAME target for bando.toom.as, also published in the zone.
output "distribution_domain" {
  value = aws_cloudfront_distribution.site.domain_name
}
