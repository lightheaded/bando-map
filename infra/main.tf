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

# Deliberately not derived from var.domain. A bucket name is global and can
# never be changed, so tying it to an address means a 387 MB copy every time
# the address moves. Neither bucket is public -- the site bucket is
# CloudFront-only via OAC and the log bucket is written by the log-delivery
# service -- so neither name ever appears in a URL.
variable "bucket_name" {
  description = "Site bucket, private, CloudFront-only via OAC."
  type        = string
  default     = "bando-map-site"
}

variable "logs_bucket_name" {
  description = "CloudFront access-log bucket, private."
  type        = string
  default     = "bando-map-logs"
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

# ---------- CloudFront ----------

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "bando-map-site"
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
#
# There are two budgets, and the difference matters. `project` watches only what
# carries Project=bando-map, so it is the one that can say this project has run
# away. `monthly` watches the whole account, which holds far more than this
# project: the first time it fired, this project's whole share of the month was
# about eight cents. Read a `monthly` alert as "the account moved", never as
# "the map cost money", and keep budget_limit_usd set to whatever the rest of
# the account is expected to cost.
#
# A tag filter only sees costs recorded after its key was activated, so the
# project budget reads low until a full month has passed with
# activate_cost_allocation_tags on.

variable "alert_email" {
  description = "Email for the monthly cost-budget alert; null disables the budget"
  type        = string
  default     = null
  nullable    = true
}

variable "budget_limit_usd" {
  description = "Account-wide monthly ceiling. Not a project number — see the cost-guard comment above."
  type        = number
  default     = 15
}

variable "project_budget_limit_usd" {
  description = "Monthly ceiling for costs tagged Project=bando-map. The README projects well under a dollar."
  type        = number
  default     = 5
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

# What this repository is actually responsible for. Everything here is tagged
# Project=bando-map (see the default_tags in the provider block), so this is the
# only budget that answers the question the README's cost tables ask.
resource "aws_budgets_budget" "project" {
  count        = var.alert_email == null ? 0 : 1
  name         = "bando-map-cost-guard"
  budget_type  = "COST"
  limit_amount = tostring(var.project_budget_limit_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_filter {
    name   = "TagKeyValue"
    values = ["user:Project$bando-map"]
  }

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
