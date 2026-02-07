# Hetzner Object Storage Setup

## Step 1: Create Object Storage in Hetzner Cloud Console

1. Go to https://console.hetzner.cloud/
2. Select your project (or create one)
3. Go to **Object Storage** in the left menu
4. Click **Create Object Storage**
5. Choose location: **Falkenstein (fsn1)** - same DC as your server
6. Name: `epstein-documents`
7. Click **Create**

## Step 2: Create S3 Credentials

1. In Object Storage, click on your bucket
2. Go to **S3 Credentials** tab
3. Click **Generate Credentials**
4. Save the Access Key and Secret Key

## Step 3: Add Credentials to Server

SSH to your server and add to `.env`:

```bash
ssh root@88.99.61.233

cat >> /opt/app/.env << 'EOF'
# Hetzner Object Storage (S3-compatible)
HETZNER_S3_ENDPOINT=https://fsn1.your-objectstorage.com
HETZNER_S3_ACCESS_KEY=your_access_key_here
HETZNER_S3_SECRET_KEY=your_secret_key_here
HETZNER_S3_BUCKET=epstein-documents
HETZNER_S3_REGION=fsn1
EOF
```

## Step 4: Test Connection

```bash
# Install boto3 if needed
pip3 install boto3

# Test upload
python3 << 'EOF'
import boto3
from botocore.config import Config
import os

client = boto3.client(
    's3',
    endpoint_url=os.environ['HETZNER_S3_ENDPOINT'],
    aws_access_key_id=os.environ['HETZNER_S3_ACCESS_KEY'],
    aws_secret_access_key=os.environ['HETZNER_S3_SECRET_KEY'],
    region_name='fsn1',
    config=Config(signature_version='s3v4')
)

# List buckets
response = client.list_buckets()
print("Buckets:", [b['Name'] for b in response['Buckets']])
EOF
```

## Step 5: Upload Dataset 10 PDFs

```bash
cd /opt/app
source .env

python3 scripts/upload_to_hetzner.py \
    /opt/app/data/epstein-files/datasets-2026/DataSet_10_extracted \
    dataset_10
```

## Cost Estimate

- Storage: €0.0065/GB/month = ~€0.54/month for 83GB
- Egress (within Hetzner): €0.01/GB = ~€0.83 for 83GB
- **Total for Dataset 10: ~€1.40**

For all datasets (~500GB estimate):
- Storage: ~€3.25/month
- Egress: ~€5 one-time for processing
- **Total: ~€8-10**
