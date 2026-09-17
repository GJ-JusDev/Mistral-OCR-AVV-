import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://yhsmawyntabwghncqbqy.supabase.co";
const SUPABASE_KEY = "sb_publishable_4BqihYKIllE_bsiIIhKjPg_Pvobz7fR";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function fixUsers() {
  console.log("Fixing Admin user...");
  const { data: adminData, error: adminErr } = await supabase.auth.signInWithPassword({
    email: 'admin@example.com',
    password: 'Password123!'
  });

  if (adminErr) {
    console.error("Admin login failed:", adminErr.message);
  } else {
    const { error: updateErr } = await supabase.auth.updateUser({
      data: {
        first_name: 'Admin',
        middle_name: 'N/A',
        last_name: 'N/A',
        name_extension: '',
        role: 'Admin',
        account_status: 'Approved'
      }
    });
    if (updateErr) {
      console.error("Admin update failed:", updateErr.message);
    } else {
      console.log("Admin updated successfully.");
    }
    
    // Also try to update user_roles just in case
    const { error: roleErr } = await supabase.from('user_roles').update({ role: 'admin' }).eq('user_id', adminData.user.id);
    if (roleErr) {
      console.error("Admin user_roles update failed (might be RLS):", roleErr.message);
    }
    await supabase.auth.signOut();
  }

  console.log("Fixing Teacher user...");
  const { data: teacherData, error: teacherErr } = await supabase.auth.signInWithPassword({
    email: 'teacher@example.com',
    password: 'Password123!'
  });

  if (teacherErr) {
    console.error("Teacher login failed:", teacherErr.message);
  } else {
    const { error: updateErr } = await supabase.auth.updateUser({
      data: {
        first_name: 'Teacher',
        middle_name: 'A',
        last_name: 'One',
        name_extension: '',
        role: 'Teacher',
        lpt_info: 'LPT-12345',
        account_status: 'Approved'
      }
    });
    if (updateErr) {
      console.error("Teacher update failed:", updateErr.message);
    } else {
      console.log("Teacher updated successfully.");
    }
    await supabase.auth.signOut();
  }
}

fixUsers();
