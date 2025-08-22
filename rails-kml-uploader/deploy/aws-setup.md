# AWS Deployment Setup for Rails KML Uploader

## Infrastructure Overview

- **EC2**: Application hosting
- **RDS PostgreSQL with PostGIS**: Database with geospatial support
- **S3**: KML file storage
- **ElastiCache Redis**: Caching and job queue
- **ALB**: Load balancer with SSL termination
- **Route 53**: DNS management

## Setup Steps

### 1. RDS PostgreSQL with PostGIS

```bash
# Create RDS instance
aws rds create-db-instance \
  --db-instance-identifier kml-uploader-prod \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 15.4 \
  --master-username rails_user \
  --master-user-password [SECURE_PASSWORD] \
  --allocated-storage 20 \
  --storage-type gp2 \
  --vpc-security-group-ids sg-xxxxxxxxx \
  --db-subnet-group-name default \
  --backup-retention-period 7 \
  --multi-az \
  --storage-encrypted

# Connect and enable PostGIS
psql -h kml-uploader-prod.xxxxxx.us-east-1.rds.amazonaws.com -U rails_user -d postgres
CREATE EXTENSION postgis;
```

### 2. ElastiCache Redis

```bash
# Create Redis cluster
aws elasticache create-cache-cluster \
  --cache-cluster-id kml-uploader-redis \
  --cache-node-type cache.t3.micro \
  --engine redis \
  --num-cache-nodes 1 \
  --security-group-ids sg-xxxxxxxxx
```

### 3. S3 Bucket

```bash
# Create S3 bucket for KML files
aws s3 mb s3://kml-uploader-files-prod

# Set bucket policy for application access
aws s3api put-bucket-policy \
  --bucket kml-uploader-files-prod \
  --policy file://s3-bucket-policy.json
```

### 4. EC2 Instance

```bash
# Launch EC2 instance
aws ec2 run-instances \
  --image-id ami-0abcdef1234567890 \
  --count 1 \
  --instance-type t3.small \
  --key-name your-key-pair \
  --security-group-ids sg-xxxxxxxxx \
  --subnet-id subnet-xxxxxxxxx \
  --iam-instance-profile Name=KMLUploaderRole \
  --user-data file://user-data.sh
```

### 5. Application Deployment

```bash
# Install Docker
sudo yum update -y
sudo yum install -y docker
sudo service docker start
sudo usermod -a -G docker ec2-user

# Clone and deploy
git clone https://github.com/your-repo/rails-kml-uploader.git
cd rails-kml-uploader

# Set environment variables
export DATABASE_URL="postgresql://rails_user:password@kml-uploader-prod.xxxxxx.us-east-1.rds.amazonaws.com:5432/kml_uploader_production"
export REDIS_URL="redis://kml-uploader-redis.xxxxxx.cache.amazonaws.com:6379"
export AWS_REGION="us-east-1"
export S3_BUCKET="kml-uploader-files-prod"

# Build and run
docker build -t kml-uploader .
docker run -d -p 3000:3000 \
  -e DATABASE_URL \
  -e REDIS_URL \
  -e AWS_REGION \
  -e S3_BUCKET \
  kml-uploader

# Run database migrations
docker exec container_id bundle exec rails db:migrate
```

## Environment Variables

```bash
# Production environment variables
DATABASE_URL=postgresql://rails_user:password@rds-endpoint:5432/kml_uploader_production
REDIS_URL=redis://elasticache-endpoint:6379
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET=kml-uploader-files-prod
RAILS_ENV=production
RAILS_MASTER_KEY=...
```

## Security Groups

### Web Tier Security Group
- **Inbound**: HTTP (80), HTTPS (443) from ALB
- **Outbound**: All traffic

### Database Security Group
- **Inbound**: PostgreSQL (5432) from Web Tier SG
- **Outbound**: None

### Redis Security Group
- **Inbound**: Redis (6379) from Web Tier SG
- **Outbound**: None

## IAM Roles

### EC2 Instance Role (KMLUploaderRole)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::kml-uploader-files-prod/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket"
      ],
      "Resource": "arn:aws:s3:::kml-uploader-files-prod"
    }
  ]
}
```

## Monitoring

### CloudWatch Alarms
- Database CPU utilization
- Application server CPU/Memory
- Redis memory usage
- S3 storage costs

### Application Monitoring
- Rails logs via CloudWatch Logs
- Sidekiq job monitoring
- Error tracking with Rails error reporting

## Backup Strategy

### Database Backups
- RDS automated backups (7-day retention)
- Manual snapshots before deployments

### Application Backups
- S3 file versioning enabled
- Code deployments via Git tags

## Scaling

### Horizontal Scaling
- Auto Scaling Group for EC2 instances
- Application Load Balancer
- Database read replicas (if needed)

### Vertical Scaling
- Monitor and upgrade instance types
- Database parameter tuning