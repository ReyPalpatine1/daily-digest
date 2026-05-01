const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://rqoztfncbgxofxeyguxm.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxb3p0Zm5jYmd4b2Z4ZXlndXhtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU4MTIxNiwiZXhwIjoyMDkyMTU3MjE2fQ.GBXhH9gfOn-gS9eUyySH4FtLB1PAE7K2spnLrmBv_q0'
);

(async () => {
  const { data, error } = await supabase
    .from('profiles')
    .select('id,email')
    .eq('email', 'khsol0118@gmail.com')
    .single();

  if (error) {
    console.error('SUPABASE_ERROR', error.message);
    process.exit(1);
  }

  console.log('USER_ID=' + data.id);

  console.log('Sending request to http://localhost:3000/api/digest');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000); // 3분 타임아웃
  
  try {
    const res = await fetch('http://localhost:3000/api/digest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: data.id }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    console.log('Response status:', res.status);
    console.log('Response headers:', Object.fromEntries(res.headers.entries()));
    
    const text = await res.text();
    console.log('Response text length:', text.length);
    console.log('Response text:', text.slice(0, 500)); // 처음 500자만 출력
  } catch (fetchError) {
    clearTimeout(timeoutId);
    console.error('Fetch error:', fetchError.message);
  }
})();

