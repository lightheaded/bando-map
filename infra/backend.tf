# ---------- Sync backend: Cognito + HTTP API + Lambda + DynamoDB ----------
# Everything here scales to zero: Cognito (Lite) is free for this user count,
# the API and Lambda are priced per request, DynamoDB is on-demand and the
# data (a few KB per user) sits far inside the always-free 25 GB.
# Idle cost: $0.00/month. See README "Cost" for the load math.

variable "api_domain" {
  type    = string
  default = "api.bando.lagle.xyz"
}

# ----- Data -----

resource "aws_dynamodb_table" "sync" {
  name         = "bando-map-sync"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  tags         = { Component = "sync" }

  attribute {
    name = "pk"
    type = "S"
  }
}

# ----- Lambda -----

data "archive_file" "sync_handler" {
  type        = "zip"
  source_file = "${path.module}/../backend/handler.mjs"
  output_path = "${path.module}/.terraform/tmp/sync-handler.zip"
}

resource "aws_iam_role" "sync_lambda" {
  name = "bando-map-sync-lambda"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "sync_lambda" {
  name = "sync"
  role = aws_iam_role.sync_lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem"]
        Resource = aws_dynamodb_table.sync.arn
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.sync_lambda.arn}:*"
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "sync_lambda" {
  name              = "/aws/lambda/bando-map-sync"
  retention_in_days = 14
  tags              = { Component = "sync" }
}

resource "aws_lambda_function" "sync" {
  function_name    = "bando-map-sync"
  role             = aws_iam_role.sync_lambda.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "handler.handler"
  filename         = data.archive_file.sync_handler.output_path
  source_code_hash = data.archive_file.sync_handler.output_base64sha256
  memory_size      = 256
  timeout          = 10
  tags             = { Component = "sync" }

  environment {
    variables = { TABLE_NAME = aws_dynamodb_table.sync.name }
  }

  depends_on = [aws_cloudwatch_log_group.sync_lambda]
}

# ----- Cognito (accounts) -----

resource "aws_cognito_user_pool" "users" {
  name                     = "bando-map"
  user_pool_tier           = "LITE"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  deletion_protection      = "ACTIVE"
  tags                     = { Component = "sync" }

  password_policy {
    minimum_length    = 10
    require_lowercase = true
    require_numbers   = false
    require_symbols   = false
    require_uppercase = false
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
}

resource "aws_cognito_user_pool_domain" "auth" {
  domain       = "bando-map"
  user_pool_id = aws_cognito_user_pool.users.id
}

resource "aws_cognito_user_pool_client" "spa" {
  name         = "bando-map-spa"
  user_pool_id = aws_cognito_user_pool.users.id

  # Public SPA client: authorization-code + PKCE, no secret.
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = ["https://bando.lagle.xyz/", "http://localhost:5173/"]
  logout_urls                          = ["https://bando.lagle.xyz/", "http://localhost:5173/"]

  # USER_PASSWORD_AUTH is for curl/CI smoke tests; the app itself uses the
  # hosted UI with PKCE.
  explicit_auth_flows = ["ALLOW_USER_SRP_AUTH", "ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]

  prevent_user_existence_errors = "ENABLED"
  access_token_validity         = 1
  id_token_validity             = 1
  refresh_token_validity        = 90

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }
}

# ----- HTTP API -----

resource "aws_apigatewayv2_api" "sync" {
  name          = "bando-map-sync"
  protocol_type = "HTTP"
  tags          = { Component = "sync" }

  cors_configuration {
    allow_origins = ["https://bando.lagle.xyz", "http://localhost:5173"]
    allow_methods = ["GET", "PUT", "OPTIONS"]
    allow_headers = ["authorization", "content-type"]
    max_age       = 3600
  }
}

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.sync.id
  name             = "cognito"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    issuer   = "https://cognito-idp.eu-north-1.amazonaws.com/${aws_cognito_user_pool.users.id}"
    audience = [aws_cognito_user_pool_client.spa.id]
  }
}

resource "aws_apigatewayv2_integration" "sync" {
  api_id                 = aws_apigatewayv2_api.sync.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.sync.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "sync_get" {
  api_id             = aws_apigatewayv2_api.sync.id
  route_key          = "GET /sync"
  target             = "integrations/${aws_apigatewayv2_integration.sync.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "sync_put" {
  api_id             = aws_apigatewayv2_api.sync.id
  route_key          = "PUT /sync"
  target             = "integrations/${aws_apigatewayv2_integration.sync.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.sync.id
  name        = "$default"
  auto_deploy = true
  tags        = { Component = "sync" }

  default_route_settings {
    # Backstop against abuse — far above anything 5 users generate.
    throttling_burst_limit = 20
    throttling_rate_limit  = 10
  }
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.sync.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.sync.execution_arn}/*/*"
}

# ----- Custom domain (api.bando.lagle.xyz) -----

resource "aws_acm_certificate" "api" {
  domain_name       = var.api_domain
  validation_method = "DNS"
  tags              = { Component = "sync" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "api_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.api.domain_validation_options : dvo.domain_name => {
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

resource "aws_acm_certificate_validation" "api" {
  certificate_arn         = aws_acm_certificate.api.arn
  validation_record_fqdns = [for r in aws_route53_record.api_cert_validation : r.fqdn]
}

resource "aws_apigatewayv2_domain_name" "api" {
  domain_name = var.api_domain
  tags        = { Component = "sync" }

  domain_name_configuration {
    certificate_arn = aws_acm_certificate_validation.api.certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "api" {
  api_id      = aws_apigatewayv2_api.sync.id
  domain_name = aws_apigatewayv2_domain_name.api.id
  stage       = aws_apigatewayv2_stage.default.id
}

resource "aws_route53_record" "api_a" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.api_domain
  type    = "A"
  alias {
    name                   = aws_apigatewayv2_domain_name.api.domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.api.domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}

# ----- Outputs -----

output "api_url" {
  value = "https://${var.api_domain}"
}

output "cognito_domain" {
  value = "https://${aws_cognito_user_pool_domain.auth.domain}.auth.eu-north-1.amazoncognito.com"
}

output "cognito_client_id" {
  value = aws_cognito_user_pool_client.spa.id
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.users.id
}
