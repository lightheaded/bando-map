# ---------- Visit stats: CloudFront access logs -> S3 -> daily rollup ----------
# CloudFront standard logging (v2) writes a trimmed set of fields (including the
# viewer country) to a private bucket; a scheduled Lambda folds each day into a
# single stat#YYYY-MM-DD item in the sync table, which GET /admin/overview
# serves to the Admin panel.
#
# Why server-side logs and not a client beacon: bots don't run JavaScript, so a
# beacon can only ever show the traffic we already trust — the point here is to
# see the crawler noise and tell it apart by country and user agent. It also
# means no public write endpoint to abuse.
#
# Cost: log delivery to S3 is free of charge; storage is a few MB. The one line
# item that scales with traffic is the S3 GETs the rollup makes re-reading the
# window each run — see README "Cost" and the two variables below.

variable "stats_rollup_schedule" {
  description = "How often the rollup re-reads the log window (EventBridge schedule expression)"
  type        = string
  default     = "rate(6 hours)"
}

variable "stats_rollup_days" {
  description = <<-EOT
    How many days back each rollup run recomputes, today included. Two covers
    late-delivered logs (CloudFront delivers within minutes to about an hour)
    while keeping the re-read cost down; every run is a full recompute of those
    days, so the numbers are idempotent and self-healing.
  EOT
  type        = number
  default     = 2
}

variable "stats_log_retention_days" {
  description = <<-EOT
    Days to keep raw access logs before S3 expires them. 2557 (the default) is
    seven years — 7*365 plus the two leap days any seven-year window can carry,
    so the archive always covers a full seven years rather than falling a day or
    two short. Raw logs carry viewer IPs, so this is the knob that bounds how
    long those are retained; the daily aggregates never hold one and are kept
    indefinitely, so the visit history outlives the records it came from. Set
    null to keep the raw logs forever instead.
  EOT
  type        = number
  default     = 2557
  nullable    = true
}

data "aws_caller_identity" "current" {}

# CloudFront's vended-log delivery appends this prefix when the destination ARN
# carries none of its own; the bucket policy and the rollup both key off it.
locals {
  cf_log_prefix = "AWSLogs/${data.aws_caller_identity.current.account_id}/CloudFront"
}

# ----- Log bucket -----

resource "aws_s3_bucket" "logs" {
  bucket = "${var.domain}-logs"
  tags   = { Component = "stats" }
}

resource "aws_s3_bucket_public_access_block" "logs" {
  bucket                  = aws_s3_bucket.logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Expires the raw logs after stats_log_retention_days (seven years by default).
# Skipped entirely if that is set to null, which keeps them forever.
resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  count  = var.stats_log_retention_days == null ? 0 : 1
  bucket = aws_s3_bucket.logs.id

  rule {
    id     = "expire-access-logs"
    status = "Enabled"

    filter {
      prefix = "${local.cf_log_prefix}/"
    }

    expiration {
      days = var.stats_log_retention_days
    }
  }
}

resource "aws_s3_bucket_policy" "logs" {
  bucket = aws_s3_bucket.logs.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AWSLogsDeliveryWrite"
      Effect    = "Allow"
      Principal = { Service = "delivery.logs.amazonaws.com" }
      Action    = "s3:PutObject"
      Resource  = "${aws_s3_bucket.logs.arn}/${local.cf_log_prefix}/*"
      Condition = {
        StringEquals = {
          "s3:x-amz-acl"      = "bucket-owner-full-control"
          "aws:SourceAccount" = data.aws_caller_identity.current.account_id
        }
        ArnLike = {
          "aws:SourceArn" = "arn:aws:logs:us-east-1:${data.aws_caller_identity.current.account_id}:delivery-source:*"
        }
      }
    }]
  })
}

# ----- Standard logging (v2) delivery -----
# The CloudWatch delivery API for a CloudFront distribution lives in us-east-1
# even though the destination bucket is in eu-north-1.

resource "aws_cloudwatch_log_delivery_source" "cf_access" {
  provider     = aws.us_east_1
  name         = "bando-map-cf-access"
  log_type     = "ACCESS_LOGS"
  resource_arn = aws_cloudfront_distribution.site.arn
  tags         = { Component = "stats" }
}

resource "aws_cloudwatch_log_delivery_destination" "cf_access_s3" {
  provider      = aws.us_east_1
  name          = "bando-map-cf-access-s3"
  output_format = "json"
  tags          = { Component = "stats" }

  delivery_destination_configuration {
    destination_resource_arn = aws_s3_bucket.logs.arn
  }
}

resource "aws_cloudwatch_log_delivery" "cf_access_s3" {
  provider                 = aws.us_east_1
  delivery_source_name     = aws_cloudwatch_log_delivery_source.cf_access.name
  delivery_destination_arn = aws_cloudwatch_log_delivery_destination.cf_access_s3.arn
  tags                     = { Component = "stats" }

  # Only what the rollup reads: enough to count page views per day, split
  # humans from crawlers by user agent, and group by viewer country. No
  # referrer, no cookies, no query strings.
  record_fields = [
    "date",
    "time",
    "c-ip",
    "cs-uri-stem",
    "sc-status",
    "cs(User-Agent)",
    "c-country",
    "x-edge-result-type",
  ]

  s3_delivery_configuration {
    # Appended to local.cf_log_prefix; the rollup lists one day at a time.
    suffix_path                 = "/{yyyy}/{MM}/{dd}"
    enable_hive_compatible_path = false
  }
}

# ----- Rollup Lambda -----

data "archive_file" "stats_rollup" {
  type        = "zip"
  source_file = "${path.module}/../backend/rollup.mjs"
  output_path = "${path.module}/.terraform/tmp/stats-rollup.zip"
}

resource "aws_iam_role" "stats_rollup" {
  name = "bando-map-stats-rollup"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "stats_rollup" {
  name = "rollup"
  role = aws_iam_role.stats_rollup.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.logs.arn
        Condition = {
          StringLike = { "s3:prefix" = "${local.cf_log_prefix}/*" }
        }
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.logs.arn}/${local.cf_log_prefix}/*"
      },
      # One item per day, overwritten on every run.
      {
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem"]
        Resource = aws_dynamodb_table.sync.arn
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.stats_rollup.arn}:*"
      },
    ]
  })
}

resource "aws_cloudwatch_log_group" "stats_rollup" {
  name              = "/aws/lambda/bando-map-stats-rollup"
  retention_in_days = 14
  tags              = { Component = "stats" }
}

resource "aws_lambda_function" "stats_rollup" {
  function_name    = "bando-map-stats-rollup"
  role             = aws_iam_role.stats_rollup.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "rollup.handler"
  filename         = data.archive_file.stats_rollup.output_path
  source_code_hash = data.archive_file.stats_rollup.output_base64sha256
  memory_size      = 512
  timeout          = 120
  tags             = { Component = "stats" }

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.sync.name
      LOG_BUCKET = aws_s3_bucket.logs.bucket
      LOG_PREFIX = local.cf_log_prefix
      DAYS       = tostring(var.stats_rollup_days)
    }
  }

  depends_on = [aws_cloudwatch_log_group.stats_rollup]
}

# Scheduled rules are free; the invocations sit inside Lambda's free tier.
resource "aws_cloudwatch_event_rule" "stats_rollup" {
  name                = "bando-map-stats-rollup"
  description         = "Fold CloudFront access logs into daily visit counts"
  schedule_expression = var.stats_rollup_schedule
  tags                = { Component = "stats" }
}

resource "aws_cloudwatch_event_target" "stats_rollup" {
  rule = aws_cloudwatch_event_rule.stats_rollup.name
  arn  = aws_lambda_function.stats_rollup.arn
}

resource "aws_lambda_permission" "stats_rollup_events" {
  statement_id  = "AllowEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.stats_rollup.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.stats_rollup.arn
}

# ----- Outputs -----

output "logs_bucket" {
  value = aws_s3_bucket.logs.bucket
}

output "stats_rollup_function" {
  value = aws_lambda_function.stats_rollup.function_name
}
