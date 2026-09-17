import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://yhsmawyntabwghncqbqy.supabase.co";
const SUPABASE_KEY = "sb_publishable_4BqihYKIllE_bsiIIhKjPg_Pvobz7fR";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testQuery() {
  const { data: adminData } = await supabase.auth.signInWithPassword({
    email: 'admin@example.com',
    password: 'Password123!'
  });

  const { data, error } = await supabase
    .from("user_roles")
    .select("user_id, role, users:user_id(email, raw_user_meta_data)");

  console.log("Error:", error);
  console.log("Data:", JSON.stringify(data, null, 2));

  await supabase.auth.signOut();
}

testQuery();
