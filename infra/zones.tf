# ---------- UAS zones: EANS feed -> Lambda -> data/zones.json on the CDN ----------
# Estonia's official drone map (utm.eans.ee/avm) is backed by a public but
# undocumented GeoJSON feed. It is 5.1 MB uncompressed and served
# `Cache-Control: private, max-age=1`, so every viewer hitting it directly would
# pay for the whole thing every time. This Lambda pays that once per schedule
# tick, trims it to about a fifth (see backend/zones.mjs) and parks the result
# in the site bucket, where CloudFront compresses and caches it like any other
# file under data/.
#
# Two triggers share one function: the schedule below, and POST /zones/refresh
# on the existing HTTP API for the in-app "refresh" button. The manual path is
# throttled by counters in the sync table rather than by an account, because the
# map is usable signed-out.
#
# Cost: one outbound fetch an hour and one small S3 PUT; the invalidation only
# fires when the zones actually changed. See README "Cost".

variable "zones_schedule" {
  description = <<-EOT
    How often the fetcher polls the source (EventBridge schedule expression).
    Nothing here pushes back on a faster rate — the feed is free and
    unauthenticated, and the invocations sit inside Lambda's free tier at any
    interval worth using. The reason not to go faster is manners: EANS serves
    this for the whole country, the zones change a few times a day at most, and
    an hour is already well inside the resolution a pilot can act on.
  EOT
  type        = string
  default     = "rate(1 hour)"
}

variable "zones_source_url" {
  description = "GeoJSON feed behind the EANS Estonian Drone Map"
  type        = string
  default     = "https://utm.eans.ee/avm/utm/uas.geojson"
}

variable "zones_per_client_daily" {
  description = <<-EOT
    Manual refreshes one client may spend per day. A pilot checking airspace
    before a flight needs one; three leaves room for a genuine retry after the
    source times out, and makes a single abuser burn their own quota before the
    shared hourly one below.
  EOT
  type        = number
  default     = 3
}

variable "zones_global_hourly" {
  description = <<-EOT
    Manual refreshes everyone together may spend per hour. This is what bounds
    the load we put on EANS no matter how many clients ask: ten on top of the
    scheduled poll is still an order of magnitude below what a browser tab
    hitting the feed directly would cost them.
  EOT
  type        = number
  default     = 10
}

# Salts the HMAC that stands in for a viewer IP in the throttle counters, so the
# per-client key cannot be turned back into an address — the table holds a hash
# and a count, and nothing that identifies who spent it. Generated rather than
# configured because nobody ever needs to know its value; it lands in the local
# tfstate, which is gitignored and never committed.
resource "random_password" "zones_ip_salt" {
  length  = 32
  special = false
}

# ----- Fetcher Lambda -----

data "archive_file" "zones" {
  type        = "zip"
  source_file = "${path.module}/../backend/zones.mjs"
  output_path = "${path.module}/.terraform/tmp/zones.zip"
}

resource "aws_iam_role" "zones" {
  name = "bando-map-zones"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "zones" {
  name = "zones"
  role = aws_iam_role.zones.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # One file, rewritten in place on every run — not the rest of the site.
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.site.arn}/data/zones.json"
      },
      {
        Effect   = "Allow"
        Action   = ["cloudfront:CreateInvalidation"]
        Resource = aws_cloudfront_distribution.site.arn
      },
      # The published-state item plus the manual-refresh throttle counters.
      {
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
        Resource = aws_dynamodb_table.sync.arn
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.zones.arn}:*"
      },
    ]
  })
}

resource "aws_cloudwatch_log_group" "zones" {
  name              = "/aws/lambda/bando-map-zones"
  retention_in_days = 14
  tags              = { Component = "zones" }
}

# Stays out of a VPC on purpose. It is the one component here that reaches the
# public internet, and a VPC Lambda only gets outbound through a NAT gateway —
# which bills by the hour whether or not anything flows through it, and alone
# would cost more than every other component of this project combined.
resource "aws_lambda_function" "zones" {
  function_name    = "bando-map-zones"
  role             = aws_iam_role.zones.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "zones.handler"
  filename         = data.archive_file.zones.output_path
  source_code_hash = data.archive_file.zones.output_base64sha256
  memory_size      = 512
  timeout          = 60
  tags             = { Component = "zones" }

  environment {
    variables = {
      TABLE_NAME       = aws_dynamodb_table.sync.name
      SITE_BUCKET      = aws_s3_bucket.site.bucket
      DISTRIBUTION_ID  = aws_cloudfront_distribution.site.id
      SOURCE_URL       = var.zones_source_url
      PER_CLIENT_DAILY = tostring(var.zones_per_client_daily)
      GLOBAL_HOURLY    = tostring(var.zones_global_hourly)
      IP_SALT          = random_password.zones_ip_salt.result
    }
  }

  depends_on = [aws_cloudwatch_log_group.zones]
}

# ----- Schedule -----

resource "aws_cloudwatch_event_rule" "zones" {
  name                = "bando-map-zones"
  description         = "Refresh the published UAS geographical zones"
  schedule_expression = var.zones_schedule
  tags                = { Component = "zones" }
}

resource "aws_cloudwatch_event_target" "zones" {
  rule = aws_cloudwatch_event_rule.zones.name
  arn  = aws_lambda_function.zones.arn
}

resource "aws_lambda_permission" "zones_events" {
  statement_id  = "AllowEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.zones.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.zones.arn
}

# ----- Manual refresh on the existing HTTP API -----

resource "aws_apigatewayv2_integration" "zones" {
  api_id                 = aws_apigatewayv2_api.sync.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.zones.invoke_arn
  payload_format_version = "2.0"
}

# The only unauthenticated route on this API, and it has to be: the map is
# fully usable signed-out, so someone checking airspace before a flight must be
# able to force a refresh without an account. The throttle counters in the sync
# table are the actual control — per client per day, and everyone together per
# hour — and the stage's 10 rps / 20 burst setting is the backstop under them.
resource "aws_apigatewayv2_route" "zones_refresh" {
  api_id             = aws_apigatewayv2_api.sync.id
  route_key          = "POST /zones/refresh"
  target             = "integrations/${aws_apigatewayv2_integration.zones.id}"
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "zones_apigw" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.zones.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.sync.execution_arn}/*/*"
}

# ----- Outputs -----

output "zones_function" {
  value = aws_lambda_function.zones.function_name
}

output "zones_url" {
  value = "https://${var.domain}/data/zones.json"
}
