import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://yhsmawyntabwghncqbqy.supabase.co";
const SUPABASE_KEY = "sb_publishable_4BqihYKIllE_bsiIIhKjPg_Pvobz7fR";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function fixUsers() {
  console.log("Logging in as Admin...");
  const { data: adminData, error: adminErr } = await supabase.auth.signInWithPassword({
    email: 'admin@example.com',
    password: 'Password123!'
  });

  if (adminErr) {
    console.error("Admin Login failed:", adminErr);
  } else {
    console.log("Admin logged in. Updating metadata...");
    const { error: updateErr } = await supabase.auth.updateUser({
      data: {
        first_name: 'Admin',
        middle_name: 'N/A',
        last_name: 'N/A',
        name_extension: '',
        account_status: 'Approved'
      }
    });
    if (updateErr) console.error("Admin update failed:", updateErr);
    else console.log("Admin updated successfully!");
    
    await supabase.auth.signOut();
  }

  console.log("Logging in as Teacher...");
  const { data: teacherData, error: teacherErr } = await supabase.auth.signInWithPassword({
    email: 'teacher@example.com',
    password: 'Password123!'
  });

  if (teacherErr) {
    console.error("Teacher Login failed:", teacherErr);
  } else {
    console.log("Teacher logged in. Updating metadata...");
    const { error: updateErr } = await supabase.auth.updateUser({
      data: {
        first_name: 'Teacher',
        middle_name: 'T.',
        last_name: 'Test',
        name_extension: '',
        lpt_info: '1234567',
        account_status: 'Approved'
      }
    });
    if (updateErr) console.error("Teacher update failed:", updateErr);
    else console.log("Teacher updated successfully!");
    
    await supabase.auth.signOut();
  }
}

fixUsers();
