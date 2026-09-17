import pkg from 'pg';
const { Client } = pkg;

const regions = [
  'aws-0-ap-southeast-1',
  'aws-0-ap-southeast-2',
  'aws-0-ap-northeast-1',
  'aws-0-eu-central-1',
  'aws-0-eu-west-1',
  'aws-0-eu-west-2',
  'aws-0-us-east-1',
  'aws-0-us-west-1',
  'aws-0-us-west-2',
  'aws-0-ca-central-1',
  'aws-0-sa-east-1'
];

async function testPoolers() {
  for (const region of regions) {
    const host = `${region}.pooler.supabase.com`;
    console.log(`Testing ${host}...`);
    const client = new Client({
      connectionString: `postgresql://postgres.yhsmawyntabwghncqbqy:jsIPkr5sTNTXnBHg@${host}:6543/postgres`,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 3000
    });
    try {
      await client.connect();
      console.log(`SUCCESS: Connected to ${host}!`);
      await client.end();
      return;
    } catch (err) {
      // console.error(err.message);
    }
  }
  console.log("None of the poolers worked.");
}

testPoolers();
