#!/usr/bin/env bash
# Publish the scraped dataset and thumbnails to the site bucket.
#
# The scraper's output (public/data/bandos.json, public/thumbs/) is
# deliberately not in git — S3 is its only home, and `npm run scrape`
# reproduces it. Run this after a scrape, with AWS credentials that can
# write to the bucket (AWS_PROFILE or ambient).
set -euo pipefail
cd "$(dirname "$0")/.."

BUCKET="${BUCKET:-bando.lagle.xyz}"

[ -f public/data/bandos.json ] || {
  echo "public/data/bandos.json missing — run 'npm run scrape' first" >&2
  exit 1
}

# Thumbs are content-stable (<recordId>-<photoId>.webp, never rewritten), so
# they cache forever. No --delete: a partial local set must not wipe the bucket.
aws s3 sync public/thumbs "s3://$BUCKET/thumbs" \
  --cache-control "public,max-age=31536000,immutable"

# Both of these are owned by Lambdas — community.json by the sync Lambda
# (written on submission approval), zones.json by the zones fetcher — so a
# stale local copy must never overwrite them.
aws s3 sync public/data "s3://$BUCKET/data" \
  --exclude "community.json" \
  --exclude "zones.json" \
  --cache-control "public,max-age=300,must-revalidate"

DISTRIBUTION_ID="${DISTRIBUTION_ID:-$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?contains(Aliases.Items, '$BUCKET')].Id | [0]" \
  --output text)}"
aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" \
  --paths "/data/*" >/dev/null

echo "Published data + thumbs to s3://$BUCKET and invalidated /data/*"
