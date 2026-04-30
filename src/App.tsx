import { useState, useEffect, useRef } from 'react';

export default function App() {
  const [userMob, setUserMob] = useState('');
  const [phone, setPhone] = useState('');
  const [statusMsg, setStatusMsg] = useState({ text: '', type: '' });
  const [pairingCode, setPairingCode] = useState('');
  const [timeLeft, setTimeLeft] = useState(0);
  const [view, setView] = useState('loading'); // loading, unauthorized, main, success
  const [userDevices, setUserDevices] = useState<any[]>([]);
  
  const pollRef = useRef<any>(null);
  const checkLinkRef = useRef<any>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const uMob = params.get('userMob') || params.get('mobile') || localStorage.getItem('wallet_user_id');
    
    if (uMob) {
      localStorage.setItem('wallet_user_id', uMob);
      setUserMob(uMob);
      setView('main');
      startDashboardPoll(uMob);
    } else {
      setView('unauthorized');
    }

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (checkLinkRef.current) clearInterval(checkLinkRef.current);
    };
  }, []);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  const startDashboardPoll = (uMob: string) => {
    const poll = async () => {
      try {
        const res = await fetch(`/api/user-devices?userMob=${uMob}`);
        if(res.ok) {
           const data = await res.json();
           setUserDevices(data);
        }
      } catch (e) {}
    };
    poll();
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(poll, 5000);
  };

  const checkLinkStatus = async (p: string) => {
    try {
      const res = await fetch(`/api/is-linked?phone=${p}`);
      const data = await res.json();
      if (data.linked) {
        if (checkLinkRef.current) clearInterval(checkLinkRef.current);
        setTimeLeft(0);
        setPhone('');
        setPairingCode('');
        setStatusMsg({ text: '', type: '' });
        setView('success');
        setTimeout(() => {
          setView('main');
          startDashboardPoll(userMob);
        }, 2500);
      }
    } catch (e) {}
  };

  const generatePairingCode = async () => {
    const trimmedPhone = phone.trim();
    if (trimmedPhone.length !== 10) {
      setStatusMsg({ text: 'Please enter exactly 10 digits', type: 'error' });
      return;
    }
    const fullPhone = "91" + trimmedPhone;
    setStatusMsg({ text: '', type: '' });
    setPairingCode('');
    setTimeLeft(-1); // loading state

    try {
      const res = await fetch(`/api/pair?phone=${encodeURIComponent(fullPhone)}&userMob=${encodeURIComponent(userMob)}`);
      const data = await res.json();
      
      if (res.ok) {
        if (data.code === "Already Connected") {
          setStatusMsg({ text: 'Already Connected!', type: 'success' });
          setTimeLeft(0);
          startDashboardPoll(userMob);
        } else {
          setPairingCode(data.code);
          setStatusMsg({ text: 'Code generated!', type: 'success' });
          setTimeLeft(45);
          
          if (checkLinkRef.current) clearInterval(checkLinkRef.current);
          checkLinkRef.current = setInterval(() => checkLinkStatus(fullPhone), 1000);
        }
      } else {
        setStatusMsg({ text: 'Failed: ' + (data.error || 'Unknown error'), type: 'error' });
        setTimeLeft(0);
      }
    } catch (e) {
      setStatusMsg({ text: 'Network error. Try again.', type: 'error' });
      setTimeLeft(0);
    }
  };

  useEffect(() => {
    if (timeLeft > 0) {
      const timer = setInterval(() => setTimeLeft(l => l - 1), 1000);
      return () => clearInterval(timer);
    } else if (timeLeft === 0 && pairingCode) {
      if (checkLinkRef.current) clearInterval(checkLinkRef.current);
      // Auto-discard pairing on backend when time expires
      fetch(`/api/discard_pairing?phone=91${phone.trim()}`).then(() => {
         startDashboardPoll(userMob);
      }).catch(() => {});
      
      setStatusMsg({ text: 'Code expired. Please generate a new one.', type: 'error' });
      setPairingCode('');
    }
  }, [timeLeft, pairingCode, phone, userMob]);

  const disconnectDevice = async (devicePhone: string) => {
    if (window.confirm("Are you sure you want to stop this connection?")) {
      await fetch(`/api/disconnect?phone=${devicePhone}`);
      startDashboardPoll(userMob);
    }
  };

  const renderCodeDisplay = () => {
    if (!pairingCode) return null;
    const clean = pairingCode.replace(/[^a-zA-Z0-9]/g, '');
    const formatted = clean.match(/.{1,4}/g)?.join('-') || clean;
    
    return (
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', background: '#ecfdf5', padding: '16px 20px', borderRadius: '12px', marginTop: '16px', border: '1px solid #10b981', overflow: 'hidden' }}>
        <span style={{ fontSize: '20px', fontWeight: '800', letterSpacing: '3px', fontFamily: 'monospace', color: '#064e3b', whiteSpace: 'nowrap' }}>
          {formatted}
        </span>
        <button 
          onClick={() => {
             navigator.clipboard.writeText(clean);
             setStatusMsg({ text: 'Code copied to clipboard!', type: 'success' });
          }}
          style={{ background: '#d1fae5', color: '#047857', border: '1px solid #34d399', padding: '10px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '15px', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '700', flexShrink: 0, whiteSpace: 'nowrap' }}
          title="Copy Code"
        >
          📋 Copy
        </button>
      </div>
    );
  };

  if (view === 'unauthorized') {
    return (
        <div style={{minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', padding: '24px'}}>
            <div style={{background: '#1e293b', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '32px', borderRadius: '16px', textAlign: 'center', maxWidth: '380px'}}>
                <div style={{fontSize: '48px', marginBottom: '16px'}}>🚫</div>
                <h2 style={{fontSize: '20px', fontWeight: 'bold', color: 'white', marginBottom: '8px'}}>Access Denied</h2>
                <p style={{color: '#94a3b8', fontSize: '14px'}}>Please open this page from within the official app.</p>
            </div>
        </div>
    );
  }

  if (view === 'loading') {
    return <div style={{ minHeight: '100vh', background: '#0f172a' }}></div>;
  }

  if (view === 'success') {
    return (
      <div style={{minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a'}}>
        <div className="card" style={{ maxWidth: '420px', padding: '40px 20px', textAlign: 'center' }}>
            <div className="success-icon" style={{fontSize: '80px', marginBottom: '16px'}}>✔️</div>
            <div className="success-title" style={{color: '#059669', fontSize: '24px', fontWeight: 'bold'}}>Connected Successfully!</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="background-animation"></div>
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px', width: '100%' }}>
        <div style={{ width: '100%', maxWidth: '420px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* TOP BOX: ADD WHATSAPP */}
        <div className="card" style={{ padding: '24px' }}>
            <div className="header" style={{ marginBottom: '8px', textAlign: 'center' }}>🔗 Connect WhatsApp</div>
            <div className="subheader" style={{ textAlign: 'center', marginBottom: '20px' }}>Link your WhatsApp number to start earning</div>
            
            <div className="input-group">
                <span className="flag">🇮🇳</span>
                <span className="country-code">+91</span>
                <div className="divider"></div>
                <input 
                  type="tel" 
                  value={phone} 
                  onChange={e => setPhone(e.target.value.replace(/\D/g, ''))} 
                  placeholder="Enter your WhatsApp number" 
                  maxLength={10} 
                  disabled={timeLeft > 0}
                />
            </div>

            {statusMsg.text && (
                <div className={`status-msg ${statusMsg.type}`} style={{
                    marginTop: '12px', 
                    fontSize: '14px', 
                    textAlign: 'center', 
                    padding: '12px', 
                    borderRadius: '8px',
                    background: statusMsg.type === 'error' ? '#fee2e2' : '#dcfce7',
                    color: statusMsg.type === 'error' ? '#dc2626' : '#15803d',
                    border: `1px solid ${statusMsg.type === 'error' ? '#fca5a5' : '#86efac'}`,
                    fontWeight: '500'
                }}>
                    {statusMsg.text}
                </div>
            )}

            {renderCodeDisplay()}

            {pairingCode && (
                <div style={{
                    background: '#f0fdf4', 
                    padding: '16px', 
                    borderRadius: '12px', 
                    marginTop: '16px',
                    border: '1px solid #bbf7d0',
                    color: '#166534',
                    fontSize: '14px',
                    lineHeight: '1.5'
                }}>
                    <strong style={{ display: 'block', marginBottom: '8px', fontSize: '15px' }}>📌 How to link:</strong>
                    <ol style={{ margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <li>Check your phone for a <strong>WhatsApp notification</strong>.</li>
                        <li>Tap the notification and enter the code shown above.</li>
                        <li>If the notification didn't arrive, open WhatsApp &gt; <strong>Linked Devices</strong>. Tap <strong>Link a device</strong>, then choose <strong>Link with phone number instead</strong> and enter the code.</li>
                    </ol>
                    <p style={{ margin: '10px 0 0 0', fontSize: '13px', color: '#475569' }}>
                        <em>⚠️ Do NOT enter this code in the input box above. Enter it inside your WhatsApp app.</em>
                    </p>
                </div>
            )}

            <button 
              className={`action-btn ${timeLeft > 0 ? 'loading' : ''}`}
              onClick={generatePairingCode}
              disabled={timeLeft > 0 || timeLeft === -1 || phone.length !== 10}
              style={{ marginTop: '16px' }}
            >
              {timeLeft === -1 ? '🔄 Generating Code...' : timeLeft > 0 ? `⏱️ Code expires in ${timeLeft}s` : '🚀 Generate Code'}
            </button>
        </div>

        {/* BOTTOM BOX: CONNECTED DEVICES */}
        <div className="card" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '2px solid #ecfdf5', paddingBottom: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '18px', color: '#064e3b', fontWeight: 'bold' }}>📱 Linked Devices</h3>
                <span style={{ fontSize: '13px', color: '#065f46', fontWeight: '600', background: '#d1fae5', padding: '4px 10px', borderRadius: '20px' }}>
                    User: {userMob}
                </span>
            </div>

            {userDevices.length === 0 ? (
                <div style={{textAlign: 'center', padding: '24px 16px', background: '#f0fdf4', border: '1px dashed #bbf7d0', borderRadius: '12px'}}>
                    <div style={{fontSize: '28px', marginBottom: '8px'}}>📴</div>
                    <p style={{color: '#166534', fontSize: '14px', margin: 0}}>No active WhatsApp connections.<br/>Enter a number above to get started.</p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {userDevices.map(device => (
                      <div key={device.phone} style={{ border: '1px solid #10b981', borderRadius: '12px', padding: '16px', background: device.status === 'online' ? '#ecfdf5' : '#f0fdf4' }}>
                          
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                              <strong style={{ fontSize: '17px', color: '#064e3b', fontFamily: 'monospace' }}>+{device.phone}</strong> 
                              <span className={`status-badge ${device.status === 'online' ? 'online' : 'offline'}`} style={{ margin: 0 }}>
                                {device.status?.toUpperCase() || 'OFFLINE'}
                              </span>
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '14px' }}>
                              <div>
                                  <span style={{color: '#047857', display: 'block', marginBottom: '2px', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px'}}>⏱️ Uptime</span> 
                                  <span style={{fontFamily: 'monospace', fontWeight: 600, color: '#022c22', fontSize: '15px'}}>{formatTime(device.totalOnlineSeconds || 0)}</span>
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                  <span style={{color: '#047857', display: 'block', marginBottom: '2px', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px'}}>💰 Earnings</span> 
                                  <span style={{color: '#10b981', fontWeight: 'bold', fontSize: '16px'}}>₹{(device.earnings || 0).toFixed(2)}</span>
                              </div>
                          </div>

                          {device.status === 'offline' && (
                              <button 
                                  onClick={() => disconnectDevice(device.phone)}
                                  style={{
                                      width: '100%', marginTop: '16px', 
                                      background: '#fee2e2', 
                                      color: '#dc2626', 
                                      border: '1px solid #fca5a5', 
                                      padding: '8px', borderRadius: '8px', 
                                      cursor: 'pointer', fontSize: '14px', fontWeight: 'bold', transition: 'all 0.2s'
                                  }}
                              >
                                  🗑️ Delete
                              </button>
                          )}
                      </div>
                  ))}
                </div>
            )}
        </div>
      </div>
     </div>
    </>
  );
}
