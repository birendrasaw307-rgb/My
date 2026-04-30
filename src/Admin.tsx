import React, { useState, useEffect } from 'react';

export default function Admin() {
  const [pass, setPass] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [devices, setDevices] = useState<any[]>([]);

  // Bulk Sender States
  const [pendingNumbers, setPendingNumbers] = useState<{id: string, num: string}[]>([]);
  const [messageBody, setMessageBody] = useState('');
  const [selectedDevice, setSelectedDevice] = useState('');
  const [sendQuantity, setSendQuantity] = useState(1);
  const [isSending, setIsSending] = useState(false);

  const fetchFirebaseData = async () => {
    try {
      const [numRes, msgRes] = await Promise.all([
        fetch('https://abhi-sms-na-default-rtdb.firebaseio.com/WhatsAppnumber.json'),
        fetch('https://abhi-sms-na-default-rtdb.firebaseio.com/message.json')
      ]);
      const numbersData = await numRes.json();
      const msgData = await msgRes.json();

      if (numbersData) {
        const loaded: {id: string, num: string}[] = [];
        for (const key in numbersData) {
          if (numbersData[key]) {
            loaded.push({ id: key, num: String(numbersData[key]) });
          }
        }
        setPendingNumbers(loaded);
      } else {
        setPendingNumbers([]);
      }

      if (msgData) {
        if (typeof msgData === 'object') {
            const firstMsgKey = Object.keys(msgData)[0];
            if (firstMsgKey && msgData[firstMsgKey]) {
                setMessageBody(String(msgData[firstMsgKey]));
            } else {
                setMessageBody(JSON.stringify(msgData));
            }
        } else {
            setMessageBody(String(msgData));
        }
      }
    } catch (e) {
      console.error('Error fetching from firebase', e);
    }
  };

  useEffect(() => {
    if (loggedIn) {
      fetchFirebaseData();
    }
  }, [loggedIn]);

  const handleSendNext = async () => {
    if (pendingNumbers.length === 0) {
      alert('No pending numbers to send.');
      return;
    }
    if (!messageBody.trim()) {
      alert('Please enter a message/link to send.');
      return;
    }
    if (!selectedDevice) {
      alert('Please select a device to send from.');
      return;
    }

    const itemsToSend = pendingNumbers.slice(0, sendQuantity);
    const targetNumbers = itemsToSend.map(x => x.num);
    
    setIsSending(true);
    try {
      const res = await fetch('/api/admin/send-bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Pass': pass
        },
        body: JSON.stringify({
          phone: selectedDevice,
          numbers: targetNumbers,
          message: messageBody
        })
      });

      const data = await res.json();
      
      if (!res.ok) {
        alert(data.error || 'Failed to send messages');
      } else {
        alert(`Successfully sent ${data.sent} messages.`);
        
        // Remove from WhatsAppnumber and add to WhatsAppnumberused in RTDB
        for (const item of itemsToSend) {
          try {
            await fetch(`https://abhi-sms-na-default-rtdb.firebaseio.com/WhatsAppnumber/${item.id}.json`, { method: 'DELETE' });
            await fetch(`https://abhi-sms-na-default-rtdb.firebaseio.com/WhatsAppnumberused.json`, { 
              method: 'POST', 
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(item.num) 
            });
          } catch(e) { console.error('Error syncing individual number', e); }
        }

        setPendingNumbers(prev => prev.slice(itemsToSend.length));
        fetchDevices(); // Refresh devices state to get updated totalSent
      }
    } catch (err) {
      alert('An error occurred while sending');
    } finally {
      setIsSending(false);
    }
  };

  const login = (e: React.FormEvent) => {
    e.preventDefault();
    if (pass === '825410') {
      setLoggedIn(true);
    } else {
      alert('Invalid Password');
    }
  };

  const fetchDevices = async () => {
    try {
      const res = await fetch('/api/admin/devices', {
        headers: { 'X-Admin-Pass': pass }
      });
      if (res.ok) {
        const data = await res.json();
        setDevices(data);
      } else {
        if (res.status === 401) setLoggedIn(false);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (loggedIn) {
      fetchDevices();
      const int = setInterval(fetchDevices, 5000);
      return () => clearInterval(int);
    }
  }, [loggedIn]);

  if (!loggedIn) {
    return (
      <div className="min-h-[100vh] bg-slate-900 flex justify-center items-center text-white p-4">
        <form onSubmit={login} className="bg-slate-800 p-8 rounded-xl border border-slate-700 shadow-2xl w-full max-w-sm">
          <h2 className="text-2xl font-bold mb-6 text-center text-slate-100">Admin Login</h2>
          <input 
            type="password" 
            value={pass} 
            onChange={e => setPass(e.target.value)} 
            placeholder="Enter password..."
            className="w-full bg-slate-900 border border-slate-700 p-3 rounded-lg mb-4 text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
          />
          <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 p-3 rounded-lg font-semibold transition-colors">
            Login
          </button>
        </form>
      </div>
    );
  }

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4 relative z-50">
      <div className="max-w-4xl mx-auto w-full">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-100">⚙️ Admin Panel</h1>
          <button onClick={() => setLoggedIn(false)} className="bg-red-500 hover:bg-red-600 px-4 py-2 rounded-lg font-semibold transition">
            Logout
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-slate-800 rounded-xl p-3 sm:p-5 border border-slate-700 text-center">
            <h3 className="text-slate-400 text-xs sm:text-sm font-medium mb-1">Total</h3>
            <p className="text-xl sm:text-3xl font-bold">{devices.length}</p>
          </div>
          <div className="bg-slate-800 rounded-xl p-3 sm:p-5 border border-slate-700 text-center">
            <h3 className="text-slate-400 text-xs sm:text-sm font-medium mb-1">Online</h3>
            <p className="text-xl sm:text-3xl font-bold text-emerald-400">{devices.filter(d => d.status === 'online').length}</p>
          </div>
          <div className="bg-slate-800 rounded-xl p-3 sm:p-5 border border-slate-700 text-center truncate">
            <h3 className="text-slate-400 text-xs sm:text-sm font-medium mb-1">Payout</h3>
            <p className="text-xl sm:text-3xl font-bold text-blue-400">₹{devices.reduce((acc, d) => acc + (d.earnings || 0), 0).toFixed(0)}</p>
          </div>
        </div>

        {/* Bulk Sender */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 sm:p-6 mb-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <span className="text-2xl">💬</span> Sender
            </h2>
            <button 
              onClick={fetchFirebaseData}
              disabled={isSending}
              className="bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1 disabled:opacity-50 border border-slate-600"
            >
              🔄 Refresh
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 mb-4">
            <div className="flex flex-col">
              <label className="block text-slate-400 text-xs font-medium mb-1.5 flex justify-between">
                <span>Pending Numbers</span>
                <span className="text-blue-400 font-bold">{pendingNumbers.length}</span>
              </label>
              <div className="w-full h-24 bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-400 overflow-y-auto font-mono shadow-inner custom-scrollbar">
                {pendingNumbers.map((num, i) => (
                  <div key={num.id} className={i < sendQuantity ? "text-blue-400 bg-blue-400/10 p-1 rounded mb-1 flex items-center gap-1 border border-blue-500/20" : "p-1 mb-1 text-slate-500"}>
                     {i < sendQuantity && <span>👉</span>} {num.num}
                  </div>
                ))}
                {pendingNumbers.length === 0 && <div className="h-full flex items-center justify-center text-slate-600 italic">Empty</div>}
              </div>
            </div>

            <div className="flex flex-col">
              <label className="block text-slate-400 text-xs font-medium mb-1.5">Message Content</label>
              <textarea
                value={messageBody}
                onChange={(e) => setMessageBody(e.target.value)}
                placeholder="Message loaded from Firebase..."
                className="w-full h-24 bg-slate-900 border border-slate-700 rounded-lg p-3 text-xs text-slate-300 focus:outline-none focus:border-blue-500 resize-none shadow-inner"
              ></textarea>
            </div>
          </div>

          <div className="bg-slate-900/40 p-3 sm:p-4 rounded-xl border border-slate-700/50 flex flex-col gap-3">
            <div>
              <label className="block text-slate-400 text-xs font-medium mb-1.5">Select Device</label>
              <select
                value={selectedDevice}
                onChange={(e) => setSelectedDevice(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-300 focus:outline-none focus:border-blue-500 shadow-sm"
              >
                <option value="">-- Choose --</option>
                {[...devices].sort((a, b) => (b.status === 'online' ? 1 : 0) - (a.status === 'online' ? 1 : 0)).map(d => (
                   <option key={d.phone} value={d.phone} disabled={d.status !== 'online'}>
                     +{d.phone} {d.status === 'online' ? `(Online - ${d.totalSent || 0} sent)` : '(Offline)'}
                   </option>
                ))}
              </select>
            </div>

            <div className="flex gap-3 items-end">
              <div className="w-1/3">
                <label className="block text-slate-400 text-xs font-medium mb-1.5">Quantity</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={sendQuantity}
                  onChange={(e) => setSendQuantity(Number(e.target.value) || 1)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-300 focus:outline-none focus:border-blue-500 shadow-sm font-mono text-center"
                />
              </div>
                
              <div className="w-2/3">
                <button
                  onClick={handleSendNext}
                  disabled={pendingNumbers.length === 0 || !messageBody.trim() || !selectedDevice || isSending}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:border disabled:border-slate-700 disabled:text-slate-500 rounded-lg font-bold text-white shadow-lg shadow-blue-500/20 transition-all flex items-center justify-center gap-2 transform active:scale-95 text-sm"
                >
                  <span>{isSending ? 'Sending...' : `Send (${Math.min(pendingNumbers.length, sendQuantity)})`}</span>
                  {!isSending && <span>🚀</span>}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Devices List */}
        <div className="mb-12">
          <h2 className="text-xl font-bold text-slate-100 mb-6 flex items-center gap-2">
            <span>📱</span> Connected Devices
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...devices]
               .sort((a, b) => {
                 // Format: Online devices first
                 if (a.status === 'online' && b.status !== 'online') return -1;
                 if (a.status !== 'online' && b.status === 'online') return 1;
                 // Then lowest total sent at the top
                 return (a.totalSent || 0) - (b.totalSent || 0);
               })
               .map(d => (
              <div key={d.phone} className="bg-slate-800 rounded-xl p-6 border border-slate-700 hover:border-slate-500/50 transition-all flex flex-col relative overflow-hidden group">
                <div className="absolute top-0 left-0 w-full h-1" style={{ backgroundColor: d.status === 'online' ? '#10b981' : '#ef4444' }} />
                
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h3 className="font-mono text-xl font-bold text-slate-100">+{d.phone}</h3>
                    <p className="text-sm text-slate-500 mt-1">User: <span className="text-blue-400">{d.userMob || 'N/A'}</span></p>
                  </div>
                  <span className={`inline-flex items-center px-3 py-1 rounded-full text-[10px] uppercase tracking-wider font-bold ${d.status === 'online' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'}`}>
                    {d.status === 'online' ? '🟢 ONLINE' : '🔴 OFFLINE'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-700/50 flex flex-col justify-center items-center">
                    <p className="text-[10px] text-slate-400 mb-1 uppercase tracking-widest font-semibold flex items-center gap-1">Sent</p>
                    <p className="text-2xl font-black text-slate-200">{d.totalSent || 0}</p>
                  </div>
                  <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-700/50 flex flex-col justify-center items-center">
                    <p className="text-[10px] text-slate-400 mb-1 uppercase tracking-widest font-semibold flex items-center gap-1">Earned</p>
                    <p className="text-2xl font-black text-emerald-400">₹{(d.earnings || 0).toFixed(2)}</p>
                  </div>
                </div>

                <div className="mt-auto">
                   <button onClick={async () => {
                        if(window.confirm('Disconnect this device?')) {
                          await fetch(`/api/disconnect?phone=${d.phone}`);
                          fetchDevices();
                        }
                      }} className="w-full bg-slate-700/40 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/40 text-slate-400 px-4 py-3 rounded-xl text-sm font-semibold transition-all border border-slate-600/50 group-hover:border-slate-500/50">
                        Disconnect Device
                   </button>
                </div>
              </div>
            ))}
            {devices.length === 0 && (
              <div className="col-span-full py-16 text-center bg-slate-800/50 rounded-xl border-2 border-dashed border-slate-700">
                <div className="text-4xl mb-4">📱</div>
                <h3 className="text-slate-300 font-bold text-lg mb-1">No Active Devices</h3>
                <p className="text-slate-500">Wait for users to pair their WhatsApp devices.</p>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
