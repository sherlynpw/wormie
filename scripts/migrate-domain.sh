#!/usr/bin/env bash
# One-time move of the WormIE deployment from the old Cloudflare account
# (wormie.rs.ht) to the new one (wormie.bio).
#
# Asks for two Cloudflare API tokens without echoing them, checks them, copies
# every object in the old wormie-data R2 bucket to the new account and stores
# the CI secrets in GitHub. It deploys nothing: merging the wormie.bio
# wrangler.toml to trunk does that, and the redirect workflow follows it.
#
# Needs: curl, jq, aws, gh (logged in with access to set repo secrets), shasum.
#
# Usage: bash scripts/migrate-domain.sh

set -euo pipefail

BUCKET=wormie-data
NEW_ZONE=wormie.bio
OLD_ZONE=rs.ht
API=https://api.cloudflare.com/client/v4

die() {
  echo "error: $*" >&2
  exit 1
}

for tool in curl jq aws gh shasum; do
  command -v "$tool" >/dev/null || die "$tool not found"
done
gh auth status >/dev/null 2>&1 || die "gh is not logged in (run: gh auth login)"

cf() {
  local token=$1 path=$2
  shift 2
  curl -sS -H "Authorization: Bearer $token" -H 'Content-Type: application/json' "$@" "$API$path"
}

# Prints the token id. R2 derives S3 keys from it: id = access key, sha256(value) = secret.
token_id() {
  local res
  res=$(cf "$1" /user/tokens/verify)
  [ "$(jq -r '.result.status // empty' <<<"$res")" = active ] ||
    die "$2 token is not valid: $(jq -c '.errors' <<<"$res")"
  jq -r '.result.id' <<<"$res"
}

account_id() {
  local res n
  res=$(cf "$1" '/accounts?per_page=50')
  n=$(jq '.result | length' <<<"$res")
  [ "$n" -ge 1 ] || die "$2 token sees no account (add Account Settings: Read)"
  if [ "$n" -eq 1 ]; then
    jq -r '.result[0].id' <<<"$res"
    return
  fi
  jq -r '.result[] | "  \(.id)  \(.name)"' <<<"$res" >&2
  local id
  read -r -p "$2 account id from the list above: " id
  echo "$id"
}

check_zone() {
  local res
  res=$(cf "$1" "/zones?name=$2")
  [ "$(jq '.result | length' <<<"$res")" -ge 1 ] ||
    die "$3 token cannot see zone $2 (add Zone: Zone Read for $2)"
  echo "  zone $2: $(jq -r '.result[0].status' <<<"$res")"
}

read -r -s -p 'NEW account token (wormie.bio): ' NEW_TOKEN
echo
read -r -s -p 'OLD account token (wormie.rs.ht): ' OLD_TOKEN
echo

echo '==> checking tokens'
NEW_TOKEN_ID=$(token_id "$NEW_TOKEN" NEW)
OLD_TOKEN_ID=$(token_id "$OLD_TOKEN" OLD)
NEW_ACCOUNT=$(account_id "$NEW_TOKEN" NEW)
OLD_ACCOUNT=$(account_id "$OLD_TOKEN" OLD)
[ "$NEW_ACCOUNT" != "$OLD_ACCOUNT" ] || die 'both tokens point at the same account'
check_zone "$NEW_TOKEN" "$NEW_ZONE" NEW
check_zone "$OLD_TOKEN" "$OLD_ZONE" OLD

NEW_S3_ID=$NEW_TOKEN_ID
NEW_S3_SECRET=$(printf %s "$NEW_TOKEN" | shasum -a 256 | cut -d' ' -f1)
OLD_S3_ID=$OLD_TOKEN_ID
OLD_S3_SECRET=$(printf %s "$OLD_TOKEN" | shasum -a 256 | cut -d' ' -f1)

export AWS_DEFAULT_REGION=auto
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required

old_s3() {
  AWS_ACCESS_KEY_ID=$OLD_S3_ID AWS_SECRET_ACCESS_KEY=$OLD_S3_SECRET \
    aws --endpoint-url "https://$OLD_ACCOUNT.r2.cloudflarestorage.com" "$@"
}
new_s3() {
  AWS_ACCESS_KEY_ID=$NEW_S3_ID AWS_SECRET_ACCESS_KEY=$NEW_S3_SECRET \
    aws --endpoint-url "https://$NEW_ACCOUNT.r2.cloudflarestorage.com" "$@"
}

echo "==> creating R2 bucket $BUCKET in the new account"
res=$(cf "$NEW_TOKEN" "/accounts/$NEW_ACCOUNT/r2/buckets" -X POST -d "{\"name\":\"$BUCKET\"}")
if [ "$(jq -r '.success' <<<"$res")" = true ]; then
  echo '  created'
elif jq -e '.errors[] | select(.code == 10004)' <<<"$res" >/dev/null; then
  echo '  already exists'
else
  die "bucket create failed: $(jq -c '.errors' <<<"$res")"
fi

# The WebR runtime and DESeq2 bundle in R2 take about two hours to rebuild in
# CI; copying them is minutes. Content types are kept, since the worker serves
# them from R2 metadata and a wrong type breaks WASM streaming compile.
echo "==> copying $BUCKET from the old account to the new one"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
old_s3 s3api list-objects-v2 --bucket "$BUCKET" --query 'Contents[].Key' --output json >"$TMP/keys.json"
total=$(jq 'length' "$TMP/keys.json")
echo "  $total objects"
i=0
jq -r '.[]' "$TMP/keys.json" | while IFS= read -r key; do
  i=$((i + 1))
  printf '  [%d/%d] %s\n' "$i" "$total" "$key"
  old_s3 s3api get-object --bucket "$BUCKET" --key "$key" "$TMP/obj" >"$TMP/meta.json"
  ctype=$(jq -r '.ContentType // "application/octet-stream"' "$TMP/meta.json")
  new_s3 s3api put-object --bucket "$BUCKET" --key "$key" --body "$TMP/obj" \
    --content-type "$ctype" >/dev/null
done
copied=$(new_s3 s3api list-objects-v2 --bucket "$BUCKET" --query 'length(Contents[])' --output text)
[ "$copied" -ge "$total" ] || die "new bucket has $copied objects, expected $total"
echo "  new bucket has $copied objects"

echo
echo 'Next: replace the GitHub secrets CF_API_TOKEN, CF_ACCOUNT_ID, R2_S3_ACCESS_KEY_ID'
echo 'and R2_S3_SECRET_ACCESS_KEY with the new account, and add OLD_CF_API_TOKEN and'
echo 'OLD_CF_ACCOUNT_ID for the redirect. The old values cannot be read back.'
read -r -p 'Type yes to update the GitHub secrets: ' answer
[ "$answer" = yes ] || die 'stopped before the GitHub secrets; nothing else was changed'

set_secret() {
  printf %s "$2" | gh secret set "$1" ||
    die "could not set $1 (the repo owner may need to run this step)"
  echo "  set $1"
}
set_secret CF_API_TOKEN "$NEW_TOKEN"
set_secret CF_ACCOUNT_ID "$NEW_ACCOUNT"
set_secret R2_S3_ACCESS_KEY_ID "$NEW_S3_ID"
set_secret R2_S3_SECRET_ACCESS_KEY "$NEW_S3_SECRET"
set_secret OLD_CF_API_TOKEN "$OLD_TOKEN"
set_secret OLD_CF_ACCOUNT_ID "$OLD_ACCOUNT"

echo
echo 'Done. Merge the wormie.bio change to trunk: the deploy goes to the new account,'
echo 'then "Redirect wormie.rs.ht" checks wormie.bio and redirects the old domain.'
