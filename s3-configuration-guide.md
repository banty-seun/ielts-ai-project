# S3 CORS 403 Fix Implementation Guide

## PHASE 2: S3 Configuration (AWS Console)

### Bucket: `ielts-ai-audio` (Region: eu-west-2)

1. **Block Public Access Settings**
   - Go to: Permissions → Block public access (bucket settings)
   - **Turn OFF**: "Block all public access"
   - Save changes

2. **Object Ownership**
   - Go to: Permissions → Object Ownership
   - Keep: "Bucket owner enforced (ACLs disabled)" 
   - This means object ACLs like "public-read" are ignored

3. **Bucket Policy** (Apply this JSON)
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "AllowPublicRead",
         "Effect": "Allow",
         "Principal": "*",
         "Action": "s3:GetObject",
         "Resource": "arn:aws:s3:::ielts-ai-audio/*"
       }
     ]
   }
   ```

4. **CORS Configuration** (Apply this JSON)
   ```json
   [
     {
       "AllowedHeaders": ["*"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedOrigins": ["*"],
       "ExposeHeaders": ["Content-Length", "Content-Range", "Accept-Ranges", "Content-Type"],
       "MaxAgeSeconds": 3000
     }
   ]
   ```

## Verification Steps

After applying S3 configuration:
1. Wait 1-2 minutes for propagation
2. Test server access: `curl -I "https://ielts-ai-audio.s3.eu-west-2.amazonaws.com/audio/..."`
3. Should return: `HTTP/1.1 200 OK` with proper headers

## Expected Results
- ✅ Server curl returns 200 OK (not 403 Forbidden)
- ✅ Browser console shows no CORS errors
- ✅ Audio plays without NotSupportedError