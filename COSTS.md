# AWS Infrastructure Cost Breakdown

This document provides a realistic cost analysis for deploying the vendor-agnostic SaaS platform on AWS infrastructure.

---

## Assumptions

- **Traffic**: 10,000 monthly active users (MAU)
- **Storage**: 100GB file storage, 50GB data transfer/month
- **Email**: 50,000 emails/month
- **Lambda Invocations**: 5M requests/month (main app), 50K email jobs/month
- **Region**: us-east-1 (N. Virginia)
- **Uptime**: 24/7 production deployment

---

## Monthly Cost Breakdown

### 1. Compute (Lambda)

| Service | Configuration | Monthly Cost | Calculation |
|---------|---------------|--------------|-------------|
| **Lambda - Main App** | 5M requests, 1024MB, 500ms avg | **$19.80** | Requests: 5M × $0.20/1M = $1.00<br/>Duration: 2.5M GB-seconds × $0.0000166667 = $41.67<br/>Free tier: -$22.87 = **$19.80** |
| **Lambda - Email Worker** | 50K requests, 512MB, 2s avg | **$1.67** | Requests: 50K × $0.20/1M = $0.01<br/>Duration: 50K GB-seconds × $0.0000166667 = $0.83<br/>Free tier covers most |
| **Lambda - Image Optimization** | 500K requests, 1536MB, 1s avg | **$8.40** | Requests: $0.10, Duration: $8.30 |
| **Lambda - WebSocket** | 500K connections, 512MB, 200ms | **$1.04** | Requests: $0.10, Duration: $0.94 |

**Compute Total**: **$30.91/month**

> **Free Tier** (first 12 months): 1M requests + 400K GB-seconds free → Saves ~$5/month

---

### 2. Database & Storage

| Service | Configuration | Monthly Cost | Calculation |
|---------|---------------|--------------|-------------|
| **RDS PostgreSQL** | db.t3.medium (2vCPU, 4GB RAM) | **$54.02** | $0.068/hour × 730 hours |
| **RDS Storage** | 20GB gp3 SSD | **$2.30** | 20GB × $0.115/GB |
| **RDS Backup** | 20GB automated backups | **$2.00** | 20GB × $0.10/GB (beyond free 20GB) |
| **S3 Storage** | 100GB Standard class | **$2.30** | 100GB × $0.023/GB |
| **S3 Requests** | 1M GET, 100K PUT | **$0.44** | GET: 1M × $0.0004/1K = $0.40<br/>PUT: 100K × $0.005/1K = $0.50 |

**Database & Storage Total**: **$61.06/month**

> **Cost Optimization**: Use Aurora Serverless v2 instead → **~$44/month** (saves $17)

---

### 3. Networking & CDN

| Service | Configuration | Monthly Cost | Calculation |
|---------|---------------|--------------|-------------|
| **CloudFront** | 500GB data transfer | **$42.50** | First 10TB: $0.085/GB × 500GB |
| **CloudFront Requests** | 10M HTTPS requests | **$10.00** | 10M × $1.00/1M requests |
| **API Gateway HTTP** | 5M requests | **$5.00** | 5M × $1.00/1M requests (first 300M/year) |
| **API Gateway WebSocket** | 500K messages | **$1.13** | Messages: 500K × $1.00/1M = $0.50<br/>Connection mins: 250K × $0.25/1M = $0.63 |
| **Data Transfer (EC2/Lambda)** | 50GB outbound | **$4.50** | 50GB × $0.09/GB (beyond free 100GB) |

**Network & CDN Total**: **$63.13/month**

> **Note**: CloudFront costs scale with traffic. Enable compression to reduce by 30-40%

---

### 4. Messaging & Queues

| Service | Configuration | Monthly Cost | Calculation |
|---------|---------------|--------------|-------------|
| **SQS - Email Queue** | 5M messages | **$2.00** | 5M × $0.40/1M requests |
| **SQS - DLQ** | 10K failed messages | **$0.004** | 10K × $0.40/1M requests |
| **DynamoDB** | 1M writes, 5M reads (WebSocket) | **$1.56** | Writes: 1M × $1.25/1M = $1.25<br/>Reads: 5M × $0.25/1M = $0.31 |

**Messaging Total**: **$3.56/month**

---

### 5. Email & Authentication

| Service | Configuration | Monthly Cost | Calculation |
|---------|---------------|--------------|-------------|
| **AWS SES** | 50,000 emails | **$5.00** | First 1,000: Free<br/>Remaining 49K × $0.10/1K = $4.90<br/>Data transfer: $0.10 |
| **Cognito** | 10,000 MAU | **$27.50** | First 50K MAU: $0.0055/MAU<br/>10K × $0.0055 = $55/month<br/>**Alternative**: Supabase auth = $0 |

**Email & Auth Total**: **$32.50/month**

> **Cost Optimization**: Use Supabase Auth instead of Cognito → **Saves $27.50/month**

---

### 6. Monitoring & Logs

| Service | Configuration | Monthly Cost | Calculation |
|---------|---------------|--------------|-------------|
| **CloudWatch Logs** | 5GB ingested, 5GB stored | **$2.63** | Ingestion: 5GB × $0.50/GB = $2.50<br/>Storage: 5GB × $0.03/GB = $0.15 |
| **CloudWatch Metrics** | 50 custom metrics | **$1.50** | 50 × $0.30/metric |
| **CloudWatch Alarms** | 10 alarms | **$1.00** | 10 × $0.10/alarm |

**Monitoring Total**: **$5.13/month**

---

## Total Monthly Costs

| Configuration | Monthly Cost | Annual Cost |
|---------------|--------------|-------------|
| **Full AWS Stack** | **$196.29** | **$2,355.48** |
| **Optimized AWS** (Aurora Serverless, Supabase Auth) | **$141.29** | **$1,695.48** |
| **Hybrid Stack** (see below) | **$66.00** | **$792.00** |

---

## Cost Comparison: AWS vs Alternatives

### Option 1: Full AWS (Current)

**Monthly**: $196.29
**Annual**: $2,355.48

✅ **Pros**:
- Complete control over infrastructure
- Enterprise-grade reliability
- HIPAA/SOC2 compliant
- No vendor lock-in for compute

❌ **Cons**:
- Highest cost option
- Complex setup and maintenance
- Requires AWS expertise

---

### Option 2: Optimized AWS

**Monthly**: $141.29 (28% savings)
**Annual**: $1,695.48

**Changes from Full AWS**:
- Use Aurora Serverless v2 instead of RDS → Save $17/month
- Use Supabase Auth instead of Cognito → Save $27.50/month
- Enable CloudFront compression → Save ~$10/month

✅ **Pros**:
- Significant cost savings
- Still AWS-native
- Maintains most benefits of Full AWS

❌ **Cons**:
- Supabase dependency for auth
- Slightly more complex setup

---

### Option 3: Hybrid Stack (Best Value)

**Monthly**: $66.00 (66% savings vs Full AWS)
**Annual**: $792.00

**Stack**:
- **Database**: Supabase ($25/month - Pro plan)
- **Storage**: AWS S3 ($4/month)
- **Auth**: Supabase (included)
- **Email**: SendGrid ($15/month for 40K emails)
- **Queue**: AWS SQS ($2/month)
- **Hosting**: Vercel ($20/month)

✅ **Pros**:
- Lowest cost
- Fastest to deploy
- Minimal maintenance
- Great for MVPs and small teams

❌ **Cons**:
- Vendor lock-in for database/auth
- Less control over infrastructure
- Supabase free tier limits (500MB DB)

---

### Option 4: Pure Supabase + Vercel

**Monthly**: $45.00 (77% savings vs Full AWS)
**Annual**: $540.00

**Stack**:
- **Database, Auth, Storage, Realtime**: Supabase ($25/month - Pro)
- **Email**: Resend ($20/month for 50K emails)
- **Hosting**: Vercel (free tier or $20/month Pro)

✅ **Pros**:
- Simplest setup
- Fastest time to market
- Minimal configuration
- Built-in admin UI

❌ **Cons**:
- Highest vendor lock-in
- Limited customization
- Scaling limitations

---

## Cost Optimization Strategies

### Immediate Savings (30-40% reduction)

1. **Use Aurora Serverless v2** instead of RDS
   - Scales automatically with load
   - Minimum: 0.5 ACU = ~$44/month vs $54
   - Savings: **$10-17/month**

2. **Enable CloudFront Compression**
   - Reduces bandwidth by 40-60%
   - Savings: **$15-20/month**

3. **Implement S3 Intelligent-Tiering**
   - Auto-moves infrequent data to cheaper storage
   - Savings: **$0.50-1/month** (more with larger storage)

4. **Use Supabase Auth** instead of Cognito
   - Free for unlimited users
   - Savings: **$27.50/month**

5. **Lambda Provisioned Concurrency** (only if needed)
   - Reduces cold starts
   - Cost: +$13/month per provisioned instance
   - Use only for latency-critical functions

### Long-term Optimization (50-60% reduction)

1. **Reserved Instances for RDS**
   - 1-year: Save 30%
   - 3-year: Save 60%
   - Savings: **$16-32/month**

2. **CloudFront Reserved Capacity**
   - 12-month commitment
   - Savings: **10-20%** on data transfer

3. **S3 Glacier for Backups**
   - Archive old data
   - Savings: **70-90%** on archived storage

4. **Lambda@Edge for Caching**
   - Reduce origin requests
   - Savings: Variable, depends on cache hit rate

---

## Cost Breakdown by Traffic

| MAU | Lambda | Database | CloudFront | Total/month |
|-----|--------|----------|------------|-------------|
| **1,000** | $5 | $56 | $8 | **$90** |
| **10,000** | $31 | $56 | $53 | **$196** |
| **50,000** | $85 | $140 | $180 | **$510** |
| **100,000** | $150 | $280 | $350 | **$950** |

> Costs scale primarily with CloudFront (bandwidth) and RDS (database size/performance)

---

## Hidden Costs to Consider

### Development & Testing
- **Staging Environment**: ~$50-100/month (smaller instance sizes)
- **Development Environment**: ~$20-40/month

### Operations
- **AWS Support**:
  - Developer: $29/month
  - Business: $100/month or 10% of usage (whichever is higher)
- **Backups beyond retention**: $0.10/GB/month
- **Data transfer to internet**: $0.09/GB after first 100GB free

### Domain & SSL
- **Route53**: $0.50/hosted zone/month + $0.40/1M queries
- **ACM Certificate**: Free (AWS-managed)
- **Domain registration**: $12-50/year (depends on TLD)

---

## Cost Monitoring & Alerts

### Recommended CloudWatch Alarms

1. **Monthly Cost > $250**: Alert if spending exceeds budget
2. **CloudFront Bandwidth > 1TB**: Unusual traffic spike
3. **Lambda Errors > 1%**: Potential infinite loops
4. **RDS Storage > 80%**: Need to scale database

### Tools

- **AWS Cost Explorer**: Track spending trends
- **AWS Budgets**: Set spending limits and alerts
- **CloudWatch Cost Anomaly Detection**: ML-based anomaly alerts

---

## Pricing Sources & Last Updated

- [AWS Lambda Pricing](https://aws.amazon.com/lambda/pricing/) - January 2025
- [AWS RDS Pricing](https://aws.amazon.com/rds/postgresql/pricing/) - January 2025
- [AWS S3 Pricing](https://aws.amazon.com/s3/pricing/) - January 2025
- [AWS CloudFront Pricing](https://aws.amazon.com/cloudfront/pricing/) - January 2025
- [AWS SES Pricing](https://aws.amazon.com/ses/pricing/) - January 2025
- [AWS Cognito Pricing](https://aws.amazon.com/cognito/pricing/) - January 2025

**Note**: AWS pricing varies by region. Prices shown are for **us-east-1** (N. Virginia), which typically has the lowest costs.

---

## Conclusion

**For most teams**: Start with **Hybrid Stack** ($66/month) and migrate to AWS as you scale.

**For enterprise**: Use **Optimized AWS** ($141/month) with reserved instances for production workloads.

**For MVPs**: Use **Pure Supabase + Vercel** ($45/month) to validate product-market fit.
