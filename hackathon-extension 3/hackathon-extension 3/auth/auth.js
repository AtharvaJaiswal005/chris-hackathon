/* ── Pitho.ai Auth — OTP Flow ── */

const SUPABASE_URL = 'https://yijdhsjmqblcftcwlmbw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpamRoc2ptcWJsY2Z0Y3dsbWJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAxNDEwNjUsImV4cCI6MjA4NTcxNzA2NX0.Z_e3XzaVA1iT2ulilSPUa-9U91DaRAbtZeamNu-_XPk';

let pendingEmail = '';

// Supabase Auth API helper
async function supaAuth(endpoint, body) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/${endpoint}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.error_description || data.msg || data.error || 'Auth failed');
  }
  return data;
}

// ── OTP digit input handling ──
const otpDigits = document.querySelectorAll('.otp-digit');

otpDigits.forEach((input, idx) => {
  input.addEventListener('input', (e) => {
    const val = e.target.value.replace(/[^0-9]/g, '');
    e.target.value = val;
    if (val && idx < 5) {
      otpDigits[idx + 1].focus();
    }
    // Auto-submit when all 6 digits filled
    if (getOtpCode().length === 6) {
      document.getElementById('otpStep').dispatchEvent(new Event('submit'));
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !e.target.value && idx > 0) {
      otpDigits[idx - 1].focus();
    }
  });

  // Handle paste
  input.addEventListener('paste', (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData.getData('text') || '').replace(/[^0-9]/g, '').slice(0, 6);
    for (let i = 0; i < pasted.length && i < 6; i++) {
      otpDigits[i].value = pasted[i];
    }
    if (pasted.length > 0) {
      otpDigits[Math.min(pasted.length, 5)].focus();
    }
    if (pasted.length === 6) {
      document.getElementById('otpStep').dispatchEvent(new Event('submit'));
    }
  });
});

function getOtpCode() {
  return Array.from(otpDigits).map(d => d.value).join('');
}

function clearOtpInputs() {
  otpDigits.forEach(d => { d.value = ''; });
  otpDigits[0].focus();
}

// ── Step 1: Send OTP ──
document.getElementById('emailStep').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('sendOtpBtn');
  const errorEl = document.getElementById('emailError');
  errorEl.classList.remove('show');
  btn.disabled = true;
  btn.textContent = 'Sending code...';

  try {
    pendingEmail = document.getElementById('otpEmail').value.trim();

    await supaAuth('otp', {
      email: pendingEmail,
    });

    // Switch to OTP step
    document.getElementById('emailStep').style.display = 'none';
    document.getElementById('otpStep').style.display = 'flex';
    document.getElementById('otpEmailDisplay').textContent = pendingEmail;
    clearOtpInputs();

  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.add('show');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send Login Code';
  }
});

// ── Step 2: Verify OTP ──
document.getElementById('otpStep').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = getOtpCode();
  if (code.length !== 6) return;

  const btn = document.getElementById('verifyBtn');
  const errorEl = document.getElementById('otpError');
  errorEl.classList.remove('show');
  btn.disabled = true;
  btn.textContent = 'Verifying...';

  try {
    const data = await supaAuth('token?grant_type=email', {
      email: pendingEmail,
      token: code,
    });

    // Store session in chrome.storage
    const session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in * 1000),
      user: {
        id: data.user.id,
        email: data.user.email,
        name: data.user.user_metadata?.full_name || data.user.email.split('@')[0],
      },
    };

    await chrome.storage.local.set({ pitho_session: session });
    console.log('[Auth] Logged in as', session.user.email);

    btn.textContent = 'Success!';
    btn.style.background = '#22c55e';

    setTimeout(() => {
      window.close();
    }, 800);

  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.add('show');
    clearOtpInputs();
  } finally {
    btn.disabled = false;
    if (btn.textContent === 'Verifying...') btn.textContent = 'Verify & Sign In';
  }
});

// ── Resend code ──
document.getElementById('resendBtn').addEventListener('click', async () => {
  const btn = document.getElementById('resendBtn');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    await supaAuth('otp', { email: pendingEmail });
    btn.textContent = 'Code sent!';
    clearOtpInputs();
    setTimeout(() => { btn.textContent = 'Resend code'; btn.disabled = false; }, 3000);
  } catch (err) {
    document.getElementById('otpError').textContent = err.message;
    document.getElementById('otpError').classList.add('show');
    btn.textContent = 'Resend code';
    btn.disabled = false;
  }
});

// ── Change email ──
document.getElementById('changeEmailBtn').addEventListener('click', () => {
  document.getElementById('otpStep').style.display = 'none';
  document.getElementById('emailStep').style.display = 'flex';
  document.getElementById('otpError').classList.remove('show');
  document.getElementById('otpEmail').focus();
});

// ── Check if already logged in ──
(async () => {
  const result = await chrome.storage.local.get('pitho_session');
  if (result.pitho_session && result.pitho_session.expires_at > Date.now()) {
    document.querySelector('.auth-card').innerHTML = `
      <div class="auth-brand" style="margin-bottom:16px">
        <img src="../icons/pitho-logo.png" alt="Pitho.ai" class="auth-logo">
        <div class="auth-brand-text">
          <span class="brand-name">Pitho<span class="brand-dot">.ai</span></span>
          <span class="brand-sub">Sales Coach</span>
        </div>
      </div>
      <div style="text-align:center;padding:20px 0">
        <p style="font-size:14px;color:var(--text)">Signed in as <strong>${result.pitho_session.user.email}</strong></p>
        <p style="font-size:12px;color:var(--text-muted);margin-top:8px">${result.pitho_session.user.name}</p>
        <button class="auth-btn" style="margin-top:16px;background:var(--hot)" id="logoutBtn">Sign Out</button>
      </div>
      <div class="auth-footer">
        <span>Powered by Pitho.ai</span>
      </div>
    `;
    document.getElementById('logoutBtn').addEventListener('click', async () => {
      await chrome.storage.local.remove('pitho_session');
      window.location.reload();
    });
  }
})();
