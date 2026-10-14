import "./bootstrap";
import { PutBucketCorsCommand, S3Client } from "@aws-sdk/client-s3";
import env from "@server/env";

// CON2: one-time bucket setup for Garage, which allows no cross-origin
// requests until a CORS rule is stored. Browsers upload with presigned POST
// forms (or PUT when AWS_S3_UPLOAD_METHOD=put) from the site's origin.
// Reads the same AWS_* settings as the server, so it runs unchanged inside
// the pod. Extra origins (a dev server) go as arguments:
//
//   node build/server/scripts/con2-s3-cors.js [https://other.origin ...]

async function main() {
  const bucket = env.AWS_S3_UPLOAD_BUCKET_NAME;
  if (!bucket || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    throw new Error(
      "AWS_S3_UPLOAD_BUCKET_NAME, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set"
    );
  }

  const origins = [env.URL, ...process.argv.slice(2)];
  const rules = [
    {
      AllowedOrigins: origins,
      AllowedMethods: ["POST", "PUT", "GET", "HEAD"],
      AllowedHeaders: ["*"],
      ExposeHeaders: ["ETag"],
      MaxAgeSeconds: 3600,
    },
  ];

  const client = new S3Client({
    region: env.AWS_REGION,
    endpoint: env.AWS_S3_UPLOAD_BUCKET_URL,
    forcePathStyle: env.AWS_S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });

  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: { CORSRules: rules },
    })
  );

  console.log(
    `CORS rules applied to bucket ${bucket} at ${env.AWS_S3_UPLOAD_BUCKET_URL}:`
  );
  console.log(JSON.stringify(rules, null, 2));
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
