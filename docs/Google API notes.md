gcloud services enable cloudkms.googleapis.com --project nowvibin

SA=nv-jwks-dev@nowvibin.iam.gserviceaccount.com
gcloud iam service-accounts create nv-jwks-dev --project nowvibin --display-name="NV JWKS Dev" || true

PROJECT=nowvibin
LOCATION=us
RING=nowvibin-us
KEY=nowvibin-sign-r

gcloud kms keys add-iam-policy-binding "$KEY" \
  --keyring="$RING" --location="$LOCATION" --project="$PROJECT" \
 --member="serviceAccount:${SA}" \
 --role="roles/cloudkms.publicKeyViewer"

# Option A: impersonate the SA for ADC (recommended for dev)

gcloud auth application-default login --impersonate-service-account="$SA"

# (If impersonation isn’t permitted in your org, fall back to:)

# gcloud auth application-default login

KMS_PROJECT_ID=nowvibin
KMS_LOCATION_ID=us
KMS_KEY_RING_ID=nowvibin-us
KMS_KEY_ID=nowvibin-sign-r
KMS_KEY_VERSION=1
KMS_JWT_ALG=RS256 # must match the key’s algorithm
NV_JWKS_CACHE_TTL_MS=60000

# GOOGLE_APPLICATION_CREDENTIALS is NOT required when using ADC

If you prefer JSON keys for dev (less safe):
gcloud iam service-accounts keys create sa.json --iam-account="$SA" --project="$PROJECT"
then export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/sa.json. Don’t commit it.

Sanity-check your KMS access with the same creds

gcloud kms keys versions get-public-key 1 \
 --key="$KEY" --keyring="$RING" --location="$LOCATION" --project="$PROJECT" \
 --impersonate-service-account="$SA" \
 --output-file=/tmp/k.pub

Restart jwks + gateway, then run:

./smoke.sh 18
JWKS_ENV_FILE=backend/services/jwks/.env.dev ./smoke.sh 19
JWKS_ENV_FILE=backend/services/jwks/.env.dev ./smoke.sh 20
