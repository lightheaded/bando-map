# ---------- Error reporting and silence alarms ----------
#
# Two different questions, answered by two different things.
#
# Sentry answers "what broke": an unhandled throw inside a function, with a
# stack trace and the request id. backend/sentry.mjs sends it — about eighty
# lines and one POST, in place of Sentry's SDK layer. The layer was measured
# here first and cost 1.3 s of extra cold start and ~70 MB resident, which was
# more than this project is prepared to pay to be told what CloudWatch already
# holds. See README "Error reporting".
#
# CloudWatch answers "did it run at all", which Sentry cannot: a function that
# stops being invoked throws nothing. That is the real failure mode of the two
# scheduled functions. Stale airspace data looks exactly like fresh airspace
# data until a pilot reads the age, so the schedule going quiet has to raise
# something by itself.

variable "sentry_dsn" {
  description = <<-EOT
    Ingest key for the Sentry project that receives Lambda errors. Public by
    design — it can post an event and read nothing — so it is checked in.
    Empty disables reporting in every function.
  EOT
  type        = string
  default     = "https://22c6b9d29acf75fdd6eef5d60d311560@o4511915104665600.ingest.de.sentry.io/4511982703935568"
}

locals {
  # Same release name the browser reports, so one version names both halves.
  sentry_release = "bando-map@${jsondecode(file("${path.module}/../package.json")).version}"

  # Read by backend/sentry.mjs. An empty DSN makes it a no-op, which is how a
  # local run of a handler reports nothing.
  lambda_sentry_env = {
    SENTRY_DSN     = var.sentry_dsn
    SENTRY_RELEASE = local.sentry_release
  }
}

# ----- Alerts -----

resource "aws_sns_topic" "alerts" {
  name = "bando-map-alerts"
  tags = { Component = "ops" }
}

# No address is written down here. alert_email already gates the cost budget in
# main.tf; setting it once turns on both. Without it the alarms still change
# state and still show in the console — they just reach nobody.
resource "aws_sns_topic_subscription" "alerts_email" {
  count     = var.alert_email == null ? 0 : 1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ----- "Did it run" alarms -----
#
# Invocations is a count, so a period with no runs reports no data at all
# rather than zero. treat_missing_data = "breaching" is what turns that silence
# into an alarm, and it is the entire point of these two resources.

resource "aws_cloudwatch_metric_alarm" "zones_silent" {
  alarm_name          = "bando-map-zones-not-running"
  alarm_description   = "The airspace fetcher has not run for two hours. Zone data on the map is going stale."
  namespace           = "AWS/Lambda"
  metric_name         = "Invocations"
  dimensions          = { FunctionName = aws_lambda_function.zones.function_name }
  statistic           = "Sum"
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  period              = 7200
  evaluation_periods  = 1
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = { Component = "zones" }
}

resource "aws_cloudwatch_metric_alarm" "stats_rollup_silent" {
  alarm_name          = "bando-map-stats-rollup-not-running"
  alarm_description   = "The visit-stats rollup has not run for twelve hours. Visit figures are going stale."
  namespace           = "AWS/Lambda"
  metric_name         = "Invocations"
  dimensions          = { FunctionName = aws_lambda_function.stats_rollup.function_name }
  statistic           = "Sum"
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  period              = 43200
  evaluation_periods  = 1
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = { Component = "stats" }
}
