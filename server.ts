import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import pino from 'pino';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc, serverTimestamp, updateDoc, collection, query, where, getDocs, deleteDoc, setLogLevel } from 'firebase/firestore';
import fs from 'fs';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

let firebaseConfig: any = {};
try {
  if (fs.existsSync('./firebase-applet-config.json')) {
    const rawData = fs.readFileSync('./firebase-applet-config.json', 'utf8');
    firebaseConfig = JSON.parse(rawData);
  }
} catch (e) {}

const fbConfig = {
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || firebaseConfig.projectId,
  appId: process.env.VITE_FIREBASE_APP_ID || firebaseConfig.appId,
  apiKey: process.env.VITE_FIREBASE_API_KEY || firebaseConfig.apiKey,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || firebaseConfig.authDomain,
  firestoreDatabaseId: process.env.VITE_FIREBASE_DATABASE_ID || firebaseConfig.firestoreDatabaseId,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || firebaseConfig.storageBucket,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || firebaseConfig.messagingSenderId,
};

setLogLevel('silent');

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

const firebaseApp = initializeApp(fbConfig);
const db = getFirestore(firebaseApp, fbConfig.firestoreDatabaseId);


app.use(express.json());
app.use(cors());

interface DeviceState {
  phone: string;
  sock: any;
  status: string;
  connectedAt: number;
  totalOnlineSeconds: number;
  earnings: number;
  userMob?: string;
  totalSent: number;
}

const FIREBASE_RTDB_URL = process.env.FIREBASE_RTDB_URL || "https://abhi-sms-na-default-rtdb.firebaseio.com";

const devices = new Map<string, DeviceState>();

async function updateRTDBDevice(userMob: string | undefined, phone: string, state: DeviceState) {
  if (!userMob) return;
  try {
    await fetch(`${FIREBASE_RTDB_URL}/users/${userMob}/connected_devices/${phone}.json`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
         status: state.status,
         connected_at: state.connectedAt,
         total_online_seconds: state.totalOnlineSeconds,
         earnings: state.earnings,
         last_seen: Math.floor(Date.now() / 1000)
      })
    });
  } catch(e) {}
}

async function updateFirebase(phone: string, data: any) {
  try {
    const dRef = doc(db, 'devices', phone);
    await setDoc(dRef, data, { merge: true });

    const state = devices.get(phone);
    if (state?.userMob) {
      await updateRTDBDevice(state.userMob, phone, state);
    }
  } catch (err) {
    console.error('Firebase DB Error:', err);
  }
}

async function getFirebase(phone: string) {
  try {
    const docSnap = await getDoc(doc(db, 'devices', phone));
    if (docSnap.exists()) {
      return docSnap.data();
    }
  } catch (err) {
    console.error('Firebase Get Error:', err);
  }
  return null;
}

// Restore earnings
async function restoreState(phone: string, state: DeviceState) {
  const fbData = await getFirebase(phone);
  if (fbData) {
    if (fbData.total_online_seconds) state.totalOnlineSeconds = fbData.total_online_seconds;
    if (fbData.earnings) state.earnings = fbData.earnings;
    if (fbData.userMob) state.userMob = fbData.userMob;
  }
}

async function startWhatsAppSession(phone: string, isPairRequest = false, userMob?: string) {
  const fbData = await getFirebase(phone);
  
  if (fbData && fbData.userMob && userMob && fbData.userMob !== userMob) {
      throw new Error('Already used by another user');
  }

  let state = devices.get(phone);
  
  if (state) {
    if (state.userMob && userMob && state.userMob !== userMob) {
      // It's in memory bound to someone else, but NOT saved permanently to them in Firebase.
      // This means it's an abandoned pairing session. We can discard it.
      try { fs.rmSync(path.join('/tmp', `baileys-${phone}`), { recursive: true, force: true }); } catch(e) {}
      if (state.sock) {
          try { state.sock.logout(); } catch(e) {}
      }
      devices.delete(phone);
      state = undefined;
    } else {
      if (state.status === 'online') {
        return 'Already Connected';
      }
      if (userMob) state.userMob = userMob;
    }
  } 
  
  if (!state) {
    state = {
      phone,
      sock: null,
      status: 'offline',
      connectedAt: 0,
      totalOnlineSeconds: 0,
      earnings: 0,
      totalSent: 0
    };
    await restoreState(phone, state);
    
    if (state.userMob && userMob && state.userMob !== userMob) {
       // Should be caught by fbData check above, but just in case
       throw new Error('Already used by another user');
    }
    
    if (userMob) state.userMob = userMob;
    devices.set(phone, state);
  }

  if (userMob && (state.status === 'online' || state.totalOnlineSeconds > 0 || state.sock?.authState?.creds?.me)) {
    updateFirebase(phone, { userMob });
  }

  const { version, isLatest } = await fetchLatestBaileysVersion();
  const authFolder = path.join('/tmp', `baileys-${phone}`);
  if (!fs.existsSync(authFolder)) {
    fs.mkdirSync(authFolder, { recursive: true });
  }
  const { state: authState, saveCreds } = await useMultiFileAuthState(authFolder);

  const sock = makeWASocket({
    version,
    auth: authState,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: Browsers.ubuntu('Chrome'), // essential for pairing code
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
    getMessage: async () => { return { conversation: 'hello' } }
  });

  state.sock = sock;

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
      state!.status = 'offline';
      
      const hasCreds = !!state!.sock?.authState?.creds?.me;
      const isActuallyConnectedBefore = state!.totalOnlineSeconds > 0 || hasCreds;

      if (!isActuallyConnectedBefore || state!.status === 'deleted') {
          // Never successfully connected OR explicitly deleted. Delete everything and don't take up database space.
          console.log(`Discarding or deleting session for ${phone}`);
          try { fs.rmSync(path.join('/tmp', `baileys-${phone}`), { recursive: true, force: true }); } catch (e) {}
          devices.delete(phone);
          deleteDoc(doc(db, 'devices', phone)).catch(()=>{});
          return; // stop here
      }

      await updateFirebase(phone, { status: 'offline', last_seen: Math.floor(Date.now() / 1000) });
      
      if (shouldReconnect) {
        startWhatsAppSession(phone); // auto reconnect
      } else {
        try { fs.rmSync(path.join('/tmp', `baileys-${phone}`), { recursive: true, force: true }); } catch (e) {}
        state!.sock = null;
      }
    } else if (connection === 'open') {
      state!.status = 'online';
      state!.connectedAt = Math.floor(Date.now() / 1000);
      await updateFirebase(phone, {
        status: 'online',
        connected_at: state!.connectedAt,
        last_seen: Math.floor(Date.now() / 1000),
        userMob: state!.userMob
      });
    }
  });

  sock.ev.on('creds.update', async () => {
    try {
      if (fs.existsSync(authFolder)) {
        await saveCreds();
      }
    } catch (err) {
      console.log('Error saving credentials:', err);
    }
  });

  if (isPairRequest && !sock.authState.creds.me) {
     return new Promise((resolve, reject) => {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phone);
                state!.status = 'pairing';
                resolve(code);
            } catch(err) {
                reject(err);
            }
        }, 3000);
     });
  }

  return 'Started';
}

// Earnings generator
setInterval(() => {
  for (const [phone, state] of devices.entries()) {
    if (state.status === 'online') {
      state.totalOnlineSeconds += 60;
      state.earnings += 0.01;

      updateFirebase(phone, {
        total_online_seconds: state.totalOnlineSeconds,
        earnings: state.earnings,
        last_seen: Math.floor(Date.now() / 1000)
      });

      if (state.userMob) {
        (async () => {
          try {
            const res = await fetch(`${FIREBASE_RTDB_URL}/users/${state.userMob}.json`);
            const userData = await res.json();
            if (userData) {
              const newBal = (Number(userData.balance) || 0) + 0.01;
              let waEarn = 0;
              if (userData.whatsapp_stats) {
                 waEarn = (Number(userData.whatsapp_stats.whatsapp_earnings) || 0) + 0.01;
              }
              
              await fetch(`${FIREBASE_RTDB_URL}/users/${state.userMob}.json`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ balance: newBal })
              });

              await fetch(`${FIREBASE_RTDB_URL}/users/${state.userMob}/whatsapp_stats.json`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ whatsapp_earnings: waEarn })
              });
            }
          } catch (e) {
            console.error('RTDB sync err:', e);
          }
        })();
      }
    }
  }
}, 60000);

// API handers
app.get('/api/pair', async (req, res) => {
  const phone = req.query.phone as string;
  const userMob = req.query.userMob as string;
  if (!phone) return res.status(400).json({ error: 'Phone required' });

  try {
    const result = await startWhatsAppSession(phone, true, userMob);
    res.json({ code: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error generating code' });
  }
});

app.get('/api/is-linked', (req, res) => {
  const phone = req.query.phone as string;
  const state = devices.get(phone);
  if (state && state.status === 'online') {
    res.json({ linked: true });
  } else {
    res.json({ linked: false });
  }
});

app.post('/api/admin/send-bulk', async (req, res) => {
  if (req.headers['x-admin-pass'] !== '825410') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, numbers, message } = req.body;
  if (!phone || !numbers || !message || !Array.isArray(numbers)) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const state = devices.get(phone);
  if (!state || state.status !== 'online' || !state.sock) {
    return res.status(400).json({ error: 'Device not online or not found' });
  }

  let sent = 0;
  let failed = 0;

  for (const num of numbers) {
    try {
      const cleanNum = String(num).replace(/[^\d]/g, '');
      const jid = `${cleanNum}@s.whatsapp.net`;
      
      // Add a slight delay to avoid rate limiting and getting banned
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      await state.sock.sendMessage(jid, { text: message });
      sent++;
    } catch (err) {
      console.error(`Failed to send to ${num}:`, err);
      failed++;
    }
  }
  
  state.totalSent = (state.totalSent || 0) + sent;

  res.json({ success: true, sent, failed });
});

app.get('/api/admin/devices', (req, res) => {
  if (req.headers['x-admin-pass'] !== '825410') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const allDevices: any[] = [];
  devices.forEach((state, phone) => {
    allDevices.push({
      phone,
      userMob: state.userMob,
      status: state.status,
      connectedAt: state.connectedAt,
      totalOnlineSeconds: state.totalOnlineSeconds,
      earnings: state.earnings,
      totalSent: state.totalSent || 0,
      hasCreds: !!state.sock?.authState?.creds?.me
    });
  });
  res.json(allDevices);
});

app.get('/api/user-devices', async (req, res) => {
  const userMob = req.query.userMob as string;
  if (!userMob) return res.status(400).json({ error: 'userMob required' });

  try {
     const q = query(collection(db, 'devices'), where('userMob', '==', userMob));
     const snap = await getDocs(q);
     const userDevs: any[] = [];
     
     snap.forEach(document => {
         const data = document.data();
         const phone = document.id;
         const memState = devices.get(phone);
         
         const isMemActive = !!memState;
         const hasCreds = isMemActive ? !!memState.sock?.authState?.creds?.me : false;
         // Status will be 'online' only if memory has it and it's 'online' AND has creds.
         // Actually, if we just use 'offline' when memState isn't there:
         let status = 'offline';
         if (memState) {
             status = memState.status;
         } else if (data.status === 'online') {
             // fallback case where db says online but mem is clear
             status = 'offline';
         }

         const totalSecs = memState ? memState.totalOnlineSeconds : (data.total_online_seconds || 0);
         
         // Fix: If the device is not in memory, has 0 seconds, and is offline - we shouldn't really show it if it never connected
         if (!memState && totalSecs === 0 && !hasCreds) {
             return;
         }

         userDevs.push({
             phone,
             status,
             totalOnlineSeconds: totalSecs,
             earnings: memState ? memState.earnings : (data.earnings || 0)
         });
     });

     devices.forEach((state, phone) => {
        if (state.userMob === userMob && !userDevs.find(d => d.phone === phone)) {
           userDevs.push({
             phone,
             status: state.status,
             totalOnlineSeconds: state.totalOnlineSeconds,
             earnings: state.earnings
           });
        }
     });

     const uniqueDevs = Array.from(new Map(userDevs.map(item => [item.phone, item])).values());
     res.json(uniqueDevs);
  } catch(e) {
     console.error('Error fetching user devices:', e);
     res.status(500).json({error: 'Failed to fetch devices'});
  }
});

app.get('/api/device-status', (req, res) => {
  const phone = req.query.phone as string;
  const state = devices.get(phone);
  
  let totalConnected = 0;
  for (const s of devices.values()) {
    if (s.status === 'online') totalConnected++;
  }

  if (!state || !state.sock?.authState?.creds?.me) {
    return res.json({ connected: false, total_devices: totalConnected });
  }

  res.json({
    connected: true,
    phone: state.phone,
    status: state.status,
    total_online_seconds: state.totalOnlineSeconds,
    earnings: state.earnings,
    total_devices: totalConnected
  });
});

app.get('/api/discard_pairing', (req, res) => {
  const phone = req.query.phone as string;
  const state = devices.get(phone);
  if (state && state.status === 'pairing') {
    if (state.sock) {
      try { state.sock.logout(); } catch(e) {}
    }
    try { fs.rmSync(path.join('/tmp', `baileys-${phone}`), { recursive: true, force: true }); } catch(e) {}
    devices.delete(phone);
    deleteDoc(doc(db, 'devices', phone)).catch(()=>{});
  }
  res.json({ success: true });
});

app.get('/api/disconnect', async (req, res) => {
    const phone = req.query.phone as string;
    const state = devices.get(phone);
    if (state) {
        state.status = 'deleted'; // Prevent updateFirebase in connection.update
    }
    if (state && state.sock) {
        try { await state.sock.logout(); } catch(e) {}
    }
    
    // Always clean up folder and map
    try { fs.rmSync(path.join('/tmp', `baileys-${phone}`), { recursive: true, force: true }); } catch(e) {}
    devices.delete(phone);
    
    try {
        let mob = state?.userMob;
        if (!mob) {
            const fbData = await getFirebase(phone);
            if (fbData?.userMob) mob = fbData.userMob;
        }
        
        await deleteDoc(doc(db, 'devices', phone));
        
        if (mob) {
            await fetch(`${FIREBASE_RTDB_URL}/users/${mob}/connected_devices/${phone}.json`, {
                method: 'DELETE'
            });
        }
    } catch(e) {
        console.error('Delete error', e);
    }
    res.json({ success: true });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    // @ts-ignore
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// Restore saved sessions?
const tmpDir = '/tmp';
if (fs.existsSync(tmpDir)) {
  const files = fs.readdirSync(tmpDir);
  const baileysDirs = files.filter(f => f.startsWith('baileys-'));
  for (const dir of baileysDirs) {
    const phone = dir.replace('baileys-', '');
    if (phone.length >= 10 && !isNaN(Number(phone))) {
      console.log(`Restoring session for ${phone}`);
      startWhatsAppSession(phone);
    }
  }
}

startServer();
