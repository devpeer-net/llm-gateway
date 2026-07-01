#!/bin/bash
#
# Generic Elastic Beanstalk deploy template.
#
# All AWS specifics come from environment variables — there are NO hard-coded
# account ids, buckets, app/env names or profiles. Set the required variables
# (see below) before running, e.g. via your shell, CI secrets or a .env file.
#
# Required:
#   DEPLOY_AWS_ACCOUNT_ID   Expected AWS account id (guards against wrong creds)
#   DEPLOY_EB_APP           Elastic Beanstalk application name
#   DEPLOY_EB_ENV           Elastic Beanstalk environment id (e-xxxxxxxxxx)
# Optional:
#   AWS_REGION              AWS region (default: us-east-1)
#   DEPLOY_AWS_PROFILE      AWS CLI profile to use
#   DEPLOY_S3_BUCKET        S3 bucket for bundles (default: elasticbeanstalk-<region>-<account>)
#
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"

require() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "ERROR: required environment variable '$name' is not set." >&2
    exit 1
  fi
}

require DEPLOY_AWS_ACCOUNT_ID
require DEPLOY_EB_APP
require DEPLOY_EB_ENV

S3_BUCKET="${DEPLOY_S3_BUCKET:-elasticbeanstalk-${REGION}-${DEPLOY_AWS_ACCOUNT_ID}}"

AWS="aws --region $REGION"
if [ -n "${DEPLOY_AWS_PROFILE:-}" ]; then
  AWS="$AWS --profile $DEPLOY_AWS_PROFILE"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# Verify we are pointed at the expected AWS account.
CALLER_ACCOUNT="$($AWS sts get-caller-identity --query Account --output text)"
if [ "$CALLER_ACCOUNT" != "$DEPLOY_AWS_ACCOUNT_ID" ]; then
  echo "ERROR: expected account $DEPLOY_AWS_ACCOUNT_ID but got $CALLER_ACCOUNT" >&2
  exit 1
fi
echo "AWS account verified: $CALLER_ACCOUNT"

# Bump patch version.
CURRENT_VERSION="$(node -p "require('./package.json').version")"
npm version patch --no-git-tag-version
NEW_VERSION="$(node -p "require('./package.json').version")"
echo "Version: $CURRENT_VERSION -> $NEW_VERSION"

# Build, test and zip.
npm run clean
npm run build
npm run test
npm run zip

# Upload bundle to S3.
S3_KEY="${DEPLOY_EB_APP}/deployment_package_v${NEW_VERSION}.zip"
$AWS s3 cp deployment_package.zip "s3://${S3_BUCKET}/${S3_KEY}"

VERSION_LABEL="v${NEW_VERSION}-$(date +%Y%m%d%H%M%S)"

# Register new application version.
$AWS elasticbeanstalk create-application-version \
  --application-name "$DEPLOY_EB_APP" \
  --version-label "$VERSION_LABEL" \
  --source-bundle "S3Bucket=${S3_BUCKET},S3Key=${S3_KEY}"

# Deploy to environment.
$AWS elasticbeanstalk update-environment \
  --environment-id "$DEPLOY_EB_ENV" \
  --version-label "$VERSION_LABEL"

echo "Deployed $VERSION_LABEL to $DEPLOY_EB_ENV ($DEPLOY_EB_APP)"
